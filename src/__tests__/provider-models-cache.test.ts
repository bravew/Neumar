import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildModelOptions } from '@/components/shared/ChatInput.types';
import type { AIProvider } from '@/shared/db/settings';
import {
  clearProviderModelsCache,
  getProviderModelsCacheKey,
  PROVIDER_MODELS_CACHE_TTL_MS,
  readProviderModelsCache,
  subscribeProviderModelsCache,
  writeProviderModelsCache,
} from '@/shared/lib/provider-models-cache';

describe('provider models cache', () => {
  afterEach(() => {
    clearProviderModelsCache();
  });

  it('protects auth material in cache keys and expires stale entries', () => {
    const key = getProviderModelsCacheKey(providerFixture);

    expect(key).not.toContain(providerFixture.apiKey!);

    writeProviderModelsCache(
      providerFixture,
      { models: [{ id: 'openai/gpt-4o-mini' }] },
      1000,
    );

    expect(readProviderModelsCache(providerFixture, 1000)).toMatchObject({
      models: [{ id: 'openai/gpt-4o-mini' }],
    });
    expect(
      readProviderModelsCache(
        providerFixture,
        1000 + PROVIDER_MODELS_CACHE_TTL_MS + 1,
      ),
    ).toBeNull();
  });

  it('notifies subscribers when fetched models are cached', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeProviderModelsCache(listener);

    writeProviderModelsCache(providerFixture, {
      models: [{ id: 'openai/gpt-4o-mini' }],
    });

    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
  });

  it('separates caches for different provider dialects', () => {
    const standardKey = getProviderModelsCacheKey(providerFixture);
    const kimiKey = getProviderModelsCacheKey({
      ...providerFixture,
      dialect: 'kimi-k3',
    });
    expect(kimiKey).not.toBe(standardKey);
  });

  it('prefers fresh fetched provider models over static settings models', () => {
    writeProviderModelsCache(providerFixture, {
      models: [
        {
          id: 'openai/gpt-4o-mini',
          displayLabel: 'GPT-4o mini',
        },
      ],
    });

    const options = buildModelOptions({}, [providerFixture]);

    expect(options.map((option) => option.id)).toEqual(['openai/gpt-4o-mini']);
    expect(options[0]).toMatchObject({
      label: 'GPT-4o mini',
      description: 'OpenRouter',
    });
  });

  it('keeps distinct model IDs visible when a provider has several models', () => {
    const deepSeekProvider = {
      id: 'deepseek',
      name: 'DeepSeek',
      apiKey: 'sk-secret-deepseek-key',
      baseUrl: 'https://api.deepseek.com/v1',
      enabled: true,
      models: ['deepseek-v4-flash', 'deepseek-v4-pro'],
      agentType: 'openai-compat',
    } satisfies AIProvider;

    expect(
      buildModelOptions({}, [deepSeekProvider]).map(({ id, label }) => ({
        id,
        label,
      })),
    ).toEqual([
      { id: 'deepseek-v4-flash', label: 'deepseek-v4-flash' },
      { id: 'deepseek-v4-pro', label: 'deepseek-v4-pro' },
    ]);
  });
});

const providerFixture = {
  id: 'openrouter',
  name: 'OpenRouter',
  apiKey: 'sk-secret-openrouter-key',
  baseUrl: 'https://openrouter.ai/api/v1',
  enabled: true,
  models: ['static-model'],
  agentType: 'openai-compat',
} satisfies AIProvider;
