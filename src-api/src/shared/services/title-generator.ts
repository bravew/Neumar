/**
 * Title Generator Service
 *
 * Generates concise, descriptive titles for AI chat sessions using an LLM call.
 * Based on research best practices: generate title AFTER the first AI response,
 * using BOTH the user message and AI response context.
 *
 * Strategy (in priority order):
 * 1. Anthropic SDK `messages.create()` — direct HTTP call with Haiku model,
 *    fast (~2s) vs Agent SDK query() which spawns a child process (~12s)
 * 2. OpenAI-compatible API — fallback for non-Anthropic providers
 *    (GPT-4o-mini, Flash, etc.)
 * 3. Smart fallback — heuristic-based title from prompt + AI context, no LLM
 */

import Anthropic from '@anthropic-ai/sdk';

import { logUsage } from '@/shared/services/usage-logger';
import { createLogger } from '@/shared/utils/logger';
import {
  getAuthHeader,
  getProviderHeaders,
} from '@/shared/utils/provider-headers';
import {
  FREE_MODEL_FALLBACK,
  getFastModelForProvider,
  isAnthropicNative,
  resolveApiCredentials,
  type OpenAIResponse,
} from '@/shared/utils/provider-resolution';

const logger = createLogger('TitleGenerator');

// ============================================================================
// Constants
// ============================================================================

/** Maximum title length in characters */
const MAX_TITLE_LENGTH = 80;

/** Timeout for raw API title generation (8 seconds) */
const TITLE_GENERATION_TIMEOUT_MS = 8_000;

/** Timeout for direct Anthropic SDK title generation */
const SDK_TITLE_TIMEOUT_MS = 10_000;

/** Fast model for title generation */
const ANTHROPIC_FAST_MODEL = 'claude-haiku-4-5';

/** Map locale codes to human-readable language names */
const LOCALE_TO_LANGUAGE: Record<string, string> = {
  'en-US': 'English',
  'zh-CN': 'Chinese (Simplified)',
  'es-ES': 'Spanish',
  'fr-FR': 'French',
};

/** Localized "New Conversation" fallback for supported languages */
const NEW_CONVERSATION_LABEL: Record<string, string> = {
  'en-US': 'New Conversation',
  'zh-CN': '新对话',
  'es-ES': 'Nueva Conversación',
  'fr-FR': 'Nouvelle Conversation',
};

// ============================================================================
// Prompt Builder
// ============================================================================

/**
 * Build system prompt for the raw API path (where system/user are separate).
 */
function buildTitleSystemPrompt(language?: string): string {
  const langName =
    (language && LOCALE_TO_LANGUAGE[language]) || LOCALE_TO_LANGUAGE['en-US'];
  const isEnglish = !language || language.startsWith('en');

  let examples: string;
  if (language === 'zh-CN') {
    examples = `示例:
- 用户: "get gold price" + AI查询了黄金价格 → "实时黄金价格查询"
- 用户: "hello" + AI讨论编程 → "编程入门帮助"
- 用户: "fix my login bug" → "登录认证问题调试"
- 用户: "你好" 无上下文 → "新对话"`;
  } else if (language === 'es-ES') {
    examples = `Ejemplos:
- User: "get gold price" + AI context about gold → "Consulta De Precio Del Oro"
- User: "fix my login bug" → "Depuración De Autenticación"
- User: "hola" sin contexto → "Nueva Conversación"`;
  } else if (language === 'fr-FR') {
    examples = `Exemples:
- User: "get gold price" + AI context about gold → "Consultation Du Prix De L'Or"
- User: "fix my login bug" → "Débogage D'Authentification"
- User: "bonjour" sans contexte → "Nouvelle Conversation"`;
  } else {
    examples = `Examples:
- User: "get gold price" + AI context about gold → "Real-Time Gold Price Lookup"
- User: "hello" + AI talks about coding → "Getting Started With Coding Help"
- User: "fix my login bug" → "Debug Login Authentication Issue"
- User: "how are you doing today" → "General Chat Session"`;
  }

  return `You generate short topic titles (3-8 words) for AI chat conversations.

CRITICAL RULES:
1. Output ONLY the title text — no quotes, no prefix, no trailing punctuation.
2. The title MUST be written in ${langName}. ${isEnglish ? '' : `Even if the user wrote in English, your title must be in ${langName}.`}
3. NEVER just capitalize or translate the user's message. Summarize the TOPIC based on the AI response context.
4. When AI response context is provided, use it to create a descriptive summary title.
5. For greetings without context, use "${getNewConversationLabel(language)}".

${examples}`;
}

// ============================================================================
// Strategy 1: Direct Anthropic SDK (messages.create)
// ============================================================================

/**
 * Generate title using the Anthropic SDK's `messages.create()` directly.
 * This is a lightweight HTTP call — no process spawning like the Agent SDK's
 * `query()` which boots a full Claude Code child process (~12s overhead).
 *
 * Uses Haiku model for fast, cheap responses.
 */
async function callAnthropicSDK(
  apiKey: string,
  titlePrompt: string,
  baseUrl?: string,
  language?: string,
): Promise<string | null> {
  try {
    const client = new Anthropic({
      apiKey,
      ...(baseUrl ? { baseURL: baseUrl } : {}),
    });

    const titleStart = Date.now();
    const response = await client.messages.create(
      {
        model: ANTHROPIC_FAST_MODEL,
        max_tokens: 30,
        temperature: 0.3,
        system: [
          {
            type: 'text',
            text: buildTitleSystemPrompt(language),
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [{ role: 'user', content: titlePrompt }],
      },
      { signal: AbortSignal.timeout(SDK_TITLE_TIMEOUT_MS) },
    );

    // Log title generation usage
    const usageAny = response.usage as unknown as Record<string, number>;
    logUsage({
      callType: 'title',
      provider: 'anthropic',
      model: ANTHROPIC_FAST_MODEL,
      inputTokens: response.usage?.input_tokens,
      outputTokens: response.usage?.output_tokens,
      cacheReadTokens: usageAny?.cache_read_input_tokens,
      cacheCreationTokens: usageAny?.cache_creation_input_tokens,
      latencyMs: Date.now() - titleStart,
    });

    const textBlock = response.content.find((block) => block.type === 'text');
    return textBlock && 'text' in textBlock ? textBlock.text.trim() : null;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('abort') || msg.includes('timeout')) {
      logger.warn('Anthropic SDK title generation timed out');
    } else {
      logger.warn('Anthropic SDK title generation failed:', msg);
    }
    return null;
  }
}

// ============================================================================
// Strategy 2: Raw API Calls
// ============================================================================

/**
 * Send a single chat completion request and return the response.
 * Handles max_completion_tokens vs max_tokens fallback.
 */
async function doOpenAICompatRequest(
  url: string,
  headers: Record<string, string>,
  model: string,
  messages: Array<{ role: string; content: string }>,
): Promise<Response> {
  // Try with max_completion_tokens first (newer OpenAI models require it)
  let response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      max_completion_tokens: 30,
      temperature: 0.3,
      messages,
    }),
    signal: AbortSignal.timeout(TITLE_GENERATION_TIMEOUT_MS),
  });

  if (response.status === 400) {
    logger.info('Title gen: retrying with legacy max_tokens');
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        max_tokens: 30,
        temperature: 0.3,
        messages,
      }),
      signal: AbortSignal.timeout(TITLE_GENERATION_TIMEOUT_MS),
    });
  }

  return response;
}

async function callOpenAICompatAPI(
  apiKey: string,
  baseUrl: string,
  titleInput: string,
  language?: string,
  configuredModel?: string,
): Promise<string | null> {
  const model = getFastModelForProvider(baseUrl, configuredModel);
  // Build URL carefully: if base URL already has a version path (e.g., /api/v3),
  // don't add /v1 again — just append /chat/completions
  let url = baseUrl.replace(/\/+$/, '');
  if (!url.endsWith('/chat/completions')) {
    if (/\/(?:api\/)?v\d+$/i.test(url)) {
      url += '/chat/completions';
    } else {
      if (!url.endsWith('/v1')) url += '/v1';
      url += '/chat/completions';
    }
  }

  const messages = [
    { role: 'system', content: buildTitleSystemPrompt(language) },
    { role: 'user', content: titleInput },
  ];

  // OpenRouter free models require HTTP-Referer and X-Title headers
  const extraHeaders = getProviderHeaders(baseUrl, apiKey);
  const headers = {
    'Content-Type': 'application/json',
    ...getAuthHeader(baseUrl, apiKey),
    ...extraHeaders,
  };

  logger.info(`Title gen: using model "${model}"`);
  const titleStart = Date.now();
  let response = await doOpenAICompatRequest(url, headers, model, messages);

  // If a free model fails (OpenRouter data policy or 404), fall back to
  // a known cheap paid model for that provider.
  if (!response.ok && model.includes(':free')) {
    await response.text().catch(() => ''); // drain body
    logger.warn(
      `Free model "${model}" failed (${response.status}), trying paid fallback`,
    );

    const lower = baseUrl.toLowerCase();
    const fallbackModel = Object.entries(FREE_MODEL_FALLBACK).find(([p]) =>
      lower.includes(p),
    )?.[1];

    if (fallbackModel) {
      logger.info(`Title gen: retrying with paid model "${fallbackModel}"`);
      response = await doOpenAICompatRequest(
        url,
        headers,
        fallbackModel,
        messages,
      );
    }
  }

  if (!response.ok) {
    const errorBody = await response.text().catch(() => 'unknown');
    logger.error(`OpenAI-compat API error ${response.status}: ${errorBody}`);
    return null;
  }

  const data = (await response.json()) as OpenAIResponse;

  // Log OpenAI-compat title generation usage
  const usage = (data as Record<string, unknown>).usage as
    | {
        prompt_tokens?: number;
        completion_tokens?: number;
        prompt_tokens_details?: { cached_tokens?: number };
      }
    | undefined;
  logUsage({
    callType: 'title',
    provider: 'openai',
    model,
    inputTokens: usage?.prompt_tokens,
    outputTokens: usage?.completion_tokens,
    cacheReadTokens: usage?.prompt_tokens_details?.cached_tokens,
    latencyMs: Date.now() - titleStart,
  });

  return data.choices?.[0]?.message?.content?.trim() || null;
}

// ============================================================================
// Strategy 3: Smart Fallback (no LLM)
// ============================================================================

/** Greetings in various languages */
const GREETING_ONLY_PATTERN =
  /^(hi|hello|hey|greetings|good\s+(morning|afternoon|evening)|yo|sup|howdy|how\s+are\s+you|what'?s?\s+up|how'?s?\s+it\s+going|nice\s+to\s+meet|你好|嗨|哈喽|hola|bonjour|salut)[,!?.\s]*$/i;

/** AI assistant greeting responses (e.g., "Hello! I'm X, your assistant...") */
const AI_GREETING_PATTERN =
  /^(hi|hello|hey|greetings)[!,.]?\s+(i'?m|there|welcome|how\s+can\s+i)/i;

const GREETING_PREFIX_PATTERN =
  /^(hi|hello|hey|greetings|good\s+(morning|afternoon|evening)|yo|sup|howdy)[,!.\s]+/i;

const PROMPT_FILLER_PATTERN =
  /\b(please|can you|could you|i want to|i need to|i'd like to|help me|help me to)\b/gi;

const LEADING_INSTRUCTION_PATTERN =
  /^(?:in\s+(?:one|two|three|four|five|\d+)(?:\s+or\s+(?:one|two|three|four|five|\d+))?\s+(?:short\s+)?(?:sentences?|words?|paragraphs?),?\s*)/i;

function getNewConversationLabel(language?: string): string {
  return (language && NEW_CONVERSATION_LABEL[language]) || 'New Conversation';
}

/**
 * Enhanced smart fallback: produces better titles without any LLM call.
 *
 * Strategy:
 * 1. If AI context is available, extract keywords from it (much better than user prompt alone)
 * 2. Strip common greetings, filler words, and noise
 * 3. Apply intelligent title casing
 * 4. Handle CJK text (Chinese/Japanese/Korean) differently — no word splitting needed
 */
function smartTruncate(
  prompt: string,
  language?: string,
  aiContext?: string,
): string {
  // If the entire prompt is just a greeting
  if (GREETING_ONLY_PATTERN.test(prompt.trim())) {
    // If we have AI context, try to extract a title from it
    if (aiContext) {
      const contextTitle = extractTitleFromContext(aiContext, language);
      if (contextTitle) return contextTitle;
    }
    return getNewConversationLabel(language);
  }

  // If we have AI context (plan goal/steps), prefer it over the raw prompt
  if (aiContext) {
    const contextTitle = extractTitleFromContext(aiContext, language);
    if (contextTitle) return contextTitle;
  }

  // Fall back to extracting from the user prompt
  return extractTitleFromPrompt(prompt, language);
}

/**
 * Extract a meaningful title from AI response context.
 * Handles plan goals (e.g., "Goal: 查询当前黄金价格") and plain text.
 */
function extractTitleFromContext(
  context: string,
  _language?: string,
): string | null {
  // Extract goal if present (e.g., "Goal: ..." or "目标: ...")
  const goalMatch = context.match(
    /(?:Goal|目标|Objetivo|Objectif)\s*[:：]\s*(.+?)(?:\n|$)/i,
  );
  if (goalMatch?.[1]) {
    const goal = goalMatch[1].trim();
    // For CJK text, use the goal directly (already concise)
    if (hasCJK(goal)) {
      return goal.slice(0, MAX_TITLE_LENGTH);
    }
    return toTitleCase(goal.split(/\s+/).slice(0, 8).join(' ')).slice(
      0,
      MAX_TITLE_LENGTH,
    );
  }

  // Extract the first meaningful line/sentence from context
  const lines = context
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 2 && !l.startsWith('Steps:'));

  const firstLine = lines[0];
  if (firstLine) {
    // Skip if the AI context itself starts with a greeting (e.g., "Hello! I'm ...")
    // — this is the AI introducing itself, not a meaningful topic
    if (
      GREETING_ONLY_PATTERN.test(firstLine) ||
      AI_GREETING_PATTERN.test(firstLine)
    ) {
      return null;
    }
    if (hasCJK(firstLine)) {
      // For CJK, take up to 20 chars as title
      return firstLine.slice(0, 20);
    }
    // For alphabetic text, take first 8 words
    const words = firstLine.split(/\s+/).slice(0, 8).join(' ');
    return toTitleCase(words).slice(0, MAX_TITLE_LENGTH);
  }

  return null;
}

/**
 * Extract a title from the user's prompt.
 * Strips greetings, filler, and applies Title Case.
 */
function extractTitleFromPrompt(prompt: string, language?: string): string {
  // Remove common greetings at the start
  const cleaned = prompt.replace(GREETING_PREFIX_PATTERN, '').trim();

  if (!cleaned || cleaned.length < 3) {
    return getNewConversationLabel(language);
  }

  // For CJK text, just take the first portion
  if (hasCJK(cleaned)) {
    const firstSentence = cleaned.split(/[。！？\n]/)[0]?.trim() || cleaned;
    return firstSentence.slice(0, 20);
  }

  // Remove filler words for more concise titles
  const concise = cleaned
    .replace(PROMPT_FILLER_PATTERN, '')
    .replace(/\s+/g, ' ')
    .trim();
  const text = concise.length > 3 ? concise : cleaned;

  const candidate = normalizePromptTitleCandidate(text);
  if (!candidate) return getNewConversationLabel(language);
  const title = toSentenceCase(firstMeaningfulClause(candidate));
  if (!title) return getNewConversationLabel(language);

  return truncateTitle(title);
}

function normalizePromptTitleCandidate(text: string): string {
  const withoutInstruction = text
    .replace(LEADING_INSTRUCTION_PATTERN, '')
    .trim();
  if (!withoutInstruction) return '';
  const explorationMatch = withoutInstruction.match(
    /^what\s+(?:kind|kinds|type|types)\s+of\s+(.+?)\s+should\s+(?:we|i)\s+(.+?)\??$/i,
  );
  if (explorationMatch?.[1] && explorationMatch[2]) {
    return `${explorationMatch[1].trim()} to ${explorationMatch[2].trim().replace(/\?$/, '')}`;
  }
  return withoutInstruction;
}

function firstMeaningfulClause(text: string): string {
  const firstSentence = text.split(/[.!?\n;]/)[0]?.trim() || text;
  const firstClause = firstSentence.split(',')[0]?.trim();
  return firstClause && firstClause.length >= 8 ? firstClause : firstSentence;
}

function toSentenceCase(text: string): string {
  const clean = text.replace(/[.!?]+$/g, '').trim();
  if (!clean) return clean;
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

function truncateTitle(title: string): string {
  if (title.length <= MAX_TITLE_LENGTH) return title;
  const truncated = title.slice(0, MAX_TITLE_LENGTH).replace(/\s+\S*$/, '');
  return truncated.trim() || title.slice(0, MAX_TITLE_LENGTH).trim();
}

/** Check if text contains CJK characters */
function hasCJK(text: string): boolean {
  return /[\u4e00-\u9fff\u3400-\u4dbf\u{20000}-\u{2a6df}\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/u.test(
    text,
  );
}

/** Apply Title Case to English text */
function toTitleCase(text: string): string {
  const minorWords = new Set([
    'a',
    'an',
    'the',
    'and',
    'but',
    'or',
    'for',
    'nor',
    'on',
    'at',
    'to',
    'by',
    'in',
    'of',
    'with',
    'is',
    'it',
  ]);

  return text.replace(/\b\w+/g, (word, index) => {
    if (index === 0 || !minorWords.has(word.toLowerCase())) {
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    }
    return word.toLowerCase();
  });
}

// ============================================================================
// Title Cleanup
// ============================================================================

/** Clean up common LLM output quirks from a generated title */
function cleanTitle(raw: string): string {
  return raw
    .replace(/^["'`]|["'`]$/g, '') // Remove surrounding quotes
    .replace(/^(Title:|title:|标题[:：])\s*/i, '') // Remove prefixes
    .replace(/\.+$/, '') // Remove trailing periods
    .replace(/\n.*/s, '') // Take only the first line
    .trim()
    .slice(0, MAX_TITLE_LENGTH);
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Generate a concise title for a conversation.
 *
 * Tries strategies in order:
 * 1. Anthropic SDK (Haiku) — direct messages.create() call, fast and lightweight
 * 2. OpenAI-compatible API — fallback for non-Anthropic providers
 * 3. Smart fallback — heuristic-based, no LLM needed at all
 *
 * @param userPrompt - The user's initial message
 * @param aiContext - Optional AI response or plan summary for better context
 * @param modelConfig - Optional model config override (apiKey, baseUrl, model)
 * @param language - App locale (e.g., 'zh-CN') for title language
 * @returns Generated title string
 */
/**
 * Strip a leading `Skill: <slug>` line injected by a plugin's SessionStart
 * "discipline anchor", so titles reflect the real response instead of the
 * anchor prefix. Mirrors the frontend `stripSkillAnchor`
 * (src/shared/lib/skill-anchor.ts).
 */
const SKILL_ANCHOR_RE =
  /^[ \t]*Skill:[ \t]*[a-z][a-z0-9]*(?:-[a-z0-9]+)*[ \t]*(?:\([^)]*\))?[ \t]*(?:\r?\n|$)/;

function stripSkillAnchor(text: string): string {
  const match = SKILL_ANCHOR_RE.exec(text);
  return match ? text.slice(match[0].length).replace(/^\s*\n/, '') : text;
}

export async function generateTitle(
  userPrompt: string,
  aiContext?: string,
  modelConfig?: { apiKey?: string; baseUrl?: string; model?: string },
  language?: string,
): Promise<string> {
  // Defense-in-depth: also strip here in case a caller sends raw content.
  if (aiContext) aiContext = stripSkillAnchor(aiContext);
  logger.info(
    `generateTitle: language=${language}, hasContext=${!!aiContext}, hasApiKey=${!!modelConfig?.apiKey}`,
  );

  // -----------------------------------------------------------
  // Resolve API credentials
  // Respects the user's model routing selection from Settings.
  // The frontend (getTitleModelConfig) already resolves the routing chain:
  //   1. Task-specific routing for 'titleGeneration'
  //   2. Selected default provider
  //   3. Any provider with an API key
  // We honour that choice here. Only fall back to env vars / provider
  // config when the frontend sends no modelConfig.
  // -----------------------------------------------------------
  const {
    apiKey: resolvedApiKey,
    baseUrl: resolvedBaseUrl,
    model: resolvedModel,
  } = resolveApiCredentials(modelConfig);

  // Codex models (e.g. 'codex:gpt-5.4') are Codex CLI-only models that run
  // against the OpenAI API. When one is selected, the provider has no baseUrl,
  // which makes isAnthropicNative() return true — causing the Anthropic strategy
  // to be tried with an OpenAI key (and fail). Force OpenAI base URL so we
  // land on Strategy 2 (OpenAI-compat) with gpt-4o-mini for title generation.
  const effectiveBaseUrl =
    resolvedModel?.startsWith('codex:') && !resolvedBaseUrl
      ? 'https://api.openai.com/v1'
      : resolvedBaseUrl;

  // Build user message for API paths (language embedded in message)
  const langName =
    (language && LOCALE_TO_LANGUAGE[language]) || LOCALE_TO_LANGUAGE['en-US'];
  const isNonEnglish = language && !language.startsWith('en');
  let apiTitleInput = `User message: "${userPrompt}"`;
  if (aiContext) {
    apiTitleInput += `\nAI response/plan context: "${aiContext.slice(0, 300)}"`;
  }
  if (isNonEnglish) {
    apiTitleInput += `\n\nIMPORTANT: Generate the title in ${langName}. Do NOT use English.`;
  }

  // -----------------------------------------------------------
  // Strategy 1: Anthropic SDK (messages.create) — direct HTTP
  // Used when the resolved provider is Anthropic-native
  // -----------------------------------------------------------
  if (resolvedApiKey && isAnthropicNative(effectiveBaseUrl)) {
    try {
      logger.info('[Strategy 1] Anthropic SDK: Haiku via messages.create()');
      const sdkTitle = await callAnthropicSDK(
        resolvedApiKey,
        apiTitleInput,
        effectiveBaseUrl,
        language,
      );
      if (sdkTitle) {
        const cleaned = cleanTitle(sdkTitle);
        if (cleaned.length > 0) {
          logger.info(`Anthropic SDK generated title: "${cleaned}"`);
          return cleaned;
        }
      }
      logger.info(
        'Anthropic SDK returned empty, falling back to next strategy...',
      );
    } catch (error) {
      logger.warn(
        'Anthropic SDK title generation failed:',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  // -----------------------------------------------------------
  // Strategy 2: OpenAI-compatible API (for non-Anthropic providers)
  // Used when the user selected OpenRouter, OpenAI, Groq, etc.
  // -----------------------------------------------------------
  if (resolvedApiKey && !isAnthropicNative(effectiveBaseUrl)) {
    try {
      logger.info(`[Strategy 2] OpenAI-compat API (${effectiveBaseUrl})`);
      const title = await callOpenAICompatAPI(
        resolvedApiKey,
        effectiveBaseUrl!,
        apiTitleInput,
        language,
        resolvedModel,
      );

      if (title) {
        const cleaned = cleanTitle(title);
        if (cleaned.length > 0) {
          logger.info(`OpenAI-compat API generated title: "${cleaned}"`);
          return cleaned;
        }
      }
      logger.info('OpenAI-compat API returned empty, using smart fallback...');
    } catch (error) {
      logger.warn('OpenAI-compat API title generation failed:', error);
    }
  }

  if (!resolvedApiKey) {
    logger.info('No API key configured, skipping LLM strategies');
  }

  // -----------------------------------------------------------
  // Strategy 3: Smart fallback (no LLM needed)
  // Use the user's first message directly — not the agent reply.
  // -----------------------------------------------------------
  logger.info('[Strategy 3] Using smart fallback for title generation');
  return smartTruncate(userPrompt, language, aiContext);
}
