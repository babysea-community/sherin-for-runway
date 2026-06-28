import {
  getModel as getSemanticLadyModel,
  type SemanticLadyField,
  type SemanticLadyModel,
} from 'semantic-lady';

const MODEL_LABEL_COLLATOR = new Intl.Collator('en', {
  ignorePunctuation: true,
  numeric: true,
  sensitivity: 'base',
});

export const RUNWAY_PROVIDER_ID = 'runway' as const;
export const RUNWAY_PROVIDER_LABEL = 'Runway';
export const RUNWAY_PROVIDER_KEYWORD = 'runway';

const RUNWAY_MODEL_OPTION_VALUES = [
  { id: 'runway/act-two', label: 'Runway Act Two' },
  { id: 'runway/aleph-2', label: 'Runway Aleph 2' },
  { id: 'runway/gen-4.5', label: 'Runway Gen-4.5' },
  { id: 'runway/gen-4-aleph', label: 'Runway Gen-4 Aleph' },
  { id: 'runway/gen-4-image', label: 'Runway Gen-4 Image' },
  { id: 'runway/gen-4-image-turbo', label: 'Runway Gen-4 Image Turbo' },
  { id: 'runway/gen-4-turbo', label: 'Runway Gen-4 Turbo' },
] as const;

export type RunwayModelId = (typeof RUNWAY_MODEL_OPTION_VALUES)[number]['id'];

type RunwayModelOption = {
  readonly id: RunwayModelId;
  readonly label: string;
};

export const RUNWAY_MODEL_OPTIONS = [...RUNWAY_MODEL_OPTION_VALUES].sort(
  compareRunwayModelOptions,
) as RunwayModelOption[];

export const RUNWAY_MODEL_IDS = RUNWAY_MODEL_OPTIONS.map(
  (model) => model.id,
) as [RunwayModelId, ...RunwayModelId[]];

export const RUNWAY_DEFAULT_MODEL_ID: RunwayModelId = 'runway/gen-4-image';
export const RUNWAY_MODEL_ID_PREFIX = `${RUNWAY_PROVIDER_ID}/`;

export type RunwayDimensionRatio = string;
export type RunwayRatio = string;
export type RunwayOutputFormat = 'mp4' | 'png';

export const RUNWAY_RATIO_OPTIONS = uniqueStrings(
  RUNWAY_MODEL_IDS.flatMap((model) =>
    enumStrings(
      getField(getRunwaySemanticModel(model), 'generation_aspect_ratio'),
    ),
  ),
);
export const RUNWAY_OUTPUT_FORMATS = ['png', 'mp4'] as const;
export const RUNWAY_DEFAULT_RATIO = '1024:1024';
export const RUNWAY_DEFAULT_OUTPUT_FORMAT: RunwayOutputFormat = 'png';
export const RUNWAY_RESOLUTION_OPTIONS = [] as const;
export type RunwayResolution = (typeof RUNWAY_RESOLUTION_OPTIONS)[number];

export type RunwayModelConfig = {
  providerModel: string;
  schema: readonly SemanticLadyField[];
  kind: 'image' | 'video';
  workflows: readonly string[];
  inputImageLimit: number;
  requiresImageInput: boolean;
  supportsImageInput: boolean;
  inputVideoLimit: number;
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
  inputMediaLimit: number;
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

export const SHERIN_BYOK_FAMILY = {
  babySeaModelConfigs: RUNWAY_BABYSEA_MODEL_CONFIGS,
  defaultGenerationGuidance: 5,
  defaultGenerationSteps: 50,
  defaultModelId: RUNWAY_DEFAULT_MODEL_ID,
  defaultOutputFormat: RUNWAY_DEFAULT_OUTPUT_FORMAT,
  defaultRatio: RUNWAY_DEFAULT_RATIO,
  defaultResolution: undefined,
  defaultSafetyTolerance: 2,
  modelConfigs: RUNWAY_MODEL_CONFIGS,
  modelIdPrefix: RUNWAY_MODEL_ID_PREFIX,
  modelIds: RUNWAY_MODEL_IDS,
  modelOptions: RUNWAY_MODEL_OPTIONS,
  outputFormats: RUNWAY_OUTPUT_FORMATS,
  providerId: RUNWAY_PROVIDER_ID,
  providerKeyword: RUNWAY_PROVIDER_KEYWORD,
  providerLabel: RUNWAY_PROVIDER_LABEL,
  ratioOptions: RUNWAY_RATIO_OPTIONS,
  resolutionOptions: RUNWAY_RESOLUTION_OPTIONS,
} as const;

export function hasRunwayModelConfig(model: string): model is RunwayModelId {
  return model in RUNWAY_MODEL_CONFIGS;
}

export const hasProviderModelConfig = hasRunwayModelConfig;

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

function compareRunwayModelOptions(
  left: RunwayModelOption,
  right: RunwayModelOption,
) {
  return (
    modelKindRank(getRunwaySemanticModel(left.id).kind) -
      modelKindRank(getRunwaySemanticModel(right.id).kind) ||
    MODEL_LABEL_COLLATOR.compare(left.label, right.label) ||
    MODEL_LABEL_COLLATOR.compare(left.id, right.id)
  );
}

function modelKindRank(kind: SemanticLadyModel['kind']) {
  return kind === 'image' ? 0 : 1;
}

function createRunwayBabySeaModelConfig(
  model: RunwayModelId,
): RunwayBabySeaModelConfig {
  const config = RUNWAY_MODEL_CONFIGS[model];

  return {
    identifier: model,
    inputMediaLimit: Math.max(config.inputImageLimit, config.inputVideoLimit),
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
  const inputImageLimit = imageInput ? imageInputLimit(model) : 0;
  const inputVideoLimit = videoInput ? 1 : 0;
  const outputFormat = semanticModel.kind === 'video' ? 'mp4' : 'png';
  const ratios = enumStrings(aspectRatio);

  return {
    providerModel: semanticModel.providerModel,
    schema: semanticModel.schema,
    kind: semanticModel.kind,
    workflows: semanticModel.workflows,
    inputImageLimit,
    requiresImageInput: Boolean(imageInput?.required),
    supportsImageInput: Boolean(imageInput),
    inputVideoLimit,
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

function uniqueStrings(values: string[]) {
  return [...new Set(values)];
}

function clampDurationDefault(field: SemanticLadyField) {
  const min = numberBound(field.min, 2);
  const max = numberBound(field.max, 10);

  return Math.min(Math.max(5, min), max);
}
