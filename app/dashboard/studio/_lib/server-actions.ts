'use server';

import { randomUUID } from 'node:crypto';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { after } from 'next/server';

import {
  DEFAULT_GENERATION_OUTPUT_NUMBER,
  DEFAULT_OUTPUT_FORMAT,
  DEFAULT_RATIO,
  getDefaultModelIdForInferenceProvider,
  getBabySeaInputFileLimit,
  type SherinModelId,
} from '@/lib/app-config';
import type { Database } from '@/lib/database.types';
import {
  resolveInferenceProvider,
  type InferenceProvider,
  type InferenceRequest,
} from '@/lib/inference';
import { getBabySeaStudioModelSchema } from '@/lib/inference/babysea/server-actions';
import { isOwnerEmail } from '@/lib/auth/owner';
import { getStorageProviderStatus, removeStoredAssets } from '@/lib/storage';
import { createSupabaseAdminClient } from '@/lib/database/admin';
import { getUser } from '@/lib/database/server-actions';

import {
  createQueuedGenerationJob,
  GenerateFormSchema,
  type GenerationInput,
  mergeGenerationMetadata,
  parseBabySeaSpecificParams,
  readQueuedGenerationInputFileUploadPaths,
} from './generation-job';
import { processGenerationQueue } from './generation-worker';
import {
  InvalidInputFileUploadError,
  type StoredInputFileAsset,
  cleanupInputFileUploads,
  persistUploadedInputFile,
  persistUrlInputFile,
} from './input-file-uploads';
import { canResumeProviderWorkload } from './provider-resume';

type SupabaseAdminClient = ReturnType<typeof createSupabaseAdminClient>;
type GenerationRow = Database['public']['Tables']['generations']['Row'];
type InputFileSource = 'url' | 'upload';

const STALE_QUEUED_GENERATION_MS = 5 * 60 * 1000;
const STALE_RUNNING_GENERATION_MS = 20 * 60 * 1000;
const INPUT_FILE_SOURCE_FIELD = 'generation_input_file_source';
const INPUT_FILE_UPLOAD_FIELD = 'generation_input_file_upload';

export async function generateImage(formData: FormData) {
  const { user } = await getUser();

  if (!user) {
    redirect('/access');
  }

  if (!isOwnerEmail(user.email)) {
    redirect('/access?error=not_owner');
  }

  const inputFileSource = readInputFileSource(formData);
  const inputFileUploads = readInputFileUploads(formData);

  let provider;
  try {
    provider = resolveInferenceProvider();
  } catch {
    redirect('/dashboard/studio?error=inference_unconfigured');
  }

  const parsed = GenerateFormSchema.safeParse({
    model:
      formData.get('model') ??
      getDefaultModelIdForInferenceProvider(provider.id),
    prompt: formData.get('prompt') ?? '',
    ratio: formData.get('ratio') ?? DEFAULT_RATIO,
    generation_resolution: formData.get('generation_resolution'),
    output_format: formData.get('output_format') ?? DEFAULT_OUTPUT_FORMAT,
    generation_output_number:
      formData.get('generation_output_number') ??
      String(DEFAULT_GENERATION_OUTPUT_NUMBER),
    generation_provider_order:
      formData.get('generation_provider_order') ?? 'fastest',
    generation_input_file:
      inputFileSource === 'url' ? formData.get('generation_input_file') : null,
  });

  if (!parsed.success) {
    redirect('/dashboard/studio?error=invalid_input');
  }

  const admin = createSupabaseAdminClient();
  await recoverStaleActiveGenerations(admin, user.id);

  const activeGeneration = await getActiveGeneration(admin, user.id);

  if (activeGeneration) {
    scheduleGenerationQueue(user.id);
    revalidateStudioPaths();
    redirect(`/dashboard/studio?created=${activeGeneration.id}`);
  }

  let generationInput = parsed.data;

  const generationId = randomUUID();
  let babyseaSpecificParams: Record<string, string | number | boolean> = {};
  let inputFileAssets: StoredInputFileAsset[] = [];

  if (provider.id === 'babysea') {
    const schema = await loadBabySeaSchemaOrRedirect(parsed.data.model);

    generationInput = {
      ...parsed.data,
      generation_input_file: inputFilesForPreflight(
        inputFileSource,
        parsed.data.generation_input_file,
        inputFileUploads,
      ),
      generation_resolution:
        parsed.data.generation_resolution ?? schema.defaultResolution,
    };

    if (!schema.ratios.includes(generationInput.ratio)) {
      redirect('/dashboard/studio?error=invalid_input');
    }

    if (!schema.outputFormats.includes(generationInput.output_format)) {
      redirect('/dashboard/studio?error=invalid_input');
    }

    if (
      schema.resolutions.length > 0 &&
      (!generationInput.generation_resolution ||
        !schema.resolutions.includes(generationInput.generation_resolution))
    ) {
      redirect('/dashboard/studio?error=invalid_input');
    }

    if (generationInput.generation_output_number !== schema.outputNumber) {
      redirect('/dashboard/studio?error=invalid_input');
    }

    if (
      !schema.providerOrderOptions.includes(
        generationInput.generation_provider_order,
      )
    ) {
      redirect('/dashboard/studio?error=invalid_input');
    }

    if (generationInput.generation_input_file.length > 0 && !schema.inputFile) {
      redirect('/dashboard/studio?error=invalid_input');
    }

    if (!generationInput.generation_input_file.every(isHttpsUrl)) {
      redirect('/dashboard/studio?error=invalid_input');
    }

    if (
      schema.inputFile &&
      generationInput.generation_input_file.length >
        getBabySeaInputFileLimit(parsed.data.model)
    ) {
      redirect('/dashboard/studio?error=invalid_input');
    }

    try {
      babyseaSpecificParams = parseBabySeaSpecificParams(
        formData,
        schema.specificSchema,
      );
    } catch {
      redirect('/dashboard/studio?error=invalid_input');
    }

    const resolvedInputFiles = await resolveGenerationInputFilesOrRedirect({
      admin,
      generationId,
      maxFiles: schema.inputFile
        ? getBabySeaInputFileLimit(parsed.data.model)
        : 0,
      source: inputFileSource,
      uploadFiles: inputFileUploads,
      urls: parsed.data.generation_input_file,
      userId: user.id,
    });
    inputFileAssets = resolvedInputFiles.assets;

    generationInput = {
      ...generationInput,
      generation_input_file: resolvedInputFiles.urls,
    };
  }

  if (provider.id !== 'babysea') {
    const preflightRequest = toInferenceRequest({
      babyseaSpecificParams: {},
      values: {
        ...parsed.data,
        generation_input_file: inputFilesForPreflight(
          inputFileSource,
          parsed.data.generation_input_file,
          inputFileUploads,
        ),
      },
    });
    const prepared = await prepareByokRequestOrRedirect(
      provider,
      formData,
      preflightRequest,
    );
    const resolvedInputFiles = await resolveGenerationInputFilesOrRedirect({
      admin,
      generationId,
      maxFiles: prepared.inputFileLimit,
      source: inputFileSource,
      uploadFiles: inputFileUploads,
      urls: parsed.data.generation_input_file,
      userId: user.id,
    });
    inputFileAssets = resolvedInputFiles.assets;

    generationInput = fromInferenceRequest({
      ...prepared.request,
      inputFiles: resolvedInputFiles.urls,
    });
  }

  const storageStatus = getStorageProviderStatus();
  const initialStorageProvider =
    storageStatus.active ?? storageStatus.preferred ?? 'supabase-storage';
  const generationJob = createQueuedGenerationJob(
    generationInput,
    babyseaSpecificParams,
    initialStorageProvider,
    inputFileAssets,
  );
  const inputFileBytes = inputFileAssets.reduce(
    (total, asset) => total + asset.byteLength,
    0,
  );
  const generationMetadata = mergeGenerationMetadata({
    sherin_job: generationJob,
    ...(inputFileAssets.length > 0
      ? {
          sherin_input_file_count: inputFileAssets.length,
          sherin_input_file_storage_paths: inputFileAssets.map(
            (asset) => asset.storagePath,
          ),
        }
      : {}),
    sherin_model_id: generationInput.model,
    sherin_output_format: generationInput.output_format,
    sherin_prompt: generationInput.prompt,
    ...(generationInput.generation_resolution
      ? { sherin_resolution: generationInput.generation_resolution }
      : {}),
    sherin_ratio: generationInput.ratio,
    sherin_stage: 'queued',
    sherin_started_at: new Date().toISOString(),
    sherin_storage_provider: initialStorageProvider,
  });

  const { data: generation, error: insertError } = await admin
    .from('generations')
    .insert({
      id: generationId,
      user_id: user.id,
      status: 'queued',
      inference_provider: provider.id,
      storage_provider: initialStorageProvider,
      storage_bytes: inputFileBytes,
      metadata: generationMetadata,
    })
    .select('id')
    .single();

  if (insertError) {
    await cleanupStoredInputFileAssets(inputFileAssets);

    if (isActiveGenerationConflict(insertError)) {
      const conflictingGeneration = await getActiveGeneration(admin, user.id);

      if (conflictingGeneration) {
        scheduleGenerationQueue(user.id);
        revalidateStudioPaths();
        redirect(`/dashboard/studio?created=${conflictingGeneration.id}`);
      }

      const latestGeneration = await getLatestGeneration(admin, user.id);

      revalidateStudioPaths();

      if (latestGeneration) {
        redirect(`/dashboard/studio?created=${latestGeneration.id}`);
      }

      redirect('/dashboard/studio');
    }

    throw insertError;
  }

  if (!generation) {
    await cleanupStoredInputFileAssets(inputFileAssets);

    throw insertError ?? new Error('Could not create generation row.');
  }

  scheduleGenerationQueue(user.id);
  revalidateStudioPaths();
  redirect(`/dashboard/studio?created=${generationId}`);
}

export async function cancelActiveGeneration() {
  const { user } = await getUser();

  if (!user) {
    redirect('/access');
  }

  if (!isOwnerEmail(user.email)) {
    redirect('/access?error=not_owner');
  }

  const admin = createSupabaseAdminClient();
  await recoverStaleActiveGenerations(admin, user.id);

  const activeGeneration = await getActiveGeneration(admin, user.id);

  if (!activeGeneration) {
    revalidateStudioPaths();
    redirect('/dashboard/studio');
  }

  const canceledAt = new Date().toISOString();
  const message =
    'Canceled in Sherin by owner. Provider-side jobs already running may still complete.';
  const metadata = mergeGenerationMetadata(activeGeneration.metadata, {
    sherin_error: message,
    sherin_failed_at: canceledAt,
    sherin_failed_stage: 'owner_cancelled',
    sherin_stage: 'failed',
  });

  const { error } = await admin
    .from('generations')
    .update({
      error: message,
      metadata,
      status: 'failed',
    })
    .eq('id', activeGeneration.id)
    .eq('user_id', user.id)
    .in('status', ['queued', 'running']);

  if (error) {
    throw error;
  }

  await cleanupInputFileUploads(
    admin,
    user.id,
    readQueuedGenerationInputFileUploadPaths(activeGeneration.metadata),
  );

  revalidateStudioPaths();
  redirect('/dashboard/studio?error=generation_cancelled');
}

function revalidateStudioPaths() {
  revalidatePath('/dashboard/studio');
  revalidatePath('/dashboard/gallery');
  revalidatePath('/dashboard/references');
  revalidatePath('/dashboard/usage');
}

function scheduleGenerationQueue(userId: string) {
  after(async () => {
    try {
      await processGenerationQueue({ limit: 1, userId });
    } catch (error) {
      console.error('Could not process generation queue after submit', error);
    }
  });
}

async function getActiveGeneration(admin: SupabaseAdminClient, userId: string) {
  const { data, error } = await admin
    .from('generations')
    .select('id,created_at,metadata')
    .eq('user_id', userId)
    .in('status', ['queued', 'running'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

async function recoverStaleActiveGenerations(
  admin: SupabaseAdminClient,
  userId: string,
) {
  const now = Date.now();
  const queuedBefore = new Date(now - STALE_QUEUED_GENERATION_MS).toISOString();
  const runningBefore = new Date(
    now - STALE_RUNNING_GENERATION_MS,
  ).toISOString();

  const { data, error } = await admin
    .from('generations')
    .select(
      'id,status,inference_provider,provider_generation_id,created_at,updated_at,metadata,error,retry_not_before',
    )
    .eq('user_id', userId)
    .in('status', ['queued', 'running']);

  if (error) {
    throw error;
  }

  for (const generation of data ?? []) {
    if (
      generation.status === 'queued' &&
      isQueuedGenerationStale(generation, queuedBefore) &&
      !canResumeProviderWorkload(generation)
    ) {
      await failStaleGeneration(admin, generation, queuedBefore, userId);
      continue;
    }

    if (
      generation.status === 'running' &&
      generation.updated_at < runningBefore &&
      !canResumeProviderWorkload(generation)
    ) {
      await failStaleGeneration(admin, generation, runningBefore, userId);
    }
  }
}

async function failStaleGeneration(
  admin: SupabaseAdminClient,
  generation: Pick<
    GenerationRow,
    | 'id'
    | 'status'
    | 'inference_provider'
    | 'provider_generation_id'
    | 'metadata'
    | 'error'
    | 'created_at'
    | 'updated_at'
    | 'retry_not_before'
  >,
  staleBefore: string,
  userId: string,
) {
  const failedAt = new Date().toISOString();
  const message = generation.error ?? 'Generation timed out before completion.';
  const metadata = mergeGenerationMetadata(generation.metadata, {
    sherin_error: message,
    sherin_failed_at: failedAt,
    sherin_failed_stage: 'stale_recovery',
    sherin_stage: 'failed',
  });

  let query = admin
    .from('generations')
    .update({
      error: message,
      metadata,
      status: 'failed',
    })
    .eq('id', generation.id)
    .eq('status', generation.status);

  if (generation.status === 'queued') {
    query = query.lt(
      hasRetryNotBefore(generation) ? 'retry_not_before' : 'created_at',
      staleBefore,
    );
  } else {
    query = query.lt('updated_at', staleBefore);
  }

  const { data, error } = await query.select('id');

  if (error) {
    throw error;
  }

  if ((data?.length ?? 0) > 0) {
    await cleanupInputFileUploads(
      admin,
      userId,
      readQueuedGenerationInputFileUploadPaths(generation.metadata),
    );
  }
}

function isQueuedGenerationStale(
  generation: Pick<GenerationRow, 'created_at' | 'retry_not_before'>,
  staleBefore: string,
) {
  const retryNotBeforeMs = generation.retry_not_before
    ? Date.parse(generation.retry_not_before)
    : NaN;

  if (Number.isFinite(retryNotBeforeMs)) {
    const staleBeforeMs = Date.parse(staleBefore);
    return retryNotBeforeMs < staleBeforeMs;
  }

  return generation.created_at < staleBefore;
}

function hasRetryNotBefore(
  generation: Pick<GenerationRow, 'retry_not_before'>,
) {
  return Number.isFinite(
    generation.retry_not_before ? Date.parse(generation.retry_not_before) : NaN,
  );
}

async function getLatestGeneration(admin: SupabaseAdminClient, userId: string) {
  const { data, error } = await admin
    .from('generations')
    .select('id')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

function isActiveGenerationConflict(error: unknown) {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const record = error as Record<string, unknown>;
  const message = [record.message, record.details]
    .filter((value): value is string => typeof value === 'string')
    .join(' ');

  return (
    record.code === '23505' &&
    message.includes('generations_one_active_per_user_idx')
  );
}

function readInputFileSource(formData: FormData): InputFileSource {
  return formData.get(INPUT_FILE_SOURCE_FIELD) === 'upload' ? 'upload' : 'url';
}

function readInputFileUploads(formData: FormData) {
  return formData
    .getAll(INPUT_FILE_UPLOAD_FIELD)
    .filter((value): value is File => {
      if (!isUploadedFile(value)) {
        return false;
      }

      return value.name !== '' || value.size > 0;
    });
}

function isUploadedFile(value: FormDataEntryValue): value is File {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<File>;

  return (
    typeof candidate.arrayBuffer === 'function' &&
    typeof candidate.name === 'string' &&
    typeof candidate.size === 'number' &&
    typeof candidate.type === 'string'
  );
}

async function prepareByokRequestOrRedirect(
  provider: InferenceProvider,
  formData: FormData,
  request: InferenceRequest,
) {
  try {
    return provider.prepareRequest
      ? await provider.prepareRequest({ formData, request })
      : { inputFileLimit: request.inputFiles.length, request };
  } catch (error) {
    console.error('Could not prepare BYOK generation input', error);
    redirect('/dashboard/studio?error=invalid_input');
  }
}

function toInferenceRequest({
  babyseaSpecificParams,
  values,
}: {
  babyseaSpecificParams: Record<string, string | number | boolean>;
  values: GenerationInput;
}): InferenceRequest {
  return {
    babyseaSpecificParams,
    byokParams: values.byok_params,
    inputFiles: values.generation_input_file,
    model: values.model,
    outputFormat: values.output_format,
    outputNumber: values.generation_output_number,
    prompt: values.prompt,
    providerOrder: values.generation_provider_order,
    ratio: values.ratio,
    resolution: values.generation_resolution,
  };
}

function fromInferenceRequest(request: InferenceRequest): GenerationInput {
  return {
    byok_params: request.byokParams,
    generation_input_file: request.inputFiles,
    generation_output_number: request.outputNumber,
    generation_provider_order: request.providerOrder,
    generation_resolution: request.resolution,
    model: request.model,
    output_format: request.outputFormat,
    prompt: request.prompt,
    ratio: request.ratio,
  };
}

function inputFilesForPreflight(
  source: InputFileSource,
  urls: string[],
  uploadFiles: File[],
) {
  if (source === 'url') {
    return urls;
  }

  return uploadFiles.map((_, index) => `https://example.com/input-${index}`);
}

async function resolveGenerationInputFilesOrRedirect(input: {
  admin: SupabaseAdminClient;
  generationId: string;
  maxFiles: number;
  source: InputFileSource;
  uploadFiles: File[];
  urls: string[];
  userId: string;
}) {
  try {
    return await resolveGenerationInputFiles(input);
  } catch (error) {
    if (error instanceof InvalidInputFileUploadError) {
      redirect(`/dashboard/studio?error=${error.feedback}`);
    }

    console.error('Could not upload input images to Supabase Storage', error);
    redirect('/dashboard/studio?error=input_upload_failed');
  }
}

async function resolveGenerationInputFiles(input: {
  admin: SupabaseAdminClient;
  generationId: string;
  maxFiles: number;
  source: InputFileSource;
  uploadFiles: File[];
  urls: string[];
  userId: string;
}) {
  if (input.source === 'url') {
    if (input.urls.length > input.maxFiles) {
      throw new InvalidInputFileUploadError(
        'Too many input image URLs.',
        'invalid_input',
      );
    }

    const assets: StoredInputFileAsset[] = [];

    try {
      let reservedBytes = 0;

      for (const [index, url] of input.urls.entries()) {
        const asset = await persistUrlInputFile({
          generationId: input.generationId,
          index,
          reservedBytes,
          url,
          userId: input.userId,
        });

        assets.push(asset);
        reservedBytes += asset.byteLength;
      }
    } catch (error) {
      await cleanupStoredInputFileAssets(assets);

      throw error;
    }

    return { assets, storagePaths: [], urls: assets.map((asset) => asset.url) };
  }

  if (input.uploadFiles.length === 0) {
    return { assets: [], storagePaths: [], urls: [] };
  }

  if (input.uploadFiles.length > input.maxFiles) {
    throw new InvalidInputFileUploadError('Too many uploaded input images.');
  }

  const assets: StoredInputFileAsset[] = [];

  try {
    let reservedBytes = 0;

    for (const [index, file] of input.uploadFiles.entries()) {
      const asset = await persistUploadedInputFile({
        file,
        generationId: input.generationId,
        index,
        reservedBytes,
        userId: input.userId,
      });

      assets.push(asset);
      reservedBytes += asset.byteLength;
    }
  } catch (error) {
    await cleanupStoredInputFileAssets(assets);

    throw error;
  }

  return {
    assets,
    storagePaths: [],
    urls: assets.map((asset) => asset.url),
  };
}

async function cleanupStoredInputFileAssets(assets: StoredInputFileAsset[]) {
  if (assets.length === 0) {
    return;
  }

  try {
    await removeStoredAssets(
      assets.map((asset) => ({
        storagePath: asset.storagePath,
        storageProvider: asset.storageProvider,
      })),
    );
  } catch (error) {
    console.warn('Could not remove stored input images after failure', error);
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

async function loadBabySeaSchemaOrRedirect(model: SherinModelId) {
  try {
    return await getBabySeaStudioModelSchema(model);
  } catch (error) {
    console.error('Could not load BabySea model schema', error);
    redirect('/dashboard/studio?error=schema_unavailable');
  }
}
