/**
 * Sherin model-family registry facade.
 *
 * Provider-specific model catalogs live beside their direct provider adapter
 * (for this variant: `lib/inference/runway/family.ts`). When cloning Sherin for
 * a new provider family, keep this facade stable and swap the provider family
 * imports plus the direct provider shim.
 */
import {
  RUNWAY_BABYSEA_MODEL_CONFIGS,
  RUNWAY_DEFAULT_MODEL_ID,
  RUNWAY_DEFAULT_OUTPUT_FORMAT,
  RUNWAY_DEFAULT_RATIO,
  RUNWAY_DIMENSION_RATIOS,
  RUNWAY_MODEL_CONFIGS,
  RUNWAY_MODEL_ID_PREFIX,
  RUNWAY_MODEL_IDS,
  RUNWAY_MODEL_OPTIONS,
  RUNWAY_PROVIDER_ID,
  RUNWAY_PROVIDER_KEYWORD,
  RUNWAY_PROVIDER_LABEL,
  RUNWAY_RATIO_OPTIONS,
  RUNWAY_RESOLUTION_OPTIONS,
  hasRunwayModelConfig,
  type RunwayDimensionRatio,
  type RunwayOutputFormat,
  type RunwayRatio,
  type RunwayResolution,
} from './inference/runway/family';

export {
  RUNWAY_BABYSEA_MODEL_CONFIGS,
  RUNWAY_MODEL_CONFIGS,
  RUNWAY_MODEL_IDS,
  hasRunwayModelConfig,
  type RunwayModelConfig,
} from './inference/runway/family';

export const MODEL_OPTIONS = RUNWAY_MODEL_OPTIONS;
export type SherinModelId = (typeof MODEL_OPTIONS)[number]['id'];

export const MODEL_IDS = RUNWAY_MODEL_IDS as [
  SherinModelId,
  ...SherinModelId[],
];

export const DEFAULT_MODEL_ID: SherinModelId = RUNWAY_DEFAULT_MODEL_ID;
export const BYOK_INFERENCE_PROVIDER_ID = RUNWAY_PROVIDER_ID;
export const BYOK_INFERENCE_PROVIDER_LABEL = RUNWAY_PROVIDER_LABEL;
export const BYOK_INFERENCE_PROVIDER_KEYWORD = RUNWAY_PROVIDER_KEYWORD;
export const BYOK_MODEL_ID_PREFIX = RUNWAY_MODEL_ID_PREFIX;
export type ByokInferenceProviderId = typeof BYOK_INFERENCE_PROVIDER_ID;

export function isSherinModelId(value: unknown): value is SherinModelId {
  return (
    typeof value === 'string' && MODEL_IDS.includes(value as SherinModelId)
  );
}

export const RATIOS = RUNWAY_DIMENSION_RATIOS;
export type SherinDimensionRatio = RunwayDimensionRatio;
export const RATIO_OPTIONS = RUNWAY_RATIO_OPTIONS;
export type SherinRatio = RunwayRatio;

export const OUTPUT_FORMATS = ['png', 'mp4'] as const;
export type SherinOutputFormat = RunwayOutputFormat;

export const DEFAULT_RATIO = RUNWAY_DEFAULT_RATIO;
export const DEFAULT_OUTPUT_FORMAT: SherinOutputFormat =
  RUNWAY_DEFAULT_OUTPUT_FORMAT;
export const RESOLUTION_OPTIONS = RUNWAY_RESOLUTION_OPTIONS;
export type SherinResolution = RunwayResolution;
export const DEFAULT_RESOLUTION: SherinResolution | undefined = undefined;
export const GENERATION_PROMPT_PLACEHOLDER =
  'A cinematic camera move through soft morning light...';

export const DEFAULT_GENERATION_OUTPUT_NUMBER = 1;
export const DEFAULT_GENERATION_OUTPUT_QUALITY = 80;
export const DEFAULT_GENERATION_GUIDANCE_SCALE = 3.5;
export const DEFAULT_GENERATION_NUM_INFERENCE_STEPS = 28;
export const DEFAULT_BYOK_GUIDANCE = 5;
export const DEFAULT_BYOK_STEPS = 50;
export const DEFAULT_BYOK_SAFETY_TOLERANCE = 2;

export const BYOK_MODEL_CONFIGS = RUNWAY_MODEL_CONFIGS;
export const BYOK_MODEL_IDS = RUNWAY_MODEL_IDS;

export type BabySeaModelConfig =
  (typeof RUNWAY_BABYSEA_MODEL_CONFIGS)[SherinModelId];

export const BABYSEA_MODEL_CONFIGS = RUNWAY_BABYSEA_MODEL_CONFIGS;

export const SHERIN_INPUT_FILE_LIMIT = Math.max(
  ...Object.values(BYOK_MODEL_CONFIGS).map((model) => model.inputFileLimit),
  ...Object.values(BABYSEA_MODEL_CONFIGS).map((model) => model.inputFileLimit),
);

export type InferenceProviderScope = 'babysea' | ByokInferenceProviderId | null;

export function hasByokModelConfig(
  model: SherinModelId,
): model is keyof typeof BYOK_MODEL_CONFIGS & SherinModelId {
  return hasRunwayModelConfig(model);
}

export function getModelOptionsForInferenceProvider(
  providerId: InferenceProviderScope,
) {
  if (providerId === BYOK_INFERENCE_PROVIDER_ID) {
    const byokModelIds = new Set<SherinModelId>(BYOK_MODEL_IDS);

    return MODEL_OPTIONS.filter((option) => byokModelIds.has(option.id));
  }

  return MODEL_OPTIONS;
}

export function getModelIdsForInferenceProvider(
  providerId: InferenceProviderScope,
) {
  return getModelOptionsForInferenceProvider(providerId).map(
    (option) => option.id,
  );
}

export function getDefaultModelIdForInferenceProvider(
  providerId: InferenceProviderScope,
) {
  if (
    providerId === BYOK_INFERENCE_PROVIDER_ID &&
    !hasByokModelConfig(DEFAULT_MODEL_ID)
  ) {
    return BYOK_MODEL_IDS[0] ?? DEFAULT_MODEL_ID;
  }

  return DEFAULT_MODEL_ID;
}

export function getBabySeaInputFileLimit(model: SherinModelId) {
  return BABYSEA_MODEL_CONFIGS[model].inputFileLimit;
}

export function getBabySeaProviderOrderOverride(modelIdentifier: string) {
  return Object.values(BABYSEA_MODEL_CONFIGS).find(
    (model) => model.identifier === modelIdentifier,
  )?.providerOrderOptions;
}

export function isSherinResolution(
  value: string | undefined,
): value is SherinResolution {
  return RESOLUTION_OPTIONS.includes(value as SherinResolution);
}
