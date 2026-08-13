import { describe, expect, it } from 'vitest';

import {
  modelRequiresMaxCompletionTokens,
  resolveOpenAICompatTokenParam,
} from '@/shared/utils/openai-token-params';

describe('resolveOpenAICompatTokenParam', () => {
  it('uses max_completion_tokens for native OpenAI and Azure endpoints', () => {
    expect(
      resolveOpenAICompatTokenParam('https://api.openai.com/v1', 'gpt-4o-mini'),
    ).toBe('max_completion_tokens');
    expect(
      resolveOpenAICompatTokenParam(
        'https://team.openai.azure.com/openai/deployments/demo',
        'gpt-4o-mini',
      ),
    ).toBe('max_completion_tokens');
  });

  it('defaults unknown OpenAI-compatible proxy hosts to max_tokens', () => {
    expect(
      resolveOpenAICompatTokenParam(
        'https://proxy.example/v1',
        'custom-chat-model',
      ),
    ).toBe('max_tokens');
  });

  it('uses max_completion_tokens for known reasoning families through proxies', () => {
    expect(modelRequiresMaxCompletionTokens('openai/o3-mini')).toBe(true);
    expect(modelRequiresMaxCompletionTokens('gpt-5.4-nano')).toBe(true);
    expect(
      resolveOpenAICompatTokenParam(
        'https://openrouter.ai/api/v1',
        'openai/o3-mini',
      ),
    ).toBe('max_completion_tokens');
  });
});
