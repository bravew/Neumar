/**
 * Skill Extractor Service
 *
 * Distills a completed task session (messages) into a reusable SKILL.md file.
 * Follows the same strategy chain as title-generator.ts:
 * 1. Anthropic SDK (Haiku) — direct messages.create()
 * 2. OpenAI-compatible API — fallback for non-Anthropic providers
 * 3. Template fallback — no LLM, basic markdown structure
 */

import Anthropic from '@anthropic-ai/sdk';

import { logUsage } from '@/shared/services/usage-logger';
import { createLogger } from '@/shared/utils/logger';
import {
  getAuthHeader,
  getProviderHeaders,
} from '@/shared/utils/provider-headers';
import {
  getFastModelForProvider,
  isAnthropicNative,
  resolveApiCredentials,
  type OpenAIResponse,
} from '@/shared/utils/provider-resolution';

import type { Message } from '../db/types';

const logger = createLogger('SkillExtractor');

// ============================================================================
// Constants
// ============================================================================

/** Timeout for skill extraction LLM calls */
const EXTRACTION_TIMEOUT_MS = 30_000;

/** Fast model for extraction */
const ANTHROPIC_FAST_MODEL = 'claude-haiku-4-5-20251001';

/** Max chars for the compressed message transcript */
const MAX_TRANSCRIPT_CHARS = 10_000;

/** Max chars per individual message content */
const MAX_MESSAGE_CHARS = 500;

/** Max chars for tool input summary */
const MAX_TOOL_INPUT_CHARS = 200;

// ============================================================================
// Prompt
// ============================================================================

const SYSTEM_PROMPT = `You are a skill documentation writer for an AI agent system. Given a completed AI agent task session, extract a reusable SKILL.md file that captures the workflow as repeatable instructions.

Output format — output ONLY this content, no explanation or wrapper:

---
name: <skill name>
description: <one-line description>
---

# <Skill Name>

## Purpose
<What this skill accomplishes, in 1-2 sentences>

## When to Use
<Trigger conditions — when should the agent invoke this skill>

## Instructions
<Step-by-step instructions the agent should follow to replicate this workflow. Use numbered steps. Make them generic/reusable — parameterize specific file paths, names, and values.>

## Tool Usage
<Which tools are typically used and in what order>

## Notes
<Any important caveats, prerequisites, or configuration requirements>

Rules:
1. Output ONLY the SKILL.md content — no explanation, no code fences, no wrapper
2. Keep under 200 lines
3. Make instructions generic and reusable — do NOT hardcode specific file paths, variable names, or project-specific details from the original session
4. Capture the PATTERN of work, not the specific instance
5. Use clear, imperative language in instructions ("Read the file", "Search for the pattern")
6. If the session used specific tools, document the tool usage pattern`;

// ============================================================================
// Message Compression
// ============================================================================

/**
 * Compress a task's messages into a condensed transcript for LLM context.
 * Keeps user messages, assistant text, tool usage patterns, results, and plans.
 * Skips verbose tool_result output and errors.
 */
function compressMessages(messages: Message[]): string {
  const parts: string[] = [];
  let totalChars = 0;

  for (const msg of messages) {
    if (totalChars >= MAX_TRANSCRIPT_CHARS) break;

    let line: string | null = null;

    switch (msg.type) {
      case 'user':
        if (msg.content) {
          line = `[User]: ${msg.content.slice(0, MAX_MESSAGE_CHARS)}`;
        }
        break;
      case 'text':
        if (msg.content) {
          line = `[Assistant]: ${msg.content.slice(0, MAX_MESSAGE_CHARS)}`;
        }
        break;
      case 'tool_use':
        if (msg.tool_name) {
          const inputSummary = msg.tool_input
            ? ` — ${msg.tool_input.slice(0, MAX_TOOL_INPUT_CHARS)}`
            : '';
          line = `[Tool: ${msg.tool_name}]${inputSummary}`;
        }
        break;
      case 'result':
        if (msg.content) {
          line = `[Result]: ${msg.content.slice(0, MAX_MESSAGE_CHARS)}`;
        }
        break;
      case 'plan':
        if (msg.content) {
          line = `[Plan]: ${msg.content.slice(0, MAX_MESSAGE_CHARS)}`;
        }
        break;
      // Skip tool_result (too verbose) and error
      default:
        break;
    }

    if (line) {
      parts.push(line);
      totalChars += line.length;
    }
  }

  // If over budget, keep first third and last third
  const joined = parts.join('\n');
  if (joined.length > MAX_TRANSCRIPT_CHARS) {
    const third = Math.floor(parts.length / 3);
    const head = parts.slice(0, third).join('\n');
    const tail = parts.slice(-third).join('\n');
    return `${head}\n\n[... middle of session omitted for brevity ...]\n\n${tail}`;
  }

  return joined;
}

// ============================================================================
// Strategy 1: Anthropic SDK
// ============================================================================

async function callAnthropicSDK(
  apiKey: string,
  userContent: string,
  baseUrl?: string,
): Promise<string | null> {
  try {
    const client = new Anthropic({
      apiKey,
      ...(baseUrl ? { baseURL: baseUrl } : {}),
    });

    const start = Date.now();
    const response = await client.messages.create(
      {
        model: ANTHROPIC_FAST_MODEL,
        max_tokens: 4096,
        temperature: 0.2,
        system: [
          {
            type: 'text',
            text: SYSTEM_PROMPT,
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [{ role: 'user', content: userContent }],
      },
      { signal: AbortSignal.timeout(EXTRACTION_TIMEOUT_MS) },
    );

    const usageAny = response.usage as unknown as Record<string, number>;
    logUsage({
      callType: 'other',
      provider: 'anthropic',
      model: ANTHROPIC_FAST_MODEL,
      inputTokens: response.usage?.input_tokens,
      outputTokens: response.usage?.output_tokens,
      cacheReadTokens: usageAny?.cache_read_input_tokens,
      cacheCreationTokens: usageAny?.cache_creation_input_tokens,
      latencyMs: Date.now() - start,
    });

    const textBlock = response.content.find((block) => block.type === 'text');
    return textBlock && 'text' in textBlock ? textBlock.text.trim() : null;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('abort') || msg.includes('timeout')) {
      logger.warn('Anthropic SDK skill extraction timed out');
    } else {
      logger.warn('Anthropic SDK skill extraction failed:', msg);
    }
    return null;
  }
}

// ============================================================================
// Strategy 2: OpenAI-compatible API
// ============================================================================

async function callOpenAICompatAPI(
  apiKey: string,
  baseUrl: string,
  userContent: string,
  configuredModel?: string,
): Promise<string | null> {
  const model = getFastModelForProvider(baseUrl, configuredModel);
  let url = baseUrl.replace(/\/+$/, '');
  if (!url.endsWith('/chat/completions')) {
    if (/\/(?:api\/)?v\d+$/i.test(url)) {
      url += '/chat/completions';
    } else {
      if (!url.endsWith('/v1')) url += '/v1';
      url += '/chat/completions';
    }
  }

  const extraHeaders = getProviderHeaders(baseUrl, apiKey);
  const headers = {
    'Content-Type': 'application/json',
    ...getAuthHeader(baseUrl, apiKey),
    ...extraHeaders,
  };

  logger.info(`Skill extraction: using model "${model}"`);
  const start = Date.now();

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      temperature: 0.2,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
    }),
    signal: AbortSignal.timeout(EXTRACTION_TIMEOUT_MS),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => 'unknown');
    logger.error(`OpenAI-compat API error ${response.status}: ${errorBody}`);
    return null;
  }

  const data = (await response.json()) as OpenAIResponse;
  const usage = (data as Record<string, unknown>).usage as
    | {
        prompt_tokens?: number;
        completion_tokens?: number;
        prompt_tokens_details?: { cached_tokens?: number };
      }
    | undefined;
  logUsage({
    callType: 'other',
    provider: 'openai',
    model,
    inputTokens: usage?.prompt_tokens,
    outputTokens: usage?.completion_tokens,
    cacheReadTokens: usage?.prompt_tokens_details?.cached_tokens,
    latencyMs: Date.now() - start,
  });

  return data.choices?.[0]?.message?.content?.trim() || null;
}

// ============================================================================
// Strategy 3: Template Fallback (no LLM)
// ============================================================================

function buildTemplateFallback(
  taskPrompt: string,
  messages: Message[],
  skillName: string,
  skillDescription?: string,
): string {
  // Collect unique tool names used in order
  const seen = new Set<string>();
  const toolNames: string[] = [];
  for (const msg of messages) {
    if (msg.type === 'tool_use' && msg.tool_name && !seen.has(msg.tool_name)) {
      seen.add(msg.tool_name);
      toolNames.push(msg.tool_name);
    }
  }

  const toolSection =
    toolNames.length > 0
      ? toolNames.map((t) => `- ${t}`).join('\n')
      : '- No specific tools documented';

  return `---
name: ${skillName}
description: ${skillDescription || 'A custom skill extracted from a task session'}
---

# ${skillName}

## Purpose
${skillDescription || 'Extracted from a completed task session.'}

## When to Use
When the user requests a task similar to: "${taskPrompt.slice(0, 200)}"

## Instructions
1. Analyze the user's request
2. Follow the workflow pattern from the original task session
3. Adapt the approach to the current context

## Tool Usage
${toolSection}

## Notes
- This skill was auto-extracted from a task session without AI refinement
- Review and customize the instructions for your specific use case
`;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Extract a SKILL.md content from a task session's messages.
 *
 * Tries strategies in order:
 * 1. Anthropic SDK (Haiku) — direct messages.create()
 * 2. OpenAI-compatible API — for non-Anthropic providers
 * 3. Template fallback — no LLM, basic markdown
 */
export async function extractSkillContent(
  taskPrompt: string,
  messages: Message[],
  skillName: string,
  skillDescription?: string,
): Promise<string> {
  logger.info(
    `extractSkillContent: name="${skillName}", messageCount=${messages.length}`,
  );

  const transcript = compressMessages(messages);
  const userContent = `Skill name: ${skillName}
${skillDescription ? `Skill description: ${skillDescription}` : ''}

Original task prompt: "${taskPrompt}"

Session transcript:
${transcript}`;

  // Resolve API credentials via shared utility
  const { apiKey, baseUrl, model } = resolveApiCredentials();

  // Strategy 1: Anthropic SDK
  if (apiKey && isAnthropicNative(baseUrl)) {
    try {
      logger.info('[Strategy 1] Anthropic SDK: Haiku via messages.create()');
      const result = await callAnthropicSDK(apiKey, userContent, baseUrl);
      if (result && result.length > 50) {
        logger.info('Anthropic SDK skill extraction succeeded');
        return result;
      }
      logger.info(
        'Anthropic SDK returned insufficient content, trying next...',
      );
    } catch (error) {
      logger.warn(
        'Anthropic SDK skill extraction failed:',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  // Strategy 2: OpenAI-compatible API
  if (apiKey && baseUrl && !isAnthropicNative(baseUrl)) {
    try {
      logger.info(`[Strategy 2] OpenAI-compat API (${baseUrl})`);
      const result = await callOpenAICompatAPI(
        apiKey,
        baseUrl,
        userContent,
        model,
      );
      if (result && result.length > 50) {
        logger.info('OpenAI-compat skill extraction succeeded');
        return result;
      }
      logger.info(
        'OpenAI-compat returned insufficient content, using fallback...',
      );
    } catch (error) {
      logger.warn('OpenAI-compat skill extraction failed:', error);
    }
  }

  if (!apiKey) {
    logger.info('No API key configured, skipping LLM strategies');
  }

  // Strategy 3: Template fallback
  logger.info('[Strategy 3] Using template fallback for skill extraction');
  return buildTemplateFallback(
    taskPrompt,
    messages,
    skillName,
    skillDescription,
  );
}
