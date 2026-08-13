/**
 * Lightweight LLM caller for server-side one-shot calls (soul auto-structure, etc.).
 *
 * Supports both Anthropic-native and OpenAI-compatible providers.
 * Resolves API credentials from the provider manager or environment variables.
 */

import { createLogger } from '@/shared/utils/logger';
import {
  alternateOpenAICompatTokenParam,
  resolveOpenAICompatTokenParam,
  shouldRetryOpenAICompatTokenParam,
  type OpenAICompatTokenParam,
} from '@/shared/utils/openai-token-params';
import {
  getAuthHeader,
  getProviderHeaders,
} from '@/shared/utils/provider-headers';
import {
  getFastModelForProvider,
  isAnthropicNative,
  resolveApiCredentials,
} from '@/shared/utils/provider-resolution';

const logger = createLogger('LLM');

const DEFAULT_ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001';
const DEFAULT_MAX_TOKENS = 1024;

interface LLMCallerOptions {
  model?: string;
  maxTokens?: number;
}

/**
 * Build a one-shot LLM caller function.
 * Auto-detects Anthropic-native vs OpenAI-compatible based on the resolved base URL.
 * Returns empty string if no API key is configured or the call fails.
 */
export function buildLightweightLLMCaller(
  options?: LLMCallerOptions,
): (prompt: string) => Promise<string> {
  const maxTokens = options?.maxTokens ?? DEFAULT_MAX_TOKENS;

  return async (prompt: string): Promise<string> => {
    const creds = resolveApiCredentials();
    if (!creds.apiKey) {
      logger.warn('No API key configured for lightweight LLM call');
      return '';
    }

    const baseUrl = creds.baseUrl || 'https://api.anthropic.com';

    try {
      if (isAnthropicNative(baseUrl)) {
        return await callAnthropic(
          baseUrl,
          creds.apiKey,
          options?.model ?? DEFAULT_ANTHROPIC_MODEL,
          maxTokens,
          prompt,
        );
      }
      return await callOpenAICompat(
        baseUrl,
        creds.apiKey,
        options?.model ?? getFastModelForProvider(baseUrl, creds.model),
        maxTokens,
        prompt,
      );
    } catch (err) {
      logger.debug(`LLM call error: ${err}`);
      return '';
    }
  };
}

async function callAnthropic(
  baseUrl: string,
  apiKey: string,
  model: string,
  maxTokens: number,
  prompt: string,
): Promise<string> {
  const res = await fetch(`${baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) {
    logger.debug(`Anthropic call failed: ${res.status}`);
    return '';
  }
  const data = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };
  return data.content?.find((b) => b.type === 'text')?.text ?? '';
}

async function callOpenAICompat(
  baseUrl: string,
  apiKey: string,
  model: string,
  maxTokens: number,
  prompt: string,
): Promise<string> {
  const url = baseUrl.replace(/\/+$/, '') + '/chat/completions';
  const headers = {
    'Content-Type': 'application/json',
    ...getAuthHeader(baseUrl, apiKey),
    ...getProviderHeaders(baseUrl, apiKey),
  };
  const tokenParam = resolveOpenAICompatTokenParam(baseUrl, model);
  let res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(
      buildOpenAICompatBody(model, maxTokens, prompt, tokenParam),
    ),
  });
  if (res.status === 400) {
    const errorBody = await res.text().catch(() => '');
    const fallbackParam = alternateOpenAICompatTokenParam(tokenParam);
    if (shouldRetryOpenAICompatTokenParam(errorBody, fallbackParam)) {
      const retryStart = Date.now();
      res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(
          buildOpenAICompatBody(model, maxTokens, prompt, fallbackParam),
        ),
      });
      logger.warn('token_param_fallback_retry', {
        model,
        from: tokenParam,
        to: fallbackParam,
        latencyMs: Date.now() - retryStart,
      });
    }
  }
  if (!res.ok) {
    logger.debug(`OpenAI-compat call failed: ${res.status}`);
    return '';
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content ?? '';
}

function buildOpenAICompatBody(
  model: string,
  maxTokens: number,
  prompt: string,
  tokenParam: OpenAICompatTokenParam,
): Record<string, unknown> {
  return {
    model,
    [tokenParam]: maxTokens,
    messages: [{ role: 'user', content: prompt }],
  };
}
