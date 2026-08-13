/**
 * Provider Management API Routes
 *
 * Provides REST endpoints for managing sandbox and agent providers,
 * including connectivity testing and model routing configuration.
 */

import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { z } from 'zod';

import { getAgentRegistry } from '@/core/agent/registry';
import { getSandboxRegistry } from '@/core/sandbox/registry';

import { getConfigLoader } from '@/config/loader';

import { saveSetting } from '@/shared/db/operations';
import { normalizeHost } from '@/shared/network-policy/host';
import { trustedLocalPolicy } from '@/shared/network-policy/schema';
import { getProviderManager } from '@/shared/provider/manager';
import { PROVIDER_CONNECTION_TEST_TIMEOUT_MS } from '@/shared/utils/connection-test-timeout';
import {
  isNativeGeminiUrl,
  normalizeGeminiBaseUrl,
} from '@/shared/utils/gemini';
import { createLogger } from '@/shared/utils/logger';
import {
  getAuthHeader,
  getProviderHeaders,
} from '@/shared/utils/provider-headers';
import {
  NetworkPolicyDenied,
  safeFetch,
  validateBaseUrlForFetch,
} from '@/shared/utils/url-validator';

const logger = createLogger('ProvidersAPI');

const providersRoutes = new Hono();

/**
 * Handle errors from provider switch operations.
 * Extracts upstream HTTP status when available and returns a consistent error shape.
 */
function handleSwitchError(
  error: unknown,
  fallbackMessage: string,
): { body: { error: string }; status: ContentfulStatusCode } {
  const status = ((error as Record<string, unknown>)?.status as number) || 500;
  return {
    body: {
      error: error instanceof Error ? error.message : fallbackMessage,
    },
    status: status as ContentfulStatusCode,
  };
}

// ============================================================================
// Zod Schemas for Request Validation
// ============================================================================

const testProviderSchema = z.object({
  providerId: z.string().min(1).max(180).optional(),
  dialect: z.enum(['standard', 'kimi-k3']).optional(),
  apiKey: z.string().optional().default(''),
  baseUrl: z.string().url(),
  model: z.string().min(1),
  agentType: z.string().optional(),
});

const fetchModelsSchema = z.object({
  providerId: z.string().min(1).max(180).optional(),
  dialect: z.enum(['standard', 'kimi-k3']).optional(),
  apiKey: z.string().optional().default(''),
  baseUrl: z.string().url(),
  agentType: z.string().optional(),
});

type ProviderModel = {
  id: string;
  name?: string;
  displayLabel: string;
};

const userPreferencesSchema = z.object({
  customInstructions: z.string().max(2000).optional().default(''),
  responseStyle: z
    .enum(['concise', 'detailed', 'auto'])
    .optional()
    .default('auto'),
  tone: z
    .enum(['professional', 'casual', 'friendly', 'auto'])
    .optional()
    .default('auto'),
  proactiveSuggestions: z.boolean().optional().default(true),
  codeStyle: z
    .enum(['commented', 'minimal', 'auto'])
    .optional()
    .default('auto'),
  nickname: z.string().max(100).optional().default(''),
});

const switchProviderSchema = z.object({
  type: z.string().min(1),
  config: z.record(z.string(), z.unknown()).optional(),
});

const settingsSyncSchema = z.object({
  sandboxProvider: z.string().optional(),
  sandboxConfig: z.record(z.string(), z.unknown()).optional(),
  agentProvider: z.string().optional(),
  agentConfig: z.record(z.string(), z.unknown()).optional(),
  defaultProvider: z.string().optional(),
  defaultModel: z.string().optional(),
  userPreferences: userPreferencesSchema.optional(),
});

// ============================================================================
// Sandbox Provider Routes
// ============================================================================

/**
 * GET /providers/sandbox
 * List all sandbox providers with their metadata
 */
providersRoutes.get('/sandbox', async (c) => {
  try {
    const registry = getSandboxRegistry();
    const metadata = registry.getAllSandboxMetadata();
    const available = await registry.getAvailable();
    const current = getProviderManager().getConfig().sandbox;

    return c.json({
      providers: metadata.map((m) => ({
        ...m,
        available: available.includes(m.type),
        current: current?.type === m.type,
      })),
      current: current?.type || null,
    });
  } catch (error) {
    logger.error('Error listing sandbox providers:', error);
    return c.json({ error: 'Failed to list sandbox providers' }, 500);
  }
});

/**
 * GET /providers/sandbox/available
 * List available sandbox providers (those that can actually run on this system)
 */
providersRoutes.get('/sandbox/available', async (c) => {
  try {
    const registry = getSandboxRegistry();
    const available = await registry.getAvailable();

    return c.json({ available });
  } catch (error) {
    logger.error('Error getting available sandbox providers:', error);
    return c.json({ error: 'Failed to get available sandbox providers' }, 500);
  }
});

/**
 * GET /providers/sandbox/:type
 * Get details about a specific sandbox provider
 */
providersRoutes.get('/sandbox/:type', async (c) => {
  try {
    const type = c.req.param('type');
    const registry = getSandboxRegistry();
    const metadata = registry.getSandboxMetadata(type);

    if (!metadata) {
      return c.json({ error: `Sandbox provider not found: ${type}` }, 404);
    }

    const available = await registry.getAvailable();
    const current = getProviderManager().getConfig().sandbox;

    return c.json({
      ...metadata,
      available: available.includes(type),
      current: current?.type === type,
    });
  } catch (error) {
    logger.error('Error getting sandbox provider:', error);
    return c.json({ error: 'Failed to get sandbox provider details' }, 500);
  }
});

/**
 * POST /providers/sandbox/switch
 * Switch to a different sandbox provider
 */
providersRoutes.post(
  '/sandbox/switch',
  zValidator('json', switchProviderSchema),
  async (c) => {
    try {
      const body = c.req.valid('json');

      const manager = getProviderManager();
      await manager.switchSandboxProvider(body.type, body.config);

      // Update config loader
      getConfigLoader().updateFromSettings({
        sandboxProvider: body.type,
        sandboxConfig: body.config,
      });

      return c.json({
        success: true,
        current: body.type,
        message: `Switched to sandbox provider: ${body.type}`,
      });
    } catch (error) {
      logger.error('Error switching sandbox provider:', error);
      const { body, status } = handleSwitchError(
        error,
        'Failed to switch sandbox provider',
      );
      return c.json(body, status);
    }
  },
);

// ============================================================================
// Agent Provider Routes
// ============================================================================

/**
 * GET /providers/agents
 * List all agent providers with their metadata
 */
providersRoutes.get('/agents', async (c) => {
  try {
    const registry = getAgentRegistry();
    const metadata = registry.getAllAgentMetadata();
    const available = await registry.getAvailable();
    const current = getProviderManager().getConfig().agent;

    return c.json({
      providers: metadata.map((m) => ({
        ...m,
        available: available.includes(m.type),
        current: current?.type === m.type,
      })),
      current: current?.type || null,
    });
  } catch (error) {
    logger.error('Error listing agent providers:', error);
    return c.json({ error: 'Failed to list agent providers' }, 500);
  }
});

/**
 * GET /providers/agents/available
 * List available agent providers
 */
providersRoutes.get('/agents/available', async (c) => {
  try {
    const registry = getAgentRegistry();
    const available = await registry.getAvailable();

    return c.json({ available });
  } catch (error) {
    logger.error('Error getting available agent providers:', error);
    return c.json({ error: 'Failed to get available agent providers' }, 500);
  }
});

/**
 * GET /providers/agents/:type
 * Get details about a specific agent provider
 */
providersRoutes.get('/agents/:type', async (c) => {
  try {
    const type = c.req.param('type');
    const registry = getAgentRegistry();
    const metadata = registry.getAgentMetadata(type);

    if (!metadata) {
      return c.json({ error: `Agent provider not found: ${type}` }, 404);
    }

    const available = await registry.getAvailable();
    const current = getProviderManager().getConfig().agent;

    return c.json({
      ...metadata,
      available: available.includes(type),
      current: current?.type === type,
    });
  } catch (error) {
    logger.error('Error getting agent provider:', error);
    return c.json({ error: 'Failed to get agent provider details' }, 500);
  }
});

/**
 * POST /providers/agents/switch
 * Switch to a different agent provider
 */
providersRoutes.post(
  '/agents/switch',
  zValidator('json', switchProviderSchema),
  async (c) => {
    try {
      const body = c.req.valid('json');

      const manager = getProviderManager();
      await manager.switchAgentProvider(body.type, body.config);

      // Update config loader
      getConfigLoader().updateFromSettings({
        agentProvider: body.type,
        agentConfig: body.config,
      });

      return c.json({
        success: true,
        current: body.type,
        message: `Switched to agent provider: ${body.type}`,
      });
    } catch (error) {
      logger.error('Error switching agent provider:', error);
      const { body, status } = handleSwitchError(
        error,
        'Failed to switch agent provider',
      );
      return c.json(body, status);
    }
  },
);

// ============================================================================
// Agent Capability Routes
// ============================================================================

const testEnvironmentSchema = z.object({
  provider: z.string().min(1),
  config: z
    .object({
      provider: z.string(),
      apiKey: z.string().optional(),
      baseUrl: z.string().optional(),
      model: z.string().optional(),
      workDir: z.string().optional(),
    })
    .optional(),
});

const listModelsSchema = z.object({
  provider: z.string().min(1),
  config: z
    .object({
      provider: z.string(),
      apiKey: z.string().optional(),
      baseUrl: z.string().optional(),
      model: z.string().optional(),
    })
    .optional(),
});

/**
 * POST /providers/agents/test-environment
 * Test an agent adapter's environment (binary, auth, health)
 */
providersRoutes.post(
  '/agents/test-environment',
  zValidator('json', testEnvironmentSchema),
  async (c) => {
    try {
      const { provider, config } = c.req.valid('json');
      const registry = getAgentRegistry();

      if (!registry.has(provider)) {
        return c.json({ error: `Unknown provider: ${provider}` }, 404);
      }

      const report = await registry.testEnvironment(
        provider,
        config as import('@/core/agent/types').AgentConfig | undefined,
      );

      if (!report) {
        return c.json(
          {
            error: `Provider ${provider} does not support environment testing`,
          },
          400,
        );
      }

      return c.json({ report });
    } catch (error) {
      logger.error('Error testing agent environment:', error);
      return c.json({ error: 'Failed to test agent environment' }, 500);
    }
  },
);

/**
 * POST /providers/agents/list-models
 * List available models for an agent adapter
 */
providersRoutes.post(
  '/agents/list-models',
  zValidator('json', listModelsSchema),
  async (c) => {
    try {
      const { provider, config } = c.req.valid('json');
      const registry = getAgentRegistry();

      if (!registry.has(provider)) {
        return c.json({ error: `Unknown provider: ${provider}` }, 404);
      }

      const models = await registry.listModels(
        provider,
        config as import('@/core/agent/types').AgentConfig | undefined,
      );

      return c.json({ models });
    } catch (error) {
      logger.error('Error listing agent models:', error);
      return c.json({ error: 'Failed to list agent models' }, 500);
    }
  },
);

// ============================================================================
// A2A Discovery Routes
// ============================================================================

const a2aDiscoverSchema = z.object({
  urls: z.array(z.string().url()).min(1).max(20),
});

/**
 * POST /providers/agents/a2a/discover
 * Discover A2A agent cards from a list of URLs
 */
providersRoutes.post(
  '/agents/a2a/discover',
  zValidator('json', a2aDiscoverSchema),
  async (c) => {
    try {
      const { urls } = c.req.valid('json');

      // SSRF validation: validate each URL before fetching
      for (const url of urls) {
        const check = await validateBaseUrlForFetch(url);
        if (!check.valid) {
          return c.json(
            { error: `Invalid URL "${url}": ${check.reason}` },
            400,
          );
        }
      }

      const { discoverA2AAgents } = await import('@/extensions/agent/a2a');
      const cards = await discoverA2AAgents(urls);
      return c.json({ agents: cards });
    } catch (error) {
      logger.error('Error discovering A2A agents:', error);
      return c.json({ error: 'Failed to discover A2A agents' }, 500);
    }
  },
);

// ============================================================================
// Settings Sync Route
// ============================================================================

/**
 * POST /providers/settings/sync
 * Sync frontend settings with the backend
 */
providersRoutes.post(
  '/settings/sync',
  zValidator('json', settingsSyncSchema),
  async (c) => {
    try {
      const body = c.req.valid('json');

      const manager = getProviderManager();
      const configLoader = getConfigLoader();

      // Update sandbox provider if specified
      if (body.sandboxProvider) {
        await manager.switchSandboxProvider(
          body.sandboxProvider,
          body.sandboxConfig,
        );
      }

      // Update agent provider if specified
      // The agentConfig now includes apiKey, baseUrl, and model from the selected AI provider
      if (body.agentProvider) {
        await manager.switchAgentProvider(body.agentProvider, body.agentConfig);
      }

      // Update config loader with full settings including model info
      configLoader.updateFromSettings({
        ...body,
        agentConfig: body.agentConfig,
      });

      // Persist user preferences for agent system prompt injection
      if (body.userPreferences) {
        saveSetting('userPreferences', JSON.stringify(body.userPreferences));
      }

      logger.info('Settings synced:', {
        agentProvider: body.agentProvider,
        defaultProvider: body.defaultProvider,
        defaultModel: body.defaultModel,
        hasApiKey: !!body.agentConfig?.apiKey,
        hasBaseUrl: !!body.agentConfig?.baseUrl,
        hasUserPreferences: !!body.userPreferences,
      });

      return c.json({
        success: true,
        config: manager.getConfig(),
      });
    } catch (error) {
      logger.error('Error syncing settings:', error);
      return c.json(
        {
          error:
            error instanceof Error ? error.message : 'Failed to sync settings',
        },
        500,
      );
    }
  },
);

/**
 * GET /providers/config
 * Get current provider configuration
 */
providersRoutes.get('/config', (c) => {
  try {
    const manager = getProviderManager();
    return c.json(manager.getConfig());
  } catch (error) {
    logger.error('Error getting config:', error);
    return c.json({ error: 'Failed to get configuration' }, 500);
  }
});

// ============================================================================
// Provider / Model Test Route
// ============================================================================

// ============================================================================
// URL Validation (SSRF Protection)
// ============================================================================

/** Timeout for provider connection-test requests. */
const TEST_TIMEOUT_MS = PROVIDER_CONNECTION_TEST_TIMEOUT_MS;

/** Check if a URL points to a local server (localhost, 127.0.0.1, etc.) */
function isLocalUrl(url: string): boolean {
  try {
    const host = normalizeHost(new URL(url).hostname);
    return (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host === '[::1]'
    );
  } catch {
    return false;
  }
}

function withRedirectError<T extends RequestInit>(init: T): T {
  return { ...init, redirect: 'error' };
}

/**
 * Wrapper around `safeFetch` that returns a Response-shaped object so callers
 * can keep using `.ok`, `.status`, `.text()`, and `.json()`. Per-hop DNS
 * pinning + redirect blocking comes from `safeFetch`, closing the DNS
 * rebinding window between async URL validation and the actual request.
 */
async function safeFetchAsResponse(
  url: string,
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    timeoutMs?: number;
  },
): Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
  json: () => Promise<unknown>;
}> {
  const response = await safeFetch(url, trustedLocalPolicy(), {
    method: init.method,
    headers: init.headers,
    body: init.body,
    timeoutMs: init.timeoutMs,
    maxRedirects: 0,
  });
  const text = response.body.toString('utf-8');
  return {
    ok: response.status >= 200 && response.status < 300,
    status: response.status,
    text: () => Promise.resolve(text),
    json: () => Promise.resolve(JSON.parse(text)),
  };
}

/** Anthropic API version header */
const ANTHROPIC_API_VERSION = '2023-06-01';

/**
 * Model name patterns for non-chat models.
 * These models don't support /chat/completions and must be tested
 * via the lightweight Models List API instead.
 *
 * Keep in sync with the capability detection rules in:
 *   src/shared/lib/model-capabilities.ts → MODEL_CAPABILITY_RULES
 *
 * Coverage: all major providers as of 2026-02
 */
const NON_CHAT_MODEL_PATTERNS = [
  // ── Video generation ────────────────────────────────────────────
  /^(?:dreamina-)?seedance/i, // BytePlus (incl. dreamina-seedance-2-0-*)
  /^doubao-seedance-/i, // ByteDance Seedance via Doubao naming
  /^sora/i, // OpenAI
  /^runway/i, // Runway
  /^gen-[2-9]/i, // Runway gen-2/3/4
  /^kling/i, // Kuaishou
  /^pika/i, // Pika Labs
  /^luma/i, // Luma AI
  /^dream[-_]?machine/i, // Luma
  /^ray-?2/i, // Luma Ray2
  /^hailuo/i, // Hailuo / Minimax
  /^minimax.*video/i, // Minimax video
  /^haiper/i, // Haiper
  /^veo/i, // Google Veo
  /^cogvideo/i, // Open-source
  /^mochi[-_]/i, // Open-source
  /^ltx[-_]?video/i, // Open-source
  /^hunyuan[-_]?video/i, // Tencent
  /video[-_]gen/i, // Generic

  // ── Image generation ────────────────────────────────────────────
  /seedream/i, // BytePlus Seedream
  /^doubao-seedream/i, // BytePlus
  /seededit/i, // BytePlus Seededit
  /^senseaudio-image-/i, // SenseAudio image
  /^sensenova-u1-fast$/i, // SenseNova U1 image generation
  /^dall-e/i, // OpenAI DALL-E
  /^gpt-image/i, // OpenAI GPT Image 1/1.5
  /^chatgpt-image/i, // OpenAI ChatGPT image
  /^stable[-_]?diffusion/i, // Stability AI
  /^sdxl/i, // Stability AI SDXL
  /^sd[_-]?[23]/i, // SD3, SD2
  /^stable[-_]?image/i, // Stability AI
  /^flux/i, // Black Forest Labs
  /^midjourney/i, // Midjourney
  /^ideogram/i, // Ideogram
  /^recraft/i, // Recraft
  /^leonardo/i, // Leonardo AI
  /^custom-image(?::|$)/i, // OpenAI-compatible image endpoint
  /^imagerouter(?::|$)/i, // ImageRouter media
  /^imagen/i, // Google Imagen
  /^hunyuan[-_]?image/i, // Tencent
  /^playground[-_]v/i, // Playground AI
  /^grok[-_]?imagine/i, // xAI image gen
  /grok.*image/i, // xAI image gen

  // ── Audio / Speech ──────────────────────────────────────────────
  /^tts-/i, // OpenAI TTS
  /^gpt-4o-mini-tts/i, // OpenAI TTS
  /^whisper/i, // OpenAI Whisper
  /^gpt-4o-transcribe/i, // OpenAI STT
  /^gpt-4o-mini-transcribe/i, // OpenAI STT
  /^voxtral/i, // Mistral audio
  /^bark/i, // Open-source TTS
  /^xtts/i, // Coqui XTTS
  /^kokoro/i, // Kokoro TTS
  /^orpheus/i, // Orpheus TTS
  /^parler[-_]tts/i, // Parler TTS
  /^metavoice/i, // MetaVoice
  /^chatterbox/i, // Chatterbox
  /^chattts/i, // ChatTTS
  /^fish[-_]speech/i, // Fish Speech
  /^eleven[-_]/i, // ElevenLabs TTS
  /^scribe/i, // ElevenLabs Scribe STT
  /^musicgen/i, // Music gen
  /^stable[-_]?audio/i, // Stability AI audio
  /^speech[-_]/i, // Generic speech
  /^senseaudio-(?:asr|tts|music)-/i, // SenseAudio audio family

  // ── Embedding ───────────────────────────────────────────────────
  /^text-embedding/i, // OpenAI
  /^embed-/i, // Cohere
  /^cohere[-/]embed/i, // Cohere
  /^voyage/i, // Voyage AI
  /^jina[-_]embed/i, // Jina AI
  /^nomic[-_]embed/i, // Nomic
  /^bge[-_]/i, // BAAI BGE
  /^embedding[-_]vision/i, // BytePlus
  /^mistral[-_]embed/i, // Mistral
  /^qwen.*embedding/i, // Qwen
  /^gemini[-_]embed/i, // Google
  /[-_]embedding[-_]|[-_]embed$/i, // Generic

  // ── Rerank ──────────────────────────────────────────────────────
  /^rerank/i, // Cohere
  /^cohere[-/]rerank/i, // Cohere

  // ── Moderation ──────────────────────────────────────────────────
  /^text-moderation/i, // OpenAI
];

/** Detect if a base URL is Anthropic-native (not via OpenRouter) */
function isAnthropicNative(baseUrl: string): boolean {
  const lower = baseUrl.toLowerCase();
  return (
    lower.includes('api.anthropic.com') ||
    (lower.includes('anthropic') && !lower.includes('openrouter'))
  );
}

/** Detect if a base URL or agent type is Google Gemini (native API, not via proxy) */
function isGeminiNative(baseUrl: string, agentType?: string): boolean {
  if (agentType === 'gemini') return true;
  return isNativeGeminiUrl(baseUrl);
}

/**
 * Check if a model is a non-chat model (video, image, embedding, etc.)
 * that doesn't support the /chat/completions endpoint.
 *
 * Handles OpenRouter-style "provider/model" names by stripping the prefix.
 */
function isNonChatModel(model: string): boolean {
  // Handle OpenRouter "provider/model" format
  const name = model.includes('/') ? model.split('/').pop()! : model;
  return NON_CHAT_MODEL_PATTERNS.some((pattern) => pattern.test(name));
}

/**
 * Build the correct chat completions URL for a given base URL.
 *
 * Handles providers whose base URL already includes a version path
 * (e.g., BytePlus ModelArk: `https://ark.../api/v3`).
 * Without this, we'd incorrectly produce `.../api/v3/v1/chat/completions`.
 */
function buildChatCompletionsUrl(baseUrl: string): string {
  let url = baseUrl.replace(/\/+$/, '');

  // Already a fully-qualified chat completions URL
  if (url.endsWith('/chat/completions')) {
    return url;
  }

  // If the URL already contains a version-like path segment (e.g., /v3, /v1),
  // just append /chat/completions directly
  if (/\/(?:api\/)?v\d+$/i.test(url)) {
    return `${url}/chat/completions`;
  }

  // Standard case: append /v1/chat/completions
  return `${url}/v1/chat/completions`;
}

/**
 * Build the models list URL for a given base URL.
 * Used for lightweight auth-only health checks (no generation cost).
 */
function buildModelsListUrl(baseUrl: string): string {
  let url = baseUrl.replace(/\/+$/, '');

  // If the URL already contains a version-like path segment, append /models
  if (/\/(?:api\/)?v\d+$/i.test(url)) {
    return `${url}/models`;
  }

  // Standard case: append /v1/models
  return `${url}/v1/models`;
}

/**
 * POST /providers/test
 * Test connectivity and authentication for a provider/model combination.
 *
 * Uses a two-strategy approach:
 *   1. For non-chat models (video, image, embedding): Uses the lightweight
 *      Models List API (GET /models) to verify auth without any generation cost.
 *   2. For chat models: Sends a minimal chat completion request.
 *
 * Body:
 *   - apiKey: string       — The API key to test
 *   - baseUrl: string      — The provider's base URL
 *   - model: string        — The model to test (e.g., "claude-sonnet-5")
 *   - agentType?: string   — Optional agent type hint ('claude' | 'openai-compat')
 *
 * Returns:
 *   - success: boolean
 *   - latencyMs: number    — Round-trip time in milliseconds
 *   - model: string        — The model that responded
 *   - message?: string     — Human-readable result or error message
 */
providersRoutes.post(
  '/test',
  zValidator('json', testProviderSchema),
  async (c) => {
    const startTime = Date.now();

    try {
      const { apiKey, baseUrl, model, agentType } = c.req.valid('json');

      // Validate base URL to prevent SSRF attacks
      const urlCheck = await validateBaseUrlForFetch(baseUrl, 'POST');
      if (!urlCheck.valid) {
        return c.json(
          {
            success: false,
            latencyMs: Date.now() - startTime,
            model: model || '',
            message: urlCheck.reason || 'Invalid base URL',
          },
          400,
        );
      }

      // Require API key for non-localhost providers
      if (!apiKey && !isLocalUrl(baseUrl)) {
        return c.json(
          {
            success: false,
            latencyMs: Date.now() - startTime,
            model: model || '',
            message: 'API key is required for cloud providers',
          },
          400,
        );
      }

      const nonChat = isNonChatModel(model);

      logger.info('Testing provider connectivity', {
        baseUrl,
        model,
        agentType,
        nonChat,
      });

      // ----------------------------------------------------------------
      // Strategy 1: Models List API (lightweight auth check)
      // Used for non-chat models to avoid unnecessary generation requests.
      // Also used as a fallback when chat completions returns 404.
      // For Gemini non-chat models, redirect to the Gemini native handler.
      // ----------------------------------------------------------------
      if (nonChat && isGeminiNative(baseUrl, agentType)) {
        // Fall through to Strategy 2a (Gemini native) below — it handles all Gemini models
      } else if (nonChat && baseUrl.toLowerCase().includes('elevenlabs.io')) {
        // ElevenLabs uses xi-api-key header (not Bearer).
        // GET /v1/models requires no special scopes — ideal for auth verification.
        const modelsUrl = buildModelsListUrl(baseUrl);
        logger.info(
          `ElevenLabs non-chat model, using Models API: ${modelsUrl}`,
        );

        const modelsResponse = await safeFetchAsResponse(modelsUrl, {
          method: 'GET',
          headers: { 'xi-api-key': apiKey },
          timeoutMs: TEST_TIMEOUT_MS,
        });

        const latencyMs = Date.now() - startTime;

        if (modelsResponse.ok) {
          const modelsData = (await modelsResponse.json()) as Array<{
            model_id?: string;
            name?: string;
          }>;
          const modelCount = Array.isArray(modelsData) ? modelsData.length : 0;
          const modelFound =
            Array.isArray(modelsData) &&
            modelsData.some(
              (m) => m.model_id?.toLowerCase() === model.toLowerCase(),
            );
          logger.info(
            `ElevenLabs Models API succeeded: ${modelCount} models, "${model}" ${modelFound ? 'found' : 'not in list'} (${latencyMs}ms)`,
          );
          return c.json({
            success: true,
            latencyMs,
            model,
            message: modelFound
              ? `Auth verified, model available (${latencyMs}ms)`
              : `Auth verified, ${modelCount} models listed (${latencyMs}ms)`,
          });
        }

        const errorBody = await modelsResponse.text().catch(() => '');
        let errorMessage = `HTTP ${modelsResponse.status}`;
        try {
          const errorJson = JSON.parse(errorBody) as {
            detail?: { message?: string };
          };
          if (errorJson.detail?.message) {
            errorMessage = errorJson.detail.message;
          }
        } catch {
          if (errorBody.length > 0 && errorBody.length < 200) {
            errorMessage = errorBody;
          }
        }

        logger.warn(`ElevenLabs Models API failed: ${errorMessage}`);
        return c.json({
          success: false,
          latencyMs,
          model,
          message: errorMessage,
        });
      } else if (nonChat) {
        const modelsUrl = buildModelsListUrl(baseUrl);
        logger.info(
          `Non-chat model detected, using Models List API: ${modelsUrl}`,
        );

        const modelsResponse = await safeFetchAsResponse(modelsUrl, {
          method: 'GET',
          headers: {
            ...getAuthHeader(baseUrl, apiKey),
            ...getProviderHeaders(baseUrl, apiKey),
          },
          timeoutMs: TEST_TIMEOUT_MS,
        });

        const latencyMs = Date.now() - startTime;

        if (modelsResponse.ok) {
          // Check if the requested model is in the list
          const modelsData = (await modelsResponse.json()) as {
            data?: Array<{ id?: string }>;
          };
          const modelIds =
            modelsData.data?.map((m) => m.id?.toLowerCase()) || [];
          const modelFound = modelIds.some(
            (id) =>
              id === model.toLowerCase() || id?.includes(model.toLowerCase()),
          );

          logger.info(
            `Models List API succeeded: ${modelIds.length} models, requested "${model}" ${modelFound ? 'found' : 'not in list'} (${latencyMs}ms)`,
          );

          return c.json({
            success: true,
            latencyMs,
            model,
            message: modelFound
              ? `Auth verified, model available (${latencyMs}ms)`
              : `Auth verified, ${modelIds.length} models listed (${latencyMs}ms)`,
          });
        }

        // Models endpoint failed — return the error
        const errorBody = await modelsResponse.text().catch(() => '');
        let errorMessage = `HTTP ${modelsResponse.status}`;
        try {
          const errorJson = JSON.parse(errorBody) as {
            error?: { message?: string };
          };
          if (errorJson.error?.message) {
            errorMessage = errorJson.error.message;
          }
        } catch {
          if (errorBody.length > 0 && errorBody.length < 200) {
            errorMessage = errorBody;
          }
        }

        logger.warn(`Models List API failed: ${errorMessage}`);
        return c.json({
          success: false,
          latencyMs,
          model,
          message: errorMessage,
        });
      }

      // ----------------------------------------------------------------
      // Strategy 2a: Gemini Native API (uses ?key= query param auth)
      // ----------------------------------------------------------------
      if (isGeminiNative(baseUrl, agentType)) {
        // Gemini supports x-goog-api-key header; avoid ?key= to prevent
        // key exposure in proxy/middleware access logs.
        const base = normalizeGeminiBaseUrl(baseUrl);
        const modelsUrl = `${base}/v1beta/models`;
        logger.info('Testing Gemini native API via models list');

        const geminiResponse = await safeFetchAsResponse(modelsUrl, {
          method: 'GET',
          headers: { 'x-goog-api-key': apiKey },
          timeoutMs: TEST_TIMEOUT_MS,
        });

        const latencyMs = Date.now() - startTime;

        if (geminiResponse.ok) {
          const data = (await geminiResponse.json()) as {
            models?: Array<{ name?: string; displayName?: string }>;
          };
          const modelNames =
            data.models?.map((m) => m.name?.replace('models/', '')) ?? [];
          const modelFound = modelNames.some(
            (name) =>
              name === model.toLowerCase() ||
              name?.includes(model.toLowerCase()),
          );

          logger.info(
            `Gemini models list succeeded: ${modelNames.length} models, "${model}" ${modelFound ? 'found' : 'not in list'} (${latencyMs}ms)`,
          );

          return c.json({
            success: true,
            latencyMs,
            model,
            message: modelFound
              ? `Auth verified, model available (${latencyMs}ms)`
              : `Auth verified, ${modelNames.length} models listed (${latencyMs}ms)`,
          });
        }

        // Parse Gemini error
        const errorBody = await geminiResponse.text().catch(() => '');
        let errorMessage = `HTTP ${geminiResponse.status}`;
        try {
          const errorJson = JSON.parse(errorBody) as {
            error?: { message?: string; status?: string };
          };
          if (errorJson.error?.message) {
            errorMessage = errorJson.error.message;
          }
        } catch {
          if (errorBody.length > 0 && errorBody.length < 200) {
            errorMessage = errorBody;
          }
        }

        logger.warn(`Gemini test failed: ${errorMessage}`);
        return c.json({
          success: false,
          latencyMs,
          model,
          message: errorMessage,
        });
      }

      // ----------------------------------------------------------------
      // Strategy 2b: Chat Completion (for text/chat models)
      // ----------------------------------------------------------------
      const useAnthropicFormat =
        agentType === 'claude' || (!agentType && isAnthropicNative(baseUrl));

      let response: Awaited<ReturnType<typeof safeFetchAsResponse>>;
      let responseModel = model;

      if (useAnthropicFormat) {
        // Anthropic Messages API format
        const url = `${baseUrl.replace(/\/+$/, '')}/v1/messages`;
        response = await safeFetchAsResponse(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': ANTHROPIC_API_VERSION,
          },
          body: JSON.stringify({
            model,
            max_tokens: 10,
            messages: [{ role: 'user', content: 'Say "ok" in one word.' }],
          }),
          timeoutMs: TEST_TIMEOUT_MS,
        });

        if (response.ok) {
          const data = (await response.json()) as {
            model?: string;
            content?: Array<{ type: string; text?: string }>;
          };
          responseModel = data.model || model;
        }
      } else {
        // OpenAI-compatible Chat Completions API format
        const url = buildChatCompletionsUrl(baseUrl);
        logger.info(`Testing chat completions: ${url}`);

        const testBody: Record<string, unknown> = {
          model,
          messages: [{ role: 'user', content: 'Say "ok" in one word.' }],
        };

        // OpenRouter free models require HTTP-Referer and X-Title headers
        const extraHeaders = getProviderHeaders(baseUrl, apiKey);
        const headers = {
          'Content-Type': 'application/json',
          ...getAuthHeader(baseUrl, apiKey),
          ...extraHeaders,
        };

        // Newer OpenAI models (GPT-4o, o-series, GPT-5.x) reject the legacy
        // "max_tokens" parameter and require "max_completion_tokens" instead.
        // OpenRouter proxies the parameter as-is to the upstream provider, so
        // sending the wrong one causes a 400. Use the modern field by default;
        // if the provider rejects it we retry without any token limit — the
        // prompt naturally produces a tiny response.
        testBody.max_completion_tokens = 10;

        response = await safeFetchAsResponse(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(testBody),
          timeoutMs: TEST_TIMEOUT_MS,
        });

        // If 400, retry with legacy max_tokens (for older models/providers)
        if (response.status === 400) {
          logger.info(
            'Chat completions returned 400 with max_completion_tokens, retrying with max_tokens',
          );
          delete testBody.max_completion_tokens;
          testBody.max_tokens = 10;

          response = await safeFetchAsResponse(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(testBody),
            timeoutMs: TEST_TIMEOUT_MS,
          });
        }

        // If still 400, retry without any token limit
        if (response.status === 400) {
          logger.info(
            'Chat completions returned 400 with max_tokens, retrying without token limit',
          );
          delete testBody.max_tokens;

          response = await safeFetchAsResponse(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(testBody),
            timeoutMs: TEST_TIMEOUT_MS,
          });
        }

        if (response.ok) {
          const data = (await response.json()) as {
            model?: string;
            choices?: Array<{ message?: { content?: string } }>;
          };
          responseModel = data.model || model;
        }

        // If chat completions returns 404, the model might not support chat.
        // Fall back to Models List API as a connectivity/auth check.
        if (response.status === 404) {
          logger.info(
            'Chat completions returned 404, falling back to Models List API',
          );
          const modelsUrl = buildModelsListUrl(baseUrl);
          const modelsResponse = await safeFetchAsResponse(modelsUrl, {
            method: 'GET',
            headers: {
              ...getAuthHeader(baseUrl, apiKey),
              ...getProviderHeaders(baseUrl, apiKey),
            },
            timeoutMs: TEST_TIMEOUT_MS,
          });

          if (modelsResponse.ok) {
            const latencyMs = Date.now() - startTime;
            const modelsData = (await modelsResponse.json()) as {
              data?: Array<{ id?: string }>;
            };
            const modelCount = modelsData.data?.length || 0;

            return c.json({
              success: true,
              latencyMs,
              model,
              message: `Auth verified via Models API, ${modelCount} models listed (${latencyMs}ms)`,
            });
          }
        }
      }

      const latencyMs = Date.now() - startTime;

      if (response.ok) {
        logger.info(`Provider test succeeded: ${model} (${latencyMs}ms)`);
        return c.json({
          success: true,
          latencyMs,
          model: responseModel,
          message: `Connected successfully (${latencyMs}ms)`,
        });
      }

      // Handle error responses
      const errorBody = await response.text().catch(() => '');
      let errorMessage = `HTTP ${response.status}`;

      try {
        const errorJson = JSON.parse(errorBody) as {
          error?: { message?: string; type?: string };
        };
        if (errorJson.error?.message) {
          errorMessage = errorJson.error.message;
        }
      } catch {
        if (errorBody.length > 0 && errorBody.length < 200) {
          errorMessage = errorBody;
        }
      }

      logger.warn(`Provider test failed: ${response.status} - ${errorMessage}`);
      return c.json({
        success: false,
        latencyMs,
        model,
        message: errorMessage,
      });
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      // Provide user-friendly messages for common errors
      let friendlyMessage = errorMessage;
      if (
        errorMessage.includes('fetch failed') ||
        errorMessage.includes('ECONNREFUSED')
      ) {
        friendlyMessage =
          'Could not connect to the server. Check if the URL is correct and the server is running.';
      } else if (
        errorMessage.includes('timeout') ||
        errorMessage.includes('Timeout')
      ) {
        friendlyMessage = `Request timed out after ${TEST_TIMEOUT_MS / 1000}s. The server may be slow or unreachable.`;
      } else if (errorMessage.includes('ENOTFOUND')) {
        friendlyMessage =
          'Server hostname not found. Check the base URL for typos.';
      }

      logger.error('Provider test error:', errorMessage);
      return c.json({
        success: false,
        latencyMs,
        model: '',
        message: friendlyMessage,
      });
    }
  },
);

// ============================================================================
// Fetch Provider Models Route
// ============================================================================

/**
 * Parse an upstream error response into a human-readable message.
 * Tries JSON first (looking for error.message), then falls back to raw text.
 */
function redactProviderSecrets(text: string, knownSecrets: string[] = []) {
  let redacted = text;
  for (const secret of knownSecrets) {
    if (secret.length < 8) continue;
    redacted = redacted.split(secret).join('[redacted]');
  }
  return redacted.replace(
    /\b(?:sk-[A-Za-z0-9_-]{8,}|sk-ant-[A-Za-z0-9_-]{8,}|AIza[A-Za-z0-9_-]{20,}|Bearer\s+[A-Za-z0-9_/.+=-]{8,})\b/g,
    '[redacted]',
  );
}

function parseUpstreamErrorText(
  text: string,
  status: number,
  knownSecrets: string[] = [],
): string {
  try {
    const json = JSON.parse(text) as { error?: { message?: string } };
    if (json.error?.message) {
      return redactProviderSecrets(json.error.message, knownSecrets);
    }
  } catch {
    if (text.length > 0 && text.length < 200) {
      return redactProviderSecrets(text, knownSecrets);
    }
  }
  return `HTTP ${status}`;
}

/**
 * Map an upstream HTTP status to an appropriate proxy status code.
 * Auth errors (401/403) are forwarded as-is; server errors become 502.
 */
function mapUpstreamStatus(upstreamStatus: number): ContentfulStatusCode {
  if (upstreamStatus === 401 || upstreamStatus === 403)
    return upstreamStatus as ContentfulStatusCode;
  if (upstreamStatus === 404 || upstreamStatus === 429)
    return upstreamStatus as ContentfulStatusCode;
  if (upstreamStatus >= 500) return 502;
  return upstreamStatus as ContentfulStatusCode;
}

/** Max pagination pages to follow (safety limit) */
const MAX_PAGINATION_PAGES = 5;

/** Timeout for model list connection-test requests. */
const MODELS_LIST_TIMEOUT_MS = PROVIDER_CONNECTION_TEST_TIMEOUT_MS;

function isAzureOpenAIUrl(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    return host.endsWith('.openai.azure.com');
  } catch {
    return false;
  }
}

function normalizeProviderModels(
  models: Array<{ id: string; name?: string }>,
): ProviderModel[] {
  const byId = new Map<string, ProviderModel>();
  for (const model of models) {
    const id = model.id.trim();
    if (!id || byId.has(id)) continue;
    const name = model.name?.trim();
    byId.set(id, {
      id,
      ...(name ? { name } : {}),
      displayLabel: name && name !== id ? `${id} (${name})` : id,
    });
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

async function fetchProviderModelsJson<T>(
  url: string,
  headers: Record<string, string>,
): Promise<{ status: number; json?: T; text: string }> {
  const response = await safeFetch(url, trustedLocalPolicy(), {
    method: 'GET',
    headers,
    timeoutMs: MODELS_LIST_TIMEOUT_MS,
    maxRedirects: 2,
  });
  const text = response.body.toString('utf-8');
  if (response.status < 200 || response.status >= 300) {
    return { status: response.status, text };
  }
  return {
    status: response.status,
    text,
    json: JSON.parse(text) as T,
  };
}

/**
 * POST /providers/models
 * Fetch the list of available models from a provider's API.
 *
 * Body:
 *   - apiKey: string       — The API key (optional for Ollama)
 *   - baseUrl: string      — The provider's base URL
 *   - agentType?: string   — Optional agent type hint
 *
 * Returns:
 *   - success: boolean
 *   - models: Array<{ id: string; name?: string }>
 *   - totalCount: number
 *   - message?: string
 */
providersRoutes.post(
  '/models',
  zValidator('json', fetchModelsSchema),
  async (c) => {
    const startedAt = Date.now();
    try {
      const { apiKey, baseUrl, agentType } = c.req.valid('json');

      // Validate base URL to prevent SSRF attacks
      const urlCheck = await validateBaseUrlForFetch(baseUrl);
      if (!urlCheck.valid) {
        return c.json(
          {
            success: false,
            models: [],
            totalCount: 0,
            message: urlCheck.reason || 'Invalid base URL',
          },
          400,
        );
      }

      if (isAzureOpenAIUrl(baseUrl)) {
        return c.json(
          {
            success: false,
            models: [],
            totalCount: 0,
            upstreamStatus: null,
            latencyMs: Date.now() - startedAt,
            message:
              'Azure OpenAI deployment discovery is not supported. Configure the deployment model name manually.',
          },
          400,
        );
      }

      logger.info('Fetching models from provider', { baseUrl, agentType });

      let models: Array<{ id: string; name?: string }> = [];
      let upstreamStatus: number | null = null;

      // ── Gemini Native ──────────────────────────────────────────────
      if (isGeminiNative(baseUrl, agentType)) {
        if (!apiKey) {
          return c.json(
            {
              success: false,
              models: [],
              totalCount: 0,
              message: 'API key is required for Gemini',
            },
            400,
          );
        }

        const base = normalizeGeminiBaseUrl(baseUrl);
        let pageToken: string | undefined;

        for (let page = 0; page < MAX_PAGINATION_PAGES; page++) {
          let url = `${base}/v1beta/models?pageSize=100`;
          if (pageToken) {
            url += `&pageToken=${encodeURIComponent(pageToken)}`;
          }

          const resp = await fetchProviderModelsJson<{
            models?: Array<{ name?: string; displayName?: string }>;
            nextPageToken?: string;
          }>(url, { 'x-goog-api-key': apiKey });
          upstreamStatus = resp.status;

          if (!resp.json) {
            const errMsg = parseUpstreamErrorText(resp.text, resp.status, [
              apiKey,
            ]);
            return c.json(
              {
                success: false,
                models: [],
                totalCount: 0,
                upstreamStatus: resp.status,
                latencyMs: Date.now() - startedAt,
                message: errMsg,
              },
              mapUpstreamStatus(resp.status),
            );
          }

          const data = resp.json;

          if (data.models) {
            for (const m of data.models) {
              const id = m.name?.replace('models/', '') || '';
              if (id) {
                models.push({ id, name: m.displayName || undefined });
              }
            }
          }

          if (!data.nextPageToken) break;
          pageToken = data.nextPageToken;
        }
      }
      // ── Anthropic Native ───────────────────────────────────────────
      else if (agentType === 'claude' || isAnthropicNative(baseUrl)) {
        if (!apiKey) {
          return c.json(
            {
              success: false,
              models: [],
              totalCount: 0,
              message: 'API key is required for Anthropic',
            },
            400,
          );
        }

        const base = baseUrl.replace(/\/+$/, '');
        let afterId: string | undefined;

        for (let page = 0; page < MAX_PAGINATION_PAGES; page++) {
          let url = `${base}/v1/models?limit=100`;
          if (afterId) {
            url += `&after_id=${encodeURIComponent(afterId)}`;
          }

          const resp = await fetchProviderModelsJson<{
            data?: Array<{ id?: string; display_name?: string }>;
            has_more?: boolean;
            last_id?: string;
          }>(url, {
            'x-api-key': apiKey,
            'anthropic-version': ANTHROPIC_API_VERSION,
          });
          upstreamStatus = resp.status;

          if (!resp.json) {
            const errMsg = parseUpstreamErrorText(resp.text, resp.status, [
              apiKey,
            ]);
            return c.json(
              {
                success: false,
                models: [],
                totalCount: 0,
                upstreamStatus: resp.status,
                latencyMs: Date.now() - startedAt,
                message: errMsg,
              },
              mapUpstreamStatus(resp.status),
            );
          }

          const data = resp.json;

          if (data.data) {
            for (const m of data.data) {
              if (m.id) {
                models.push({ id: m.id, name: m.display_name || undefined });
              }
            }
          }

          if (!data.has_more || !data.last_id) break;
          afterId = data.last_id;
        }
      }
      // ── OpenAI-compatible (OpenRouter, Ollama, etc.) ───────────────
      else {
        // Ollama and local servers don't require an API key
        if (!apiKey && !isLocalUrl(baseUrl)) {
          return c.json(
            {
              success: false,
              models: [],
              totalCount: 0,
              message: 'API key is required',
            },
            400,
          );
        }

        const modelsUrl = buildModelsListUrl(baseUrl);
        const headers: Record<string, string> = {
          ...getProviderHeaders(baseUrl, apiKey),
        };
        if (apiKey) {
          Object.assign(headers, getAuthHeader(baseUrl, apiKey));
        }

        const resp = await fetchProviderModelsJson<{
          data?: Array<{ id?: string; name?: string }>;
        }>(modelsUrl, headers);
        upstreamStatus = resp.status;

        if (!resp.json) {
          const errMsg = parseUpstreamErrorText(resp.text, resp.status, [
            apiKey,
          ]);
          return c.json(
            {
              success: false,
              models: [],
              totalCount: 0,
              upstreamStatus: resp.status,
              latencyMs: Date.now() - startedAt,
              message: errMsg,
            },
            mapUpstreamStatus(resp.status),
          );
        }

        const data = resp.json;

        if (data.data) {
          for (const m of data.data) {
            if (m.id) {
              models.push({ id: m.id, name: m.name || undefined });
            }
          }
        }
      }

      const normalizedModels = normalizeProviderModels(models);

      logger.info(`Fetched ${normalizedModels.length} models from provider`);

      return c.json({
        success: true,
        models: normalizedModels,
        totalCount: normalizedModels.length,
        upstreamStatus,
        latencyMs: Date.now() - startedAt,
        message: `Found ${normalizedModels.length} models`,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      let friendlyMessage = errorMessage;
      let status: ContentfulStatusCode = 502;
      if (
        errorMessage.includes('fetch failed') ||
        errorMessage.includes('ECONNREFUSED')
      ) {
        friendlyMessage =
          'Could not connect to the server. Check if the URL is correct and the server is running.';
      } else if (
        errorMessage.includes('timeout') ||
        errorMessage.includes('Timeout') ||
        errorMessage.includes('timed out')
      ) {
        friendlyMessage = `Request timed out after ${MODELS_LIST_TIMEOUT_MS / 1000}s. The server may be slow or unreachable.`;
        status = 504;
      } else if (errorMessage.includes('ENOTFOUND')) {
        friendlyMessage =
          'Server hostname not found. Check the base URL for typos.';
      } else if (error instanceof NetworkPolicyDenied) {
        friendlyMessage = error.reason;
        status = 400;
      }

      logger.error('Error fetching models:', errorMessage);
      return c.json(
        {
          success: false,
          models: [],
          totalCount: 0,
          upstreamStatus: null,
          latencyMs: Date.now() - startedAt,
          message: friendlyMessage,
        },
        status,
      );
    }
  },
);

// ============================================================================
// Provider Presets & Auto-detect Routes
// ============================================================================

import {
  getPresetsByCategory,
  LOCAL_PRESETS,
} from '@/extensions/agent/openai-compat/presets';

const DETECT_TIMEOUT_MS = 2000;

/** GET /providers/presets — return all presets grouped by category */
providersRoutes.get('/presets', (c) => {
  try {
    const grouped = getPresetsByCategory();
    return c.json({ presets: grouped });
  } catch (err) {
    logger.error('Failed to get provider presets:', err);
    return c.json(
      { error: 'Failed to get presets' },
      500 as ContentfulStatusCode,
    );
  }
});

/** GET /providers/detect — auto-detect running local providers */
providersRoutes.get('/detect', async (c) => {
  const detected: Array<{
    id: string;
    name: string;
    baseUrl: string;
    models: string[];
  }> = [];

  for (const preset of LOCAL_PRESETS) {
    try {
      const baseWithoutVersion = preset.baseUrl.replace(/\/v\d+\/?$/, '');
      const url = `${baseWithoutVersion}${preset.detectEndpoint}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), DETECT_TIMEOUT_MS);

      const resp = await fetch(
        url,
        withRedirectError({ signal: controller.signal }),
      );
      clearTimeout(timer);

      if (resp.ok) {
        const data = (await resp.json()) as {
          models?: Array<{ id?: string; name?: string }>;
          data?: Array<{ id?: string }>;
        };

        let models: string[] = [];
        // Ollama returns { models: [{ name }] }, OpenAI-compat returns { data: [{ id }] }
        if (Array.isArray(data.models)) {
          models = data.models.map((m) => m.name ?? m.id ?? '').filter(Boolean);
        } else if (Array.isArray(data.data)) {
          models = data.data.map((m) => m.id ?? '').filter(Boolean);
        }

        detected.push({
          id: preset.id,
          name: preset.name,
          baseUrl: preset.baseUrl,
          models,
        });
      }
    } catch {
      // Provider not running — skip silently
    }
  }

  return c.json({ detected });
});

/** POST /providers/test-connection — quick connection check to a user-specified OpenAI-compat provider */
providersRoutes.post(
  '/test-connection',
  zValidator(
    'json',
    z.object({
      baseUrl: z.string().url(),
      apiKey: z.string().optional(),
    }),
  ),
  async (c) => {
    const { baseUrl, apiKey } = c.req.valid('json');

    const validation = await validateBaseUrlForFetch(baseUrl);
    if (!validation.valid) {
      return c.json(
        { success: false, error: validation.reason ?? 'Invalid URL' },
        400 as ContentfulStatusCode,
      );
    }

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (apiKey) {
        Object.assign(headers, getAuthHeader(baseUrl, apiKey));
      }

      const resp = await safeFetchAsResponse(`${baseUrl}/models`, {
        headers,
        timeoutMs: TEST_TIMEOUT_MS,
      });

      if (!resp.ok) {
        return c.json({
          success: false,
          error: `Server responded with ${resp.status}`,
        });
      }

      const data = (await resp.json()) as {
        data?: Array<{ id?: string }>;
      };
      const models = (data.data ?? []).map((m) => m.id ?? '').filter(Boolean);

      return c.json({ success: true, models });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Connection failed';
      return c.json({ success: false, error: msg });
    }
  },
);

export { providersRoutes };
