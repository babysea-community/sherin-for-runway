import {
  getModel as getSemanticLadyModel,
  type SemanticLadyField,
  type SemanticLadyModel,
} from 'semantic-lady';

export const RUNWAY_PROVIDER_ID = 'runway' as const;
export const RUNWAY_PROVIDER_LABEL = 'Runway';
export const RUNWAY_PROVIDER_KEYWORD = 'runway';

export const RUNWAY_MODEL_OPTIONS = [
  { id: 'runway/act-two', label: 'Runway Act Two' },
  { id: 'runway/aleph-2', label: 'Runway Aleph 2' },
  { id: 'runway/gen-4.5', label: 'Runway Gen-4.5' },
  { id: 'runway/gen-4-aleph', label: 'Runway Gen-4 Aleph' },
  { id: 'runway/gen-4-image', label: 'Runway Gen-4 Image' },
  { id: 'runway/gen-4-image-turbo', label: 'Runway Gen-4 Image Turbo' },
  { id: 'runway/gen-4-turbo', label: 'Runway Gen-4 Turbo' },
] as const;

export type RunwayModelId = (typeof RUNWAY_MODEL_OPTIONS)[number]['id'];

export const RUNWAY_MODEL_IDS = RUNWAY_MODEL_OPTIONS.map(
  (model) => model.id,
) as [RunwayModelId, ...RunwayModelId[]];

export const RUNWAY_DEFAULT_MODEL_ID: RunwayModelId = 'runway/gen-4-image';
export const RUNWAY_MODEL_ID_PREFIX = `${RUNWAY_PROVIDER_ID}/`;

export const RUNWAY_DIMENSION_RATIOS = {
  '1024:1024': { width: 1024, height: 1024 },
  '1080:1080': { width: 1080, height: 1080 },
  '1168:880': { width: 1168, height: 880 },
  '1360:768': { width: 1360, height: 768 },
  '1440:1080': { width: 1440, height: 1080 },
  '1080:1440': { width: 1080, height: 1440 },
  '1808:768': { width: 1808, height: 768 },
  '1920:1080': { width: 1920, height: 1080 },
  '1080:1920': { width: 1080, height: 1920 },
  '2112:912': { width: 2112, height: 912 },
  '1280:720': { width: 1280, height: 720 },
  '720:1280': { width: 720, height: 1280 },
  '720:720': { width: 720, height: 720 },
  '960:720': { width: 960, height: 720 },
  '720:960': { width: 720, height: 960 },
  '1680:720': { width: 1680, height: 720 },
  '1104:832': { width: 1104, height: 832 },
  '832:1104': { width: 832, height: 1104 },
  '1584:672': { width: 1584, height: 672 },
  '848:480': { width: 848, height: 480 },
  '640:480': { width: 640, height: 480 },
  '1:1': { width: 1024, height: 1024 },
  '3:4': { width: 832, height: 1104 },
  '4:3': { width: 1104, height: 832 },
  '9:16': { width: 720, height: 1280 },
  '16:9': { width: 1280, height: 720 },
  '21:9': { width: 1584, height: 672 },
} as const satisfies Record<string, { width: number; height: number }>;

export type RunwayDimensionRatio = keyof typeof RUNWAY_DIMENSION_RATIOS;
export type RunwayRatio = string;
export type RunwayOutputFormat = 'mp4' | 'png';

export const RUNWAY_RATIO_OPTIONS = Object.keys(
  RUNWAY_DIMENSION_RATIOS,
) as RunwayDimensionRatio[];
export const RUNWAY_OUTPUT_FORMATS = ['png', 'mp4'] as const;
export const RUNWAY_DEFAULT_RATIO = '1024:1024';
export const RUNWAY_DEFAULT_OUTPUT_FORMAT: RunwayOutputFormat = 'png';
export const RUNWAY_RESOLUTION_OPTIONS = [] as const;
export type RunwayResolution = (typeof RUNWAY_RESOLUTION_OPTIONS)[number];

export type RunwayModelConfig = {
  providerModel: string;
  kind: 'image' | 'video';
  workflows: readonly string[];
  inputFileLimit: number;
  requiresImageInput: boolean;
  supportsImageInput: boolean;
  videoInputFileLimit: number;
  requiresVideoInput: boolean;
  supportsVideoInput: boolean;
  outputFormats: readonly RunwayOutputFormat[];
  outputContentType: 'image/png' | 'video/mp4';
  ratios: readonly string[];
  defaultRatio: string;
  resolutions: readonly string[];
  defaultResolution?: string;
  duration?: {
    defaultValue: number;
    max: number;
    min: number;
    required: boolean;
  };
  promptSupported: boolean;
  promptRequired: boolean;
  supportsModeration: boolean;
  seed?: {
    max: number;
    min: number;
  };
};

export type RunwayBabySeaModelConfig = {
  identifier: RunwayModelId;
  inputFileLimit: number;
  outputFormatMap: Partial<Record<string, string>>;
  providerOrderOptions?: readonly string[];
};

export const RUNWAY_MODEL_CONFIGS = Object.fromEntries(
  RUNWAY_MODEL_IDS.map((model) => [model, createRunwayModelConfig(model)]),
) as Record<RunwayModelId, RunwayModelConfig>;

export const RUNWAY_BABYSEA_MODEL_CONFIGS = Object.fromEntries(
  RUNWAY_MODEL_IDS.map((model) => [
    model,
    createRunwayBabySeaModelConfig(model),
  ]),
) as Record<RunwayModelId, RunwayBabySeaModelConfig>;

export function hasRunwayModelConfig(model: string): model is RunwayModelId {
  return model in RUNWAY_MODEL_CONFIGS;
}

export function getRunwaySemanticModel(
  modelIdentifier: RunwayModelId,
): SemanticLadyModel {
  const model = getSemanticLadyModel(modelIdentifier);

  if (!model || model.provider !== RUNWAY_PROVIDER_ID) {
    throw new Error(
      `Semantic Lady does not define Runway model ${modelIdentifier}.`,
    );
  }

  return model;
}

function createRunwayBabySeaModelConfig(
  model: RunwayModelId,
): RunwayBabySeaModelConfig {
  const config = RUNWAY_MODEL_CONFIGS[model];

  return {
    identifier: model,
    inputFileLimit: Math.max(config.inputFileLimit, config.videoInputFileLimit),
    outputFormatMap: {},
  };
}

function createRunwayModelConfig(model: RunwayModelId): RunwayModelConfig {
  const semanticModel = getRunwaySemanticModel(model);
  const aspectRatio = getField(semanticModel, 'generation_aspect_ratio');
  const duration = getField(semanticModel, 'generation_duration');
  const seed = getField(semanticModel, 'generation_seed');
  const imageInput = getField(semanticModel, 'generation_input_image_file');
  const videoInput = getField(semanticModel, 'generation_input_video_file');
  const outputFormat = semanticModel.kind === 'video' ? 'mp4' : 'png';
  const ratios = enumStrings(aspectRatio);

  return {
    providerModel: semanticModel.providerModel,
    kind: semanticModel.kind,
    workflows: semanticModel.workflows,
    inputFileLimit: imageInput ? imageInputLimit(model) : 0,
    requiresImageInput: Boolean(imageInput?.required),
    supportsImageInput: Boolean(imageInput),
    videoInputFileLimit: videoInput ? 1 : 0,
    requiresVideoInput: Boolean(videoInput?.required),
    supportsVideoInput: Boolean(videoInput),
    outputFormats: [outputFormat],
    outputContentType:
      semanticModel.kind === 'video' ? 'video/mp4' : 'image/png',
    ratios,
    defaultRatio:
      stringDefault(aspectRatio) ?? ratios[0] ?? RUNWAY_DEFAULT_RATIO,
    resolutions: [],
    duration: duration
      ? {
          defaultValue:
            numberDefault(duration) ?? clampDurationDefault(duration),
          max: numberBound(duration.max, 10),
          min: numberBound(duration.min, 2),
          required: Boolean(duration.required),
        }
      : undefined,
    promptSupported: Boolean(getField(semanticModel, 'generation_prompt')),
    promptRequired: Boolean(
      getField(semanticModel, 'generation_prompt')?.required,
    ),
    supportsModeration: Boolean(
      getField(semanticModel, 'generation_moderation'),
    ),
    seed: seed
      ? {
          max: numberBound(seed.max, 4_294_967_295),
          min: numberBound(seed.min, 0),
        }
      : undefined,
  };
}

function imageInputLimit(model: RunwayModelId) {
  if (model === 'runway/act-two') {
    return 1;
  }

  if (model === 'runway/gen-4-image' || model === 'runway/gen-4-image-turbo') {
    return 3;
  }

  return 1;
}

function getField(model: SemanticLadyModel, name: string) {
  return model.schema.find((field) => field.name === name);
}

function enumStrings(field: SemanticLadyField | undefined) {
  return (field?.enum ?? []).filter(
    (value): value is string => typeof value === 'string',
  );
}

function stringDefault(field: SemanticLadyField | undefined) {
  return typeof field?.default === 'string' ? field.default : undefined;
}

function numberDefault(field: SemanticLadyField | undefined) {
  return typeof field?.default === 'number' ? field.default : undefined;
}

function numberBound(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clampDurationDefault(field: SemanticLadyField) {
  const min = numberBound(field.min, 2);
  const max = numberBound(field.max, 10);

  return Math.min(Math.max(5, min), max);
}
