import { describe, expect, it } from 'vitest';

import {
  BYOK_INFERENCE_PROVIDER_ID,
  BYOK_INFERENCE_PROVIDER_LABEL,
  DEFAULT_MODEL_ID,
  MODEL_IDS,
  MODEL_OPTIONS,
  getDefaultModelIdForInferenceProvider,
  getModelIdsForInferenceProvider,
  getModelOptionsForInferenceProvider,
} from '@/lib/app-config';
import { resolveBabySeaModelIdentifier } from '@/lib/inference/babysea/models';
import {
  resolveRunwayModelConfig,
  resolveRunwayProviderModel,
} from '@/lib/inference/runway/models';

const RUNWAY_MODEL_EXPECTATIONS = [
  {
    id: 'runway/gen-4-image',
    label: 'Runway Gen-4 Image',
    providerModel: 'gen4_image',
  },
  {
    id: 'runway/gen-4-image-turbo',
    label: 'Runway Gen-4 Image Turbo',
    providerModel: 'gen4_image_turbo',
  },
  { id: 'runway/act-two', label: 'Runway Act Two', providerModel: 'act_two' },
  { id: 'runway/aleph-2', label: 'Runway Aleph 2', providerModel: 'aleph2' },
  { id: 'runway/gen-4.5', label: 'Runway Gen-4.5', providerModel: 'gen4.5' },
  {
    id: 'runway/gen-4-aleph',
    label: 'Runway Gen-4 Aleph',
    providerModel: 'gen4_aleph',
  },
  {
    id: 'runway/gen-4-turbo',
    label: 'Runway Gen-4 Turbo',
    providerModel: 'gen4_turbo',
  },
] as const;

describe('App model registry', () => {
  it('derives provider model options from the central registry', () => {
    expect(BYOK_INFERENCE_PROVIDER_ID).toBe('runway');
    expect(BYOK_INFERENCE_PROVIDER_LABEL).toBe('Runway');
    expect(getModelOptionsForInferenceProvider('babysea')).toEqual(
      MODEL_OPTIONS,
    );
    expect(getModelIdsForInferenceProvider('babysea')).toEqual(MODEL_IDS);
    expect(getModelIdsForInferenceProvider('runway')).toEqual(MODEL_IDS);
    expect(getDefaultModelIdForInferenceProvider('babysea')).toBe(
      DEFAULT_MODEL_ID,
    );
    expect(getDefaultModelIdForInferenceProvider('runway')).toBe(
      DEFAULT_MODEL_ID,
    );
  });

  it('registers Runway models across the Studio providers', () => {
    expect(MODEL_IDS).toEqual(
      RUNWAY_MODEL_EXPECTATIONS.map((model) => model.id),
    );

    for (const model of RUNWAY_MODEL_EXPECTATIONS) {
      expect(MODEL_OPTIONS.find((option) => option.id === model.id)).toEqual({
        id: model.id,
        label: model.label,
      });
      expect(resolveBabySeaModelIdentifier(model.id)).toBe(model.id);
      expect(resolveRunwayProviderModel(model.id)).toBe(model.providerModel);
    }
  });

  it('keeps image models on PNG output and video models on MP4 output', () => {
    expect(resolveRunwayModelConfig('runway/gen-4-image')).toMatchObject({
      kind: 'image',
      outputContentType: 'image/png',
      outputFormats: ['png'],
    });
    expect(resolveRunwayModelConfig('runway/gen-4-turbo')).toMatchObject({
      kind: 'video',
      outputContentType: 'video/mp4',
      outputFormats: ['mp4'],
      requiresImageInput: true,
    });
    expect(resolveRunwayModelConfig('runway/aleph-2')).toMatchObject({
      kind: 'video',
      outputContentType: 'video/mp4',
      outputFormats: ['mp4'],
      requiresVideoInput: true,
    });
    expect(resolveRunwayModelConfig('runway/act-two')).toMatchObject({
      kind: 'video',
      outputContentType: 'video/mp4',
      outputFormats: ['mp4'],
      promptSupported: false,
      requiresVideoInput: true,
    });
  });
});
