import { describe, expect, it } from 'vitest';

import {
  customProviderModels,
  DEEPSEEK_MODELS,
  defaultProviders,
} from '@/shared/db/settings';

// Not a real package boundary crossing — this asserts the API's separately
// maintained copy of the catalog (src-api/src/shared/provider/deepseek-models.ts)
// hasn't drifted from the frontend's, since nothing else enforces that today.
import { DEEPSEEK_MODELS as API_DEEPSEEK_MODELS } from '../../src-api/src/shared/provider/deepseek-models';

describe('DeepSeek model catalog', () => {
  it('uses the current catalog for built-in and custom provider defaults', () => {
    const expectedModels = [
      'deepseek-v4-flash',
      'deepseek-v4-flash-vision-exp',
      'deepseek-v4-pro',
    ];
    const provider = defaultProviders.find(({ id }) => id === 'deepseek');

    expect(DEEPSEEK_MODELS).toEqual(expectedModels);
    expect(provider?.models).toEqual(expectedModels);
    expect(customProviderModels.deepseek).toEqual(expectedModels);
  });

  it('stays in sync with the API catalog', () => {
    expect(API_DEEPSEEK_MODELS).toEqual(DEEPSEEK_MODELS);
  });
});
