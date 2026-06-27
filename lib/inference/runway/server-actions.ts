import 'server-only';

import { getOptionalEnv, getOptionalPositiveIntEnv } from '@/lib/utils/env';

import { RUNWAY_PROVIDER_ID, type RunwayModelConfig } from './family';
import { resolveRunwayModelConfig } from './models';
import { assertRunwaySemanticParams } from './semantic-lady';
import type {
  InferenceByokParams,
  InferenceProvider,
  InferenceRequest,
  InferenceResult,
} from '../types';

const RUNWAY_BASE_URL = 'https://api.dev.runwayml.com';
const RUNWAY_VERSION = '2024-11-06';
const POLL_INTERVAL_MS = 5_000;
const DEFAULT_POLL_TIMEOUT_MS = 45_000;
const POLL_TIMEOUT_MS =
  getOptionalPositiveIntEnv('INFERENCE_POLL_TIMEOUT_MS') ??
  DEFAULT_POLL_TIMEOUT_MS;
const REQUEST_TIMEOUT_MS = 30_000;

type RunwayRequestParams = {
  bodyControl?: boolean;
  duration?: number;
  expressionIntensity?: number;
  moderation?: boolean;
  referenceTag?: string;
  seed?: number;
  videoInputFiles: string[];
};

type RunwayTaskResponse = {
  id?: string;
  status?: string;
  output?: string[] | string | null;
  failure?: string | { message?: string } | null;
  failureCode?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export function isRunwayConfigured() {
  return Boolean(readRunwayApiKey());
}

export function createRunwayProvider(): InferenceProvider {
  const apiKey = requireRunwayApiKey();

  return {
    id: RUNWAY_PROVIDER_ID,
    label: 'Runway',
    submitPolicy: { maxSubmitAttemptsWithoutProviderId: 2 },
    extractProviderGenerationId(metadata) {
      const value = metadata.runway_task_id;

      return typeof value === 'string' && value.length > 0 ? value : null;
    },
    prepareRequest({ formData, request }) {
      const modelConfig = resolveRunwayModelConfig(request.model);
      const params = mergeRunwayPreflightParams(
        readRunwayParamsFromFormData(formData, modelConfig),
        request.byokParams,
      );
      const preparedRequest = {
        ...request,
        byokParams: params,
        outputFormat: modelConfig.outputFormats[0] ?? request.outputFormat,
        ratio: modelConfig.ratios.includes(request.ratio)
          ? request.ratio
          : modelConfig.defaultRatio,
        resolution: undefined,
      };
      const semanticParams = createRunwaySemanticParams(
        preparedRequest,
        resolveRunwayParams(params, modelConfig),
      );

      assertRunwaySemanticParams(request.model, semanticParams);
      assertRunwayRequestMatchesModelConfig(
        preparedRequest,
        modelConfig,
        resolveRunwayParams(params, modelConfig),
      );

      return {
        inputImageLimit: modelConfig.inputImageLimit,
        inputVideoLimit: modelConfig.inputVideoLimit,
        request: preparedRequest,
      };
    },
    async generate(
      request: InferenceRequest,
      options,
    ): Promise<InferenceResult> {
      const modelConfig = resolveRunwayModelConfig(request.model);
      const params = resolveRunwayParams(request.byokParams, modelConfig);
      const semanticParams = createRunwaySemanticParams(request, params);

      assertRunwaySemanticParams(request.model, semanticParams);
      assertRunwayRequestMatchesModelConfig(request, modelConfig, params);

      const resumeTaskId = options?.providerGenerationId ?? null;

      if (resumeTaskId) {
        const runwayMetadata = createRunwayMetadata({
          endpoint: endpointForRunwayRequest(modelConfig, request),
          params,
          request,
          resumed: true,
          taskId: resumeTaskId,
        });

        await options?.onStarted?.(runwayMetadata);

        const polled = await pollRunwayTask(resumeTaskId, apiKey);
        const remoteUrl = firstRunwayOutput(polled);

        return {
          providerId: RUNWAY_PROVIDER_ID,
          remoteUrl,
          contentType: modelConfig.outputContentType,
          metadata: {
            ...runwayMetadata,
            runway_remote_url: remoteUrl,
            runway_status: polled.status ?? null,
          },
        };
      }

      const endpoint = endpointForRunwayRequest(modelConfig, request);

      await options?.onPreSubmit?.({
        sherin_model_id: request.model,
        sherin_provider: RUNWAY_PROVIDER_ID,
        sherin_stage: 'provider_submitting',
        runway_endpoint: endpoint,
        runway_model: modelConfig.providerModel,
      });

      const submitResponse = await fetch(`${RUNWAY_BASE_URL}${endpoint}`, {
        method: 'POST',
        headers: runwayHeaders(apiKey),
        body: JSON.stringify(
          createRunwayRequestBody(request, modelConfig, params),
        ),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!submitResponse.ok) {
        throw await buildRunwayHttpError('Runway request', submitResponse);
      }

      const submitJson = (await submitResponse.json()) as { id?: string };

      if (!submitJson.id) {
        throw new Error('Runway response did not include an id.');
      }

      const runwayMetadata = createRunwayMetadata({
        endpoint,
        params,
        request,
        resumed: false,
        taskId: submitJson.id,
      });

      await options?.onStarted?.(runwayMetadata);

      const polled = await pollRunwayTask(submitJson.id, apiKey);
      const remoteUrl = firstRunwayOutput(polled);

      return {
        providerId: RUNWAY_PROVIDER_ID,
        remoteUrl,
        contentType: modelConfig.outputContentType,
        metadata: {
          ...runwayMetadata,
          runway_remote_url: remoteUrl,
          runway_status: polled.status ?? null,
        },
      };
    },
  };
}

function readRunwayParamsFromFormData(
  formData: FormData,
  config: RunwayModelConfig,
): InferenceRequest['byokParams'] {
  const params: InferenceRequest['byokParams'] = {};
  const duration = readOptionalNumber(formData.get('generation_duration'));

  if (duration !== undefined) {
    params.generation_duration = duration;
  } else if (config.duration?.required) {
    params.generation_duration = config.duration.defaultValue;
  }

  const moderation = readOptionalBoolean(formData.get('generation_moderation'));
  if (moderation !== undefined) {
    params.generation_moderation = moderation;
  }

  const bodyControl = readOptionalBoolean(
    formData.get('generation_body_control'),
  );
  if (bodyControl !== undefined) {
    params.generation_body_control = bodyControl;
  }

  assignNumberParam(
    params,
    'generation_expression_intensity',
    formData.get('generation_expression_intensity'),
  );

  const referenceTag = readOptionalString(
    formData.get('generation_reference_tag'),
  );
  if (referenceTag !== undefined) {
    params.generation_reference_tag = referenceTag;
  }

  assignNumberParam(
    params,
    'generation_seed',
    firstFormValue(formData, ['generation_seed', 'byok_seed']),
  );

  const videoInputFiles =
    formData.get('generation_input_video_file_source') === 'upload'
      ? []
      : parseInputUrls(formData.get('generation_input_video_file'));
  if (videoInputFiles.length > 0) {
    params.generation_input_video_file = videoInputFiles;
  }

  return params;
}

function mergeRunwayPreflightParams(
  formParams: InferenceRequest['byokParams'],
  requestParams: InferenceRequest['byokParams'],
) {
  const formVideoInputFiles = collectStringValues(
    formParams.generation_input_video_file,
  );
  const requestVideoInputFiles = collectStringValues(
    requestParams.generation_input_video_file,
  );

  if (requestVideoInputFiles.length > 0) {
    return {
      ...formParams,
      generation_input_video_file: requestVideoInputFiles,
    };
  }

  if (formVideoInputFiles.length > 0) {
    return formParams;
  }

  const { generation_input_video_file, ...params } = formParams;

  return params;
}

function resolveRunwayParams(
  params: InferenceByokParams,
  config: RunwayModelConfig,
): RunwayRequestParams {
  return {
    bodyControl: readOptionalBoolean(params.generation_body_control),
    duration:
      readOptionalNumber(params.generation_duration) ??
      (config.duration?.required ? config.duration.defaultValue : undefined),
    expressionIntensity: readOptionalNumber(
      params.generation_expression_intensity,
    ),
    moderation: readOptionalBoolean(params.generation_moderation),
    referenceTag: readOptionalString(params.generation_reference_tag),
    seed: readOptionalNumber(params.generation_seed),
    videoInputFiles: collectStringValues(params.generation_input_video_file),
  };
}

function endpointForRunwayRequest(
  config: RunwayModelConfig,
  request: InferenceRequest,
) {
  if (config.kind === 'image') {
    return '/v1/text_to_image';
  }

  if (config.workflows.includes('character')) {
    return '/v1/character_performance';
  }

  if (
    config.requiresVideoInput ||
    config.workflows.includes('video-to-video')
  ) {
    return '/v1/video_to_video';
  }

  if (
    request.inputFiles.length > 0 ||
    !config.workflows.includes('text-to-video')
  ) {
    return '/v1/image_to_video';
  }

  return '/v1/text_to_video';
}

function createRunwayRequestBody(
  request: InferenceRequest,
  config: RunwayModelConfig,
  params: RunwayRequestParams,
) {
  const body: Record<string, unknown> = {
    model: config.providerModel,
  };

  if (config.promptSupported && request.prompt.trim().length > 0) {
    body.promptText = request.prompt;
  }

  if (config.ratios.includes(request.ratio)) {
    if (endpointForRunwayRequest(config, request) === '/v1/video_to_video') {
      if (isTargetAspectRatio(request.ratio)) {
        body.targetAspectRatio = request.ratio;
      } else {
        body.ratio = request.ratio;
      }
    } else {
      body.ratio = request.ratio;
    }
  }

  if (params.duration !== undefined) {
    body.duration = params.duration;
  }

  if (params.seed !== undefined) {
    body.seed = params.seed;
  }

  if (params.moderation !== undefined) {
    body.contentModeration = {
      publicFigureThreshold: params.moderation ? 'auto' : 'low',
    };
  }

  if (params.referenceTag !== undefined) {
    body.referenceTags = [params.referenceTag];
  }

  if (params.bodyControl !== undefined) {
    body.bodyControl = params.bodyControl;
  }

  if (params.expressionIntensity !== undefined) {
    body.expressionIntensity = params.expressionIntensity;
  }

  if (config.kind === 'image') {
    if (request.inputFiles.length > 0) {
      body.referenceImages = request.inputFiles.map((uri) => ({ uri }));
    }

    return body;
  }

  if (
    endpointForRunwayRequest(config, request) === '/v1/character_performance'
  ) {
    if (request.inputFiles.length > 0) {
      body.character = {
        type: 'image',
        uri: request.inputFiles[0],
      };
    }

    body.reference = {
      type: 'video',
      uri: params.videoInputFiles[0],
    };

    return body;
  }

  if (endpointForRunwayRequest(config, request) === '/v1/video_to_video') {
    body.videoUri = params.videoInputFiles[0];

    if (request.inputFiles.length > 0) {
      body.keyframes = createRunwayKeyframes(request.inputFiles);
    }

    return body;
  }

  if (request.inputFiles.length > 0) {
    body.promptImage = request.inputFiles[0];
  }

  return body;
}

function createRunwayKeyframes(inputFiles: string[]) {
  if (inputFiles.length === 1) {
    return [{ uri: inputFiles[0], at: 0 }];
  }

  return inputFiles.slice(0, 5).map((uri, index, files) => ({
    uri,
    at: Number((index / Math.max(files.length - 1, 1)).toFixed(3)),
  }));
}

function createRunwaySemanticParams(
  request: InferenceRequest,
  params: RunwayRequestParams,
) {
  const config = resolveRunwayModelConfig(request.model);
  const semanticParams: Record<string, unknown> = {
    generation_aspect_ratio: request.ratio,
  };

  if (config.promptSupported) {
    semanticParams.generation_prompt = request.prompt;
  }

  if (params.duration !== undefined) {
    semanticParams.generation_duration = params.duration;
  }

  if (params.moderation !== undefined) {
    semanticParams.generation_moderation = params.moderation;
  }

  if (params.bodyControl !== undefined) {
    semanticParams.generation_body_control = params.bodyControl;
  }

  if (params.expressionIntensity !== undefined) {
    semanticParams.generation_expression_intensity = params.expressionIntensity;
  }

  if (params.referenceTag !== undefined) {
    semanticParams.generation_reference_tag = params.referenceTag;
  }

  if (params.seed !== undefined) {
    semanticParams.generation_seed = params.seed;
  }

  if (request.inputFiles.length > 0) {
    semanticParams.generation_input_image_file = request.inputFiles;
  }

  if (params.videoInputFiles.length > 0) {
    semanticParams.generation_input_video_file = params.videoInputFiles;
  }

  return semanticParams;
}

function assertRunwayRequestMatchesModelConfig(
  request: InferenceRequest,
  config: RunwayModelConfig,
  params: RunwayRequestParams,
) {
  if (!config.outputFormats.includes(request.outputFormat as never)) {
    throw new Error(
      `Runway model ${request.model} does not support output format ${request.outputFormat}.`,
    );
  }

  if (!config.ratios.includes(request.ratio)) {
    throw new Error(
      `Runway model ${request.model} does not support ${request.ratio}.`,
    );
  }

  if (request.inputFiles.length > config.inputImageLimit) {
    throw new Error(
      `Runway model ${request.model} supports at most ${config.inputImageLimit} input image URLs.`,
    );
  }

  if (config.requiresImageInput && request.inputFiles.length === 0) {
    throw new Error(
      `Runway model ${request.model} requires an input image URL.`,
    );
  }

  if (!config.supportsImageInput && request.inputFiles.length > 0) {
    throw new Error(
      `Runway model ${request.model} does not support input images.`,
    );
  }

  if (params.videoInputFiles.length > config.inputVideoLimit) {
    throw new Error(
      `Runway model ${request.model} supports at most ${config.inputVideoLimit} input video URLs.`,
    );
  }

  if (config.requiresVideoInput && params.videoInputFiles.length === 0) {
    throw new Error(
      `Runway model ${request.model} requires an input video URL.`,
    );
  }

  if (!config.supportsVideoInput && params.videoInputFiles.length > 0) {
    throw new Error(
      `Runway model ${request.model} does not support input videos.`,
    );
  }

  if (params.duration !== undefined && config.duration) {
    if (
      !Number.isInteger(params.duration) ||
      params.duration < config.duration.min ||
      params.duration > config.duration.max
    ) {
      throw new Error(
        `Runway model ${request.model} supports duration ${config.duration.min}-${config.duration.max} seconds.`,
      );
    }
  }

  if (params.seed !== undefined && config.seed) {
    if (
      !Number.isInteger(params.seed) ||
      params.seed < config.seed.min ||
      params.seed > config.seed.max
    ) {
      throw new Error(
        `Runway model ${request.model} supports seed ${config.seed.min}-${config.seed.max}.`,
      );
    }
  }
}

async function pollRunwayTask(taskId: string, apiKey: string) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let lastStatus = 'PENDING';

  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);

    const response = await fetch(
      `${RUNWAY_BASE_URL}/v1/tasks/${encodeURIComponent(taskId)}`,
      {
        method: 'GET',
        headers: runwayHeaders(apiKey),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );

    if (!response.ok) {
      throw await buildRunwayHttpError('Runway polling', response);
    }

    const json = (await response.json()) as RunwayTaskResponse;
    lastStatus = json.status ?? lastStatus;
    const normalizedStatus = lastStatus.toUpperCase();

    if (normalizedStatus === 'SUCCEEDED') {
      return json;
    }

    if (normalizedStatus === 'FAILED') {
      throw new Error(
        `Runway generation failed: ${readFailureMessage(json.failure)} (${json.failureCode ?? 'provider_failed'}).`,
      );
    }

    if (normalizedStatus === 'CANCELED' || normalizedStatus === 'CANCELLED') {
      throw new Error('Runway generation was canceled.');
    }
  }

  throw buildRunwayPollTimeoutError(lastStatus);
}

function firstRunwayOutput(response: RunwayTaskResponse) {
  const outputs = collectStringValues(response.output);
  const remoteUrl = outputs[0];

  if (!remoteUrl || !remoteUrl.startsWith('https://')) {
    throw new Error('Runway returned no HTTPS output URL.');
  }

  return remoteUrl;
}

function createRunwayMetadata({
  endpoint,
  params,
  request,
  resumed,
  taskId,
}: {
  endpoint: string;
  params: RunwayRequestParams;
  request: InferenceRequest;
  resumed: boolean;
  taskId: string;
}) {
  return {
    sherin_model_id: request.model,
    sherin_stage: 'inference_started',
    runway_aspect_ratio: request.ratio,
    runway_duration: params.duration ?? null,
    runway_endpoint: endpoint,
    runway_input_file_count: request.inputFiles.length,
    runway_model: resolveRunwayModelConfig(request.model).providerModel,
    runway_output_format: request.outputFormat,
    runway_seed: params.seed ?? null,
    runway_task_id: taskId,
    runway_video_input_file_count: params.videoInputFiles.length,
    ...(resumed ? { runway_resumed: true } : {}),
  };
}

function runwayHeaders(apiKey: string) {
  return {
    accept: 'application/json',
    authorization: `Bearer ${apiKey}`,
    'content-type': 'application/json',
    'x-runway-version': RUNWAY_VERSION,
  };
}

async function buildRunwayHttpError(label: string, response: Response) {
  const body = await safeText(response);
  const error = new Error(
    `${label} failed (${response.status}): ${body}`,
  ) as Error & {
    statusCode?: number;
    retryAfterSeconds?: number | null;
    isTransient?: boolean;
  };
  error.statusCode = response.status;
  error.retryAfterSeconds = parseRetryAfter(
    response.headers.get('retry-after'),
  );
  error.isTransient =
    response.status === 408 ||
    response.status === 425 ||
    response.status === 429 ||
    (response.status >= 500 && response.status < 600);
  return error;
}

function buildRunwayPollTimeoutError(lastStatus: string) {
  const error = new Error(
    `Runway generation timed out within this worker invocation (last status: ${lastStatus}).`,
  );
  error.name = 'TimeoutError';
  return error;
}

function readRunwayApiKey() {
  return (
    getOptionalEnv('RUNWAYML_API_SECRET') ?? getOptionalEnv('RUNWAY_API_KEY')
  );
}

function requireRunwayApiKey() {
  const apiKey = readRunwayApiKey();

  if (!apiKey) {
    throw new Error('RUNWAYML_API_SECRET is required for Runway inference.');
  }

  return apiKey;
}

function assignNumberParam(
  params: InferenceRequest['byokParams'],
  key: string,
  value: unknown,
) {
  const parsed = readOptionalNumber(value);

  if (parsed !== undefined) {
    params[key] = parsed;
  }
}

function readOptionalNumber(value: unknown) {
  if (value === null || value === undefined || value === '') {
    return undefined;
  }

  const numberValue = Number(value);

  return Number.isFinite(numberValue) ? numberValue : undefined;
}

function readOptionalBoolean(value: unknown) {
  if (typeof value === 'boolean') {
    return value;
  }

  if (value === 'true') {
    return true;
  }

  if (value === 'false') {
    return false;
  }

  return undefined;
}

function readOptionalString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function firstFormValue(formData: FormData, names: readonly string[]) {
  for (const name of names) {
    const value = formData.get(name);

    if (typeof value === 'string' && value.trim().length === 0) {
      continue;
    }

    if (value !== null) {
      return value;
    }
  }

  return null;
}

function parseInputUrls(value: unknown) {
  if (typeof value !== 'string') {
    return [];
  }

  return value
    .split(/[\n,]/)
    .map((url) => url.trim())
    .filter(Boolean)
    .map((url) => {
      if (!isHttpsUrl(url)) {
        throw new Error('Runway input URLs must use HTTPS.');
      }

      return url;
    });
}

function collectStringValues(value: unknown) {
  if (typeof value === 'string' && value.trim().length > 0) {
    return [value.trim()];
  }

  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
}

function readFailureMessage(value: RunwayTaskResponse['failure']) {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value;
  }

  if (value && typeof value === 'object' && typeof value.message === 'string') {
    return value.message;
  }

  return 'Runway generation failed.';
}

function isTargetAspectRatio(value: string) {
  return ['16:9', '4:3', '3:2', '1:1', '2:3', '3:4', '9:16', '21:9'].includes(
    value,
  );
}

function parseRetryAfter(value: string | null) {
  if (!value) {
    return null;
  }

  const seconds = Number(value);

  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(Math.ceil(seconds), 600);
  }

  const dateMs = Date.parse(value);

  if (Number.isFinite(dateMs)) {
    return Math.max(0, Math.min(600, Math.ceil((dateMs - Date.now()) / 1000)));
  }

  return null;
}

async function safeText(response: Response) {
  try {
    return (await response.text()).slice(0, 500);
  } catch {
    return '<no body>';
  }
}

function isHttpsUrl(value: string) {
  try {
    const url = new URL(value);

    return url.protocol === 'https:';
  } catch {
    return false;
  }
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
