/**
 * Provider Resolution Utilities
 *
 * Shared helpers for resolving API credentials, detecting provider types,
 * and selecting fast/cheap models. Used by title-generator, skill-extractor,
 * and any other service that makes lightweight LLM calls.
 */

import { getProviderManager } from '@/shared/provider/manager';

// ============================================================================
// Constants
// ============================================================================

/** Known Anthropic-native API base URLs (use x-api-key + /v1/messages format) */
const ANTHROPIC_NATIVE_PATTERNS = ['api.anthropic.com'];

/** Well-known providers where we know the best fast/cheap model */
export const FAST_MODEL_MAP: Record<string, string> = {
  'openrouter.ai': 'openai/gpt-4o-mini',
  'api.openai.com': 'gpt-5.4-nano',
  'api.groq.com': 'llama-3.1-8b-instant',
  'generativelanguage.googleapis.com': 'gemini-3.1-flash-lite',
  'api.deepseek.com': 'deepseek-chat',
  'api.x.ai': 'grok-4-1-fast-non-reasoning',
  'api.together.xyz': 'meta-llama/Llama-3.3-8B-Instruct-Turbo',
  'api.fireworks.ai': 'accounts/fireworks/models/llama-v3p3-8b-instruct',
  'api.cerebras.ai': 'llama-3.1-8b',
  'api.sambanova.ai': 'Meta-Llama-3.1-8B-Instruct',
  'api.perplexity.ai': 'sonar',
  'api.deepinfra.com': 'meta-llama/Llama-3.3-8B-Instruct',
  'api.mistral.ai': 'mistral-small-latest',
  '.openai.azure.com': 'gpt-4o-mini',
  '.services.ai.azure.com': 'gpt-4o-mini',
  'bedrock-mantle.': 'mistral.ministral-3-3b-instruct',
};

/** Paid fallback when a free model is rejected by the provider's data policy */
export const FREE_MODEL_FALLBACK: Record<string, string> = {
  'openrouter.ai': 'openai/gpt-4o-mini',
};

// ============================================================================
// Types
// ============================================================================

/** Response shape from OpenAI Chat Completions API */
export interface OpenAIResponse {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message: string };
}

// ============================================================================
// Functions
// ============================================================================

/**
 * Check if a base URL points to the native Anthropic API.
 * Everything else (custom proxies, OpenRouter, OpenAI, etc.) uses
 * the OpenAI-compatible chat/completions format with Bearer auth.
 */
export function isAnthropicNative(baseUrl?: string): boolean {
  if (!baseUrl) return true; // no URL = default Anthropic endpoint
  const lower = baseUrl.toLowerCase();
  return ANTHROPIC_NATIVE_PATTERNS.some((pattern) => lower.includes(pattern));
}

/**
 * Resolve provider config from the provider manager (user's model routing).
 */
export function getProviderConfig(): {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
} {
  try {
    const config = getProviderManager().getConfig();
    const agentConfig = config.agent?.config;
    if (agentConfig && (agentConfig.apiKey || agentConfig.model)) {
      return agentConfig as {
        apiKey?: string;
        baseUrl?: string;
        model?: string;
      };
    }
  } catch {
    // Provider manager not yet initialized
  }
  return {};
}

/**
 * Pick the best fast/cheap model for a given provider base URL.
 * Respects explicitly configured models.
 */
export function getFastModelForProvider(
  baseUrl: string,
  configuredModel?: string,
): string {
  // Codex-prefixed models (e.g. 'codex:gpt-5.4') are for the Codex CLI only —
  // they can't be used with the OpenAI Chat Completions API. Fall through to
  // pick a standard fast model for the provider instead.
  if (configuredModel && !configuredModel.startsWith('codex:')) {
    return configuredModel;
  }

  // Otherwise, pick a known fast/cheap model for the provider
  const lower = baseUrl.toLowerCase();
  for (const [pattern, model] of Object.entries(FAST_MODEL_MAP)) {
    if (lower.includes(pattern)) return model;
  }
  // Unknown provider — fall back to gpt-4o-mini (broadly supported)
  return 'gpt-4o-mini';
}

/**
 * Resolve API credentials from multiple sources.
 *
 * Priority:
 * 1. Explicit modelConfig (from frontend routing)
 * 2. Server-side provider manager config
 * 3. Environment variables
 */
export function resolveApiCredentials(modelConfig?: {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}): {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
} {
  if (modelConfig?.apiKey) {
    return {
      apiKey: modelConfig.apiKey,
      baseUrl: modelConfig.baseUrl,
      model: modelConfig.model,
    };
  }

  const providerConfig = getProviderConfig();
  if (providerConfig.apiKey) {
    return providerConfig;
  }

  return {
    apiKey: process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL,
  };
}
