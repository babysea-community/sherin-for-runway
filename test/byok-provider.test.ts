import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createRunwayProvider,
  isRunwayConfigured,
} from '@/lib/inference/runway/server-actions';
import type {
  InferenceProvider,
  InferenceRequest,
} from '@/lib/inference/types';

describe('Runway provider', () => {
  beforeEach(() => {
    process.env.RUNWAYML_API_SECRET = 'runway_test_key';
    delete process.env.RUNWAY_API_KEY;
    delete process.env.INFERENCE_POLL_TIMEOUT_MS;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('submits image-to-video tasks with BabyChain-compatible request fields', async () => {
    vi.useFakeTimers();
    const fetchMock = mockReadyRunwayFetch(
      'runway_task_i2v',
      'https://assets.example.com/output.mp4',
    );

    vi.stubGlobal('fetch', fetchMock);

    const generationPromise = createRunwayProvider().generate(
      createRequest({
        byokParams: {
          generation_duration: 5,
          generation_moderation: false,
          generation_seed: 123,
        },
        inputFiles: ['https://assets.example.com/source.png'],
        model: 'runway/gen-4-turbo',
        outputFormat: 'mp4',
        ratio: '1280:720',
      }),
    );

    await vi.advanceTimersByTimeAsync(5_000);
    const result = await generationPromise;
    const [submitUrl, submitInit] = fetchMock.mock.calls[0] as [
      string,
      RequestInit,
    ];
    const submitBody = JSON.parse(String(submitInit.body)) as Record<
      string,
      unknown
    >;

    expect(submitUrl).toBe('https://api.dev.runwayml.com/v1/image_to_video');
    expect(submitInit.headers).toMatchObject({
      authorization: 'Bearer runway_test_key',
      'x-runway-version': '2024-11-06',
    });
    expect(submitBody).toMatchObject({
      contentModeration: { publicFigureThreshold: 'low' },
      duration: 5,
      model: 'gen4_turbo',
      promptImage: 'https://assets.example.com/source.png',
      promptText: 'A clean regression generation',
      ratio: '1280:720',
      seed: 123,
    });
    expect(result).toMatchObject({
      contentType: 'video/mp4',
      providerId: 'runway',
      remoteUrl: 'https://assets.example.com/output.mp4',
    });
  });

  it('submits video-to-video tasks with videoUri', async () => {
    vi.useFakeTimers();
    const fetchMock = mockReadyRunwayFetch(
      'runway_task_v2v',
      'https://assets.example.com/edit.mp4',
    );

    vi.stubGlobal('fetch', fetchMock);

    const generationPromise = createRunwayProvider().generate(
      createRequest({
        byokParams: {
          generation_input_video_file: ['https://assets.example.com/input.mp4'],
        },
        model: 'runway/aleph-2',
        outputFormat: 'mp4',
        ratio: '16:9',
      }),
    );

    await vi.advanceTimersByTimeAsync(5_000);
    await generationPromise;
    const [submitUrl, submitInit] = fetchMock.mock.calls[0] as [
      string,
      RequestInit,
    ];
    const submitBody = JSON.parse(String(submitInit.body)) as Record<
      string,
      unknown
    >;

    expect(submitUrl).toBe('https://api.dev.runwayml.com/v1/video_to_video');
    expect(submitBody).toMatchObject({
      model: 'aleph2',
      targetAspectRatio: '16:9',
      videoUri: 'https://assets.example.com/input.mp4',
    });
    expect(submitBody).not.toHaveProperty('ratio');
  });

  it('submits image tasks with Semantic Lady Runway params', async () => {
    vi.useFakeTimers();
    const fetchMock = mockReadyRunwayFetch(
      'runway_task_image',
      'https://assets.example.com/output.png',
    );

    vi.stubGlobal('fetch', fetchMock);

    const generationPromise = createRunwayProvider().generate(
      createRequest({
        byokParams: {
          generation_moderation: true,
          generation_reference_tag: 'hero',
          generation_seed: 321,
        },
        inputFiles: ['https://assets.example.com/reference.png'],
        model: 'runway/gen-4-image',
        outputFormat: 'png',
        ratio: '1024:1024',
      }),
    );

    await vi.advanceTimersByTimeAsync(5_000);
    await generationPromise;
    const [submitUrl, submitInit] = fetchMock.mock.calls[0] as [
      string,
      RequestInit,
    ];
    const submitBody = JSON.parse(String(submitInit.body)) as Record<
      string,
      unknown
    >;

    expect(submitUrl).toBe('https://api.dev.runwayml.com/v1/text_to_image');
    expect(submitBody).toMatchObject({
      contentModeration: { publicFigureThreshold: 'auto' },
      model: 'gen4_image',
      referenceImages: [{ uri: 'https://assets.example.com/reference.png' }],
      referenceTags: ['hero'],
      seed: 321,
    });
  });

  it('submits character tasks without promptText for Act Two', async () => {
    vi.useFakeTimers();
    const fetchMock = mockReadyRunwayFetch(
      'runway_task_character',
      'https://assets.example.com/act-two.mp4',
    );

    vi.stubGlobal('fetch', fetchMock);

    const generationPromise = createRunwayProvider().generate(
      createRequest({
        byokParams: {
          generation_body_control: true,
          generation_expression_intensity: 4,
          generation_input_video_file: [
            'https://assets.example.com/reference.mp4',
          ],
        },
        inputFiles: ['https://assets.example.com/character.png'],
        model: 'runway/act-two',
        outputFormat: 'mp4',
        prompt: '',
        ratio: '1280:720',
      }),
    );

    await vi.advanceTimersByTimeAsync(5_000);
    await generationPromise;
    const [submitUrl, submitInit] = fetchMock.mock.calls[0] as [
      string,
      RequestInit,
    ];
    const submitBody = JSON.parse(String(submitInit.body)) as Record<
      string,
      unknown
    >;

    expect(submitUrl).toBe(
      'https://api.dev.runwayml.com/v1/character_performance',
    );
    expect(submitBody).toMatchObject({
      bodyControl: true,
      character: {
        type: 'image',
        uri: 'https://assets.example.com/character.png',
      },
      expressionIntensity: 4,
      model: 'act_two',
      reference: {
        type: 'video',
        uri: 'https://assets.example.com/reference.mp4',
      },
    });
    expect(submitBody).not.toHaveProperty('promptText');
  });

  it('prepares duration params from form data', async () => {
    const formData = new FormData();

    formData.set('generation_duration', '7');

    await expect(
      prepareRequest(
        createRunwayProvider(),
        formData,
        createRequest({ model: 'runway/gen-4.5', outputFormat: 'mp4' }),
      ),
    ).resolves.toMatchObject({
      request: {
        byokParams: {
          generation_duration: 7,
        },
      },
    });
  });

  it('prepares Semantic Lady params from form data', async () => {
    const formData = new FormData();

    formData.set('generation_moderation', 'true');
    formData.set('generation_reference_tag', 'hero');
    formData.set('generation_seed', '321');

    await expect(
      prepareRequest(
        createRunwayProvider(),
        formData,
        createRequest({ model: 'runway/gen-4-image' }),
      ),
    ).resolves.toMatchObject({
      inputImageLimit: 3,
      request: {
        byokParams: {
          generation_moderation: true,
          generation_reference_tag: 'hero',
          generation_seed: 321,
        },
      },
      inputVideoLimit: 0,
    });
  });

  it('prepares video-to-video input params from form data', async () => {
    const formData = new FormData();

    formData.set(
      'generation_input_video_file',
      'https://assets.example.com/input.mp4',
    );

    await expect(
      prepareRequest(
        createRunwayProvider(),
        formData,
        createRequest({ model: 'runway/aleph-2', outputFormat: 'mp4' }),
      ),
    ).resolves.toMatchObject({
      request: {
        byokParams: {
          generation_input_video_file: ['https://assets.example.com/input.mp4'],
        },
      },
    });
  });

  it('prepares uploaded video placeholders from request params', async () => {
    const formData = new FormData();

    formData.set('generation_input_video_file_source', 'upload');
    formData.set(
      'generation_input_video_file',
      'https://assets.example.com/stale.mp4',
    );

    await expect(
      prepareRequest(
        createRunwayProvider(),
        formData,
        createRequest({
          byokParams: {
            generation_input_video_file: ['https://example.com/input-0'],
          },
          model: 'runway/aleph-2',
          outputFormat: 'mp4',
        }),
      ),
    ).resolves.toMatchObject({
      inputImageLimit: 1,
      request: {
        byokParams: {
          generation_input_video_file: ['https://example.com/input-0'],
        },
      },
      inputVideoLimit: 1,
    });
  });

  it('omits optional empty boolean params from form data', async () => {
    const formData = new FormData();

    formData.set('generation_body_control', '');

    const prepared = await prepareRequest(
      createRunwayProvider(),
      formData,
      createRequest({
        byokParams: {
          generation_input_video_file: ['https://example.com/input-0'],
        },
        model: 'runway/act-two',
        outputFormat: 'mp4',
        ratio: '1280:720',
      }),
    );

    expect(prepared.request.byokParams).not.toHaveProperty(
      'generation_body_control',
    );
  });

  it('resumes polling without resubmitting direct provider work', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 'runway_task_resume',
          output: ['https://assets.example.com/resumed.mp4'],
          status: 'SUCCEEDED',
        }),
        { headers: { 'content-type': 'application/json' }, status: 200 },
      ),
    );
    const onPreSubmit = vi.fn();
    const onStarted = vi.fn();

    vi.stubGlobal('fetch', fetchMock);

    const generationPromise = createRunwayProvider().generate(
      createRequest({
        inputFiles: ['https://assets.example.com/source.png'],
        model: 'runway/gen-4-turbo',
        outputFormat: 'mp4',
        ratio: '1280:720',
      }),
      { onPreSubmit, onStarted, providerGenerationId: 'runway_task_resume' },
    );

    await vi.advanceTimersByTimeAsync(5_000);
    const result = await generationPromise;
    const [pollUrl, pollInit] = fetchMock.mock.calls[0] as [
      string,
      RequestInit,
    ];

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(pollUrl).toBe(
      'https://api.dev.runwayml.com/v1/tasks/runway_task_resume',
    );
    expect(pollInit.method).toBe('GET');
    expect(onPreSubmit).not.toHaveBeenCalled();
    expect(onStarted).toHaveBeenCalledWith(
      expect.objectContaining({
        runway_resumed: true,
        runway_task_id: 'runway_task_resume',
      }),
    );
    expect(result.remoteUrl).toBe('https://assets.example.com/resumed.mp4');
  });

  it('rejects unsupported model input combinations before submit', async () => {
    vi.stubGlobal('fetch', vi.fn());

    await expect(
      createRunwayProvider().generate(
        createRequest({
          model: 'runway/gen-4-turbo',
          outputFormat: 'mp4',
          ratio: '1280:720',
        }),
      ),
    ).rejects.toThrow('generation_input_image_file is required');
  });

  it('detects Runway API keys', () => {
    expect(isRunwayConfigured()).toBe(true);
  });
});

function createRequest(
  overrides: Partial<InferenceRequest> = {},
): InferenceRequest {
  return {
    babyseaSpecificParams: {},
    byokParams: {},
    inputFiles: [],
    model: 'runway/gen-4-image',
    outputFormat: 'png',
    outputNumber: 1,
    prompt: 'A clean regression generation',
    providerOrder: 'fastest',
    ratio: '1024:1024',
    ...overrides,
  };
}

function mockReadyRunwayFetch(taskId: string, outputUrl: string) {
  return vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ id: taskId }), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      }),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: taskId,
          output: [outputUrl],
          status: 'SUCCEEDED',
        }),
        { headers: { 'content-type': 'application/json' }, status: 200 },
      ),
    );
}

async function prepareRequest(
  provider: InferenceProvider,
  formData: FormData,
  request: InferenceRequest,
) {
  if (!provider.prepareRequest) {
    throw new Error('Runway provider does not expose prepareRequest.');
  }

  return await provider.prepareRequest({ formData, request });
}
