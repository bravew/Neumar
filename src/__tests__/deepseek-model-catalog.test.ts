import { describe, expect, it } from 'vitest';

import {
  customProviderModels,
  DEEPSEEK_MODELS,
  defaultProviders,
} from '@/shared/db/settings';

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
});
