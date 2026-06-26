import {
  RUNWAY_MODEL_CONFIGS,
  hasRunwayModelConfig,
  type RunwayModelId,
} from './family';

export { RUNWAY_MODEL_CONFIGS, type RunwayModelConfig } from './family';

export function resolveRunwayModelConfig(model: string) {
  if (!hasRunwayModelConfig(model)) {
    throw new Error(`Runway does not support model ${model}.`);
  }

  return RUNWAY_MODEL_CONFIGS[model];
}

export function resolveRunwayProviderModel(model: RunwayModelId) {
  return resolveRunwayModelConfig(model).providerModel;
}
