import { API_BASE_URL } from '@/config';
import type { Language } from '@/config/locale';
import { translations } from '@/config/locale';
import { getSettings } from '@/shared/db/settings';
import { getAppDataDir } from '@/shared/lib/paths';
import { parseRuntimeModelId } from '@/shared/lib/runtime-model-ids';
import type { RuntimeContext } from '@/shared/types/runtime-context';

import { DEFAULT_MAX_RETRIES, DEFAULT_RETRY_DELAY } from './agent-constants';
import type { ModelOverride } from './agent-types';

export const AGENT_SERVER_URL = API_BASE_URL;

// Helper to get current language translations
export function getErrorMessages() {
  const settings = getSettings();
  const lang = (settings.language || 'zh-CN') as Language;
  return (
    translations[lang]?.common?.errors || translations['zh-CN'].common.errors
  );
}

export function getTaskMessages() {
  const settings = getSettings();
  const lang = (settings.language || 'zh-CN') as Language;
  return translations[lang]?.task || translations['zh-CN'].task;
}

// Helper to format fetch errors with more details (user-friendly, localized)
export function formatFetchError(error: unknown, _endpoint: string): string {
  const err = error as Error;
  const message = err.message || String(error);
  const t = getErrorMessages();

  // Common error patterns - use friendly messages
  if (
    message === 'Load failed' ||
    message === 'Failed to fetch' ||
    message.includes('NetworkError')
  ) {
    return t.connectionFailedFinal;
  }

  if (message.includes('CORS') || message.includes('cross-origin')) {
    return t.corsError;
  }

  if (message.includes('timeout') || message.includes('Timeout')) {
    return t.timeout;
  }

  if (message.includes('ECONNREFUSED')) {
    return t.serverNotRunning;
  }

  // Return generic message for other errors
  return t.requestFailed.replace('{message}', message);
}

// Fetch with retry logic for better resilience
export async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries: number = DEFAULT_MAX_RETRIES,
  retryDelay: number = DEFAULT_RETRY_DELAY,
): Promise<Response> {
  let lastError: Error | null = null;
  const t = getErrorMessages();

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);
      return response;
    } catch (error) {
      lastError = error as Error;
      const errorMessage = lastError.message || '';

      // Don't retry if aborted
      if (lastError.name === 'AbortError') {
        throw lastError;
      }

      // Only retry on network errors
      const isNetworkError =
        errorMessage === 'Load failed' ||
        errorMessage === 'Failed to fetch' ||
        errorMessage.includes('NetworkError') ||
        errorMessage.includes('ECONNREFUSED');

      if (!isNetworkError) {
        throw lastError;
      }

      // Wait before retrying (exponential backoff)
      if (attempt < maxRetries - 1) {
        const delay = retryDelay * Math.pow(2, attempt);
        const retryMsg = t.retrying
          .replace('{attempt}', String(attempt + 1))
          .replace('{max}', String(maxRetries));
        if (import.meta.env.DEV) {
          console.warn(`[useAgent] ${retryMsg} (${delay}ms)`);
        }
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError || new Error('Fetch failed after retries');
}

/**
 * Get model configuration from settings, optionally for a specific task type.
 *
 * When a taskType is specified, the model routing config is checked first:
 *   1. Task-specific routing override (settings.modelRouting[taskType])
 *   2. Global default (defaultProvider + defaultModel)
 *   3. Environment variables (returns undefined)
 *
 * @param taskType - Optional task type for model routing ('planning', 'execution', etc.)
 */
export function getModelConfig(
  taskType?:
    | 'planning'
    | 'execution'
    | 'titleGeneration'
    | 'research'
    | 'codeReview',
):
  | {
      providerId?: string;
      dialect?: 'standard' | 'kimi-k3';
      apiKey?: string;
      baseUrl?: string;
      model?: string;
      agentType?: string;
    }
  | undefined {
  try {
    const settings = getSettings();

    if (import.meta.env.DEV) {
      console.warn('[useAgent] getModelConfig called:', {
        taskType,
        defaultProvider: settings.defaultProvider,
        defaultModel: settings.defaultModel,
        providersCount: settings.providers.length,
      });
    }

    // If a task type is specified, check model routing config first
    if (taskType && settings.modelRouting) {
      const route = settings.modelRouting[taskType];
      if (route && route.provider && route.provider !== 'default') {
        const routeProvider = settings.providers.find(
          (p) => p.id === route.provider,
        );
        if (routeProvider) {
          const config: {
            providerId?: string;
            dialect?: 'standard' | 'kimi-k3';
            apiKey?: string;
            baseUrl?: string;
            model?: string;
            agentType?: string;
          } = {};

          config.providerId = routeProvider.id;
          if (routeProvider.dialect) config.dialect = routeProvider.dialect;

          if (routeProvider.apiKey) config.apiKey = routeProvider.apiKey;
          if (routeProvider.baseUrl) config.baseUrl = routeProvider.baseUrl;
          if (route.model) config.model = route.model;
          else if (routeProvider.models[0])
            config.model = routeProvider.models[0];
          if (routeProvider.agentType)
            config.agentType = routeProvider.agentType;

          if (import.meta.env.DEV) {
            console.warn(
              `[useAgent] Using task-specific routing for "${taskType}":`,
              {
                provider: routeProvider.name,
                model: config.model,
              },
            );
          }

          if (config.apiKey || config.baseUrl || config.model) {
            return config;
          }
        }
      }
    }

    // Check if settings appear to be default (not loaded from storage)
    if (
      import.meta.env.DEV &&
      settings.defaultProvider === 'default' &&
      settings.providers.length === 2 &&
      settings.providers.every((p) => !p.apiKey)
    ) {
      console.warn(
        '[useAgent] WARNING: Settings appear to be defaults. ' +
          'If you configured a custom API provider, it may not have been loaded correctly. ' +
          'Check browser console for [Settings] logs to diagnose the issue.',
      );
    }

    // If using "default" provider, return undefined to use environment variables
    if (settings.defaultProvider === 'default') {
      if (import.meta.env.DEV) {
        console.warn(
          '[useAgent] Using default provider (environment variables)',
        );
      }
      return undefined;
    }

    const provider = settings.providers.find(
      (p) => p.id === settings.defaultProvider,
    );

    if (import.meta.env.DEV) {
      console.warn(
        '[useAgent] Found provider:',
        provider
          ? {
              id: provider.id,
              name: provider.name,
              hasApiKey: !!provider.apiKey,
              hasBaseUrl: !!provider.baseUrl,
            }
          : 'NOT FOUND',
      );
    }

    if (!provider) return undefined;

    // Only return config if we have custom settings
    const config: {
      providerId?: string;
      dialect?: 'standard' | 'kimi-k3';
      apiKey?: string;
      baseUrl?: string;
      model?: string;
      agentType?: string;
    } = {};

    config.providerId = provider.id;
    if (provider.dialect) config.dialect = provider.dialect;

    if (provider.apiKey) {
      config.apiKey = provider.apiKey;
    }
    if (provider.baseUrl) {
      config.baseUrl = provider.baseUrl;
    }
    if (settings.defaultModel) {
      config.model = settings.defaultModel;
    }
    if (provider.agentType) {
      config.agentType = provider.agentType;
    }

    // Return undefined if no custom config
    if (!config.apiKey && !config.baseUrl && !config.model) {
      if (import.meta.env.DEV) {
        console.warn('[useAgent] No custom config found, returning undefined');
      }
      return undefined;
    }

    if (import.meta.env.DEV) {
      console.warn('[useAgent] Returning modelConfig:', {
        hasApiKey: !!config.apiKey,
        baseUrl: config.baseUrl,
        model: config.model,
        agentType: config.agentType,
      });
    }

    return config;
  } catch (error) {
    if (import.meta.env.DEV) {
      console.error('[useAgent] getModelConfig error:', error);
    }
    return undefined;
  }
}

// Helper to get sandbox configuration from settings
export function getSandboxConfig():
  | { enabled: boolean; provider?: string; apiEndpoint?: string }
  | undefined {
  try {
    const settings = getSettings();

    if (import.meta.env.DEV) {
      console.warn('[useAgent] getSandboxConfig - Full settings check:', {
        sandboxEnabled: settings.sandboxEnabled,
        sandboxEnabledType: typeof settings.sandboxEnabled,
        defaultSandboxProvider: settings.defaultSandboxProvider,
        hasSettings: !!settings,
        settingsKeys: Object.keys(settings),
      });
    }

    // Only return if sandbox is enabled
    if (!settings.sandboxEnabled) {
      if (import.meta.env.DEV) {
        console.warn(
          '[useAgent] Sandbox is DISABLED in settings - sandboxEnabled:',
          settings.sandboxEnabled,
        );
      }
      return undefined;
    }

    const config = {
      enabled: true,
      provider: settings.defaultSandboxProvider, // Use selected sandbox provider
      apiEndpoint: AGENT_SERVER_URL, // Use the same server
    };

    if (import.meta.env.DEV) {
      console.warn('[useAgent] Sandbox ENABLED, returning config:', config);
    }
    return config;
  } catch (error) {
    if (import.meta.env.DEV) {
      console.error('[useAgent] Error getting sandbox config:', error);
    }
    return undefined;
  }
}

// Helper to get skills configuration from settings
export function getSkillsConfig():
  | {
      enabled: boolean;
      userDirEnabled: boolean;
      appDirEnabled: boolean;
      skillsPath?: string;
    }
  | undefined {
  try {
    const settings = getSettings();

    // If global switch is off, return undefined (no skills)
    if (settings.skillsEnabled === false) {
      if (import.meta.env.DEV) {
        console.warn('[useAgent] Skills disabled globally');
      }
      return undefined;
    }

    const config = {
      enabled: true,
      userDirEnabled: settings.skillsUserDirEnabled !== false,
      appDirEnabled: settings.skillsAppDirEnabled !== false,
      skillsPath: settings.skillsPath || undefined,
    };

    if (import.meta.env.DEV) {
      console.warn('[useAgent] Skills config:', config);
    }
    return config;
  } catch {
    return undefined;
  }
}

// Helper to get MCP configuration from settings
export function getMcpConfig():
  | {
      enabled: boolean;
      userDirEnabled: boolean;
      appDirEnabled: boolean;
      mcpConfigPath?: string;
    }
  | undefined {
  try {
    const settings = getSettings();

    // If global switch is off, return undefined (no MCP)
    if (settings.mcpEnabled === false) {
      if (import.meta.env.DEV) {
        console.warn('[useAgent] MCP disabled globally');
      }
      return undefined;
    }

    const config = {
      enabled: true,
      userDirEnabled: settings.mcpUserDirEnabled !== false,
      appDirEnabled: settings.mcpAppDirEnabled !== false,
      mcpConfigPath: settings.mcpConfigPath || undefined,
    };

    if (import.meta.env.DEV) {
      console.warn('[useAgent] MCP config:', config);
    }
    return config;
  } catch {
    return undefined;
  }
}

/**
 * Gather all config properties needed for agent execution API calls.
 * Eliminates repeating the same 6 config reads in runAgent, approvePlan,
 * and continueConversation.
 *
 * @param taskType - Optional task type for model routing. When specified,
 *   the modelConfig will be resolved using the task-specific routing config.
 */
export function getAgentRequestConfig(
  runtimeContext: RuntimeContext,
  taskType?:
    | 'planning'
    | 'execution'
    | 'titleGeneration'
    | 'research'
    | 'codeReview',
) {
  const settings = getSettings();
  return {
    modelConfig: getModelConfig(taskType),
    sandboxConfig: getSandboxConfig(),
    skillsConfig: getSkillsConfig(),
    mcpConfig: getMcpConfig(),
    language: settings.language || 'en-US',
    allowedFolders: settings.allowedFolders,
    ptcEnabled: settings.ptcEnabled,
    runtimeContext,
  };
}

/**
 * Merge a per-task model override into an agent request config.
 * When `override` is provided its fields take precedence over the
 * settings-derived modelConfig (e.g. to switch to Opus for a single task).
 *
 * Important: when the base modelConfig is `undefined` (env-var mode) and the
 * override only carries a model name, we still create a modelConfig so the
 * backend knows which model to use.  However, we first re-derive the full
 * provider config via `buildModelOverride` to ensure apiKey / baseUrl are
 * included when needed. This prevents sending a partial modelConfig that
 * the backend might interpret as "custom provider without credentials".
 */
export function applyModelOverride<
  T extends { modelConfig?: Record<string, unknown> | undefined },
>(config: T, override: ModelOverride | undefined): T {
  if (!override) return config;

  // When there's an existing modelConfig, just merge the override into it
  if (config.modelConfig) {
    return { ...config, modelConfig: { ...config.modelConfig, ...override } };
  }

  // modelConfig was undefined (env-var / default mode).
  // If the override has provider credentials (apiKey, baseUrl, agentType) we
  // must create a modelConfig.  If it only has a model name we can still
  // create one — the backend should fall back to env vars for auth.
  const hasProviderCredentials =
    override.apiKey || override.baseUrl || override.agentType;
  if (hasProviderCredentials) {
    return { ...config, modelConfig: { ...override } };
  }

  // Model-name-only override with no existing modelConfig — pass it so the
  // backend uses the explicit model, while still falling back to env vars.
  return { ...config, modelConfig: { model: override.model } };
}

/**
 * Build a ModelOverride from a model ID.
 * For non-Claude providers the full provider config (apiKey, baseUrl, agentType)
 * is looked up from settings. For built-in Claude models only the model name is returned.
 */
export function buildModelOverride(modelId: string): ModelOverride {
  // Bare `default` (unprefixed) is the local-CLI runtime picker's "use the
  // CLI's own configured model" sentinel (`DEFAULT_MODEL_OPTION` in
  // `agent-runtimes/models.ts`) — it only carries meaning behind a runtime
  // prefix (`cursor-agent:default`, parsed below). Outside that prefix it's
  // stale/ambiguous state with no provider attached; forwarding it as a
  // literal Claude/Codex model name makes the SDK reject it outright (Claude
  // Code: "There's an issue with the selected model (default)."). Treat it
  // as no override so the backend falls back to the profile/global default.
  if (modelId === 'default') return {};
  // Codex CLI is a built-in CLI agent — always route to the codex agent type.
  // Model IDs use `codex:<model>` prefix (e.g. `codex:o3`); the backend
  // extracts the underlying model name from the prefix.
  if (modelId === 'codex' || modelId.startsWith('codex:')) {
    return { model: modelId, agentType: 'codex' };
  }
  // Structured local-CLI runtime ids (`cursor-agent:auto`, `qwen:…`,
  // `copilot:…`) route to their runtime adapter with the bare model name —
  // the prefix is a UI-state namespace, stripped at this API boundary.
  const runtimeModel = parseRuntimeModelId(modelId);
  if (runtimeModel) {
    return { model: runtimeModel.model, agentType: runtimeModel.runtimeId };
  }
  try {
    const settings = getSettings();
    for (const provider of settings.providers) {
      if (provider.models.includes(modelId) && provider.enabled) {
        return {
          providerId: provider.id,
          ...(provider.dialect ? { dialect: provider.dialect } : {}),
          model: modelId,
          ...(provider.apiKey ? { apiKey: provider.apiKey } : {}),
          ...(provider.baseUrl ? { baseUrl: provider.baseUrl } : {}),
          ...(provider.agentType ? { agentType: provider.agentType } : {}),
        };
      }
    }
  } catch {
    // Settings unavailable — fall back to model name only
  }
  return { model: modelId };
}

/**
 * Basic client-side path sanity check (defense-in-depth).
 * The backend performs full validation via path-validator.ts; this
 * catches the most dangerous patterns early so they never leave the client.
 */
export function isPathSafe(p: string): boolean {
  if (p.includes('\0')) return false; // null-byte injection
  if (/(^|[\\/])\.\.([\\/]|$)/.test(p)) return false; // path traversal (segment-level)
  return true;
}

/**
 * Resolve the effective workspace directory using a consistent priority chain:
 *   per-task workDir > global settings.workDir > sessionFolder > appDataDir
 *
 * Each candidate is checked for basic safety before use. If a candidate
 * fails, it is skipped and the next one in the chain is tried.
 */
export async function resolveEffectiveWorkDir(
  perTaskWorkDir: string | null,
  sessionFolder: string | null,
): Promise<string> {
  if (perTaskWorkDir && isPathSafe(perTaskWorkDir)) return perTaskWorkDir;

  const settings = getSettings();
  if (settings.workDir && isPathSafe(settings.workDir)) return settings.workDir;
  if (sessionFolder && isPathSafe(sessionFolder)) return sessionFolder;

  return getAppDataDir();
}

// ── Conversational intent detection — multilingual ───────────────────────────
// Frontend mirror of src-api/src/core/agent/base.ts — keep in sync.
//
// Supports en / zh (+ ja, ko) / es / fr / pt / hi via:
//   1. Unicode property-escape script detection  (ES2018, V8 / modern browsers)
//   2. Per-script greeting / identity word sets and regexes
//   3. Script-agnostic question-mark detection
//   4. English task-keyword veto for Latin-script inputs

// Script detectors (ES2018 Unicode property escapes)
// Covers all CJK writing systems: Hanzi (zh), Hiragana/Katakana (ja), Hangul (ko)
const EAST_ASIAN_SCRIPT_RE =
  /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u;
const DEVANAGARI_SCRIPT_RE = /\p{Script=Devanagari}/u;

// Script-agnostic question marks: ASCII + fullwidth CJK + Arabic
const QUESTION_MARK_RE = /[?？؟]\s*$/;

// Latin script: en / es / fr / pt
const LATIN_GREETING_RE =
  /^[¿¡]?(hi|hello|hey|thanks?|thank you|okay|ok|sure|great|got it|yep|yup|hola|oye|gracias|buenas|bonjour|salut|merci|bonsoir|olá|oi|obrigado|obrigada|tudo bem)[\s!.,?¡¿]*$/;

const LATIN_IDENTITY_RE =
  /^[¿¡]?(who are you|what are you|what can you do|tell me about yourself|what is your name|quién eres|qué eres|qué puedes hacer|cómo te llamas|qui es-tu|qu'est-ce que tu|que peux-tu faire|comment tu t'appelles|quem é você|o que você é|o que você faz|qual é o seu nome)/;

const LATIN_TASK_KEYWORD_RE =
  /\b(write|create|make|build|implement|fix|edit|update|delete|remove|run|execute|modify|generate|refactor|download|upload|file|folder|directory|script|function|code|install|deploy|test|debug|commit|push|pull)\b/;

const LATIN_QUESTION_START_RE =
  /^[¿¡]?(what|who|where|when|why|how|explain|describe|can you tell|could you tell|qué|quién|dónde|cuándo|por qué|cómo|explica|cuéntame|pourquoi|comment|où|quand|qui|explique|décris|o que|por que|onde|quando|como|quem)/;

// Han script: Chinese / Japanese / Korean
const ZH_GREETING_SET = new Set([
  '你好',
  '您好',
  '嗨',
  '哈喽',
  '哈罗',
  '谢谢',
  '谢谢你',
  '谢谢您',
  '多谢',
  '感谢',
  '好的',
  '好',
  '嗯',
  '是的',
  '是',
  '对',
  '对的',
  '明白了',
  '知道了',
  '行',
  '可以',
  '早上好',
  '晚上好',
  '下午好',
  '早安',
  '晚安',
  'こんにちは',
  'ありがとう',
  'はい',
  'こんばんは',
  'おはよう',
  '안녕하세요',
  '감사합니다',
  '네',
]);

const ZH_IDENTITY_RE =
  /^(你是谁|您是谁|你能做什么|您能做什么|你叫什么名字|您叫什么名字|介绍一下你自己|介绍一下您自己|你是什么|您是什么|你有什么功能|您有什么功能|你会什么|你能干什么|你的名字是什么)/;

const ZH_TASK_VERB_RE =
  /写|创建|制作|构建|实现|修复|删除|运行|执行|生成|重构|安装|部署|测试|调试|提交|推送|下载|上传/;

// Devanagari script: Hindi / Marathi / Nepali
const DEVANAGARI_GREETING_RE =
  /^(नमस्ते|नमस्कार|हाँ|हां|ठीक है|धन्यवाद|शुक्रिया|हेलो|हाय|अच्छा|सही है|बिल्कुल|समझ गया|ठीक|हम्म)[\s!.,?]*$/;

const DEVANAGARI_IDENTITY_RE =
  /^(तुम कौन हो|आप कौन हैं|तुम क्या कर सकते|आप क्या कर सकते हैं|आपका नाम क्या है|तुम्हारा नाम क्या है|अपने बारे में बताओ|आप क्या हैं)/;

/**
 * Frontend mirror of the backend's `isConversationalPrompt` in core/agent/base.ts.
 * Returns true for greetings, identity questions, and knowledge Q&A that don't
 * require plan → approve → execute flow.
 *
 * Multilingual: en, zh (+ ja/ko), es, fr, pt, hi.
 * Used by `continueConversation` to decide whether to route through /plan.
 */
export function isConversationalPrompt(prompt: string): boolean {
  const clean = prompt
    .split('\n')
    .filter((l) => !l.trim().startsWith('['))
    .join('\n')
    .trim();
  if (!clean) return true;

  const charLen = [...clean].length;
  const lower = clean.toLowerCase();

  // East Asian scripts (Chinese / Japanese / Korean)
  if (EAST_ASIAN_SCRIPT_RE.test(clean)) {
    if (ZH_GREETING_SET.has(clean)) return true;
    if (ZH_IDENTITY_RE.test(clean)) return true;
    if (
      charLen <= 30 &&
      QUESTION_MARK_RE.test(clean) &&
      !ZH_TASK_VERB_RE.test(clean)
    )
      return true;
    return false;
  }

  // Devanagari script (Hindi / Marathi / Nepali)
  if (DEVANAGARI_SCRIPT_RE.test(clean)) {
    if (DEVANAGARI_GREETING_RE.test(clean)) return true;
    if (DEVANAGARI_IDENTITY_RE.test(clean)) return true;
    if (charLen <= 40 && QUESTION_MARK_RE.test(clean)) return true;
    return false;
  }

  // Latin and other scripts (en / es / fr / pt + fallback)
  if (charLen < 80 && LATIN_GREETING_RE.test(lower)) return true;
  if (LATIN_IDENTITY_RE.test(lower)) return true;

  const hasTaskKeywords = LATIN_TASK_KEYWORD_RE.test(lower);
  const startsWithQuestion = LATIN_QUESTION_START_RE.test(lower);
  if (startsWithQuestion && !hasTaskKeywords && charLen < 300) return true;

  return false;
}
