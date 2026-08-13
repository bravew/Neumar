/**
 * Dispatch Summary Generator
 *
 * Generates a structured summary when a dispatched (background) task completes.
 * Reuses the title-generator pattern: fast Haiku call for concise output.
 *
 * Input: task prompt + final assistant messages + list of tools used
 * Output: 2-3 sentence summary of what was accomplished
 */

import Anthropic from '@anthropic-ai/sdk';

import { createLogger } from '@/shared/utils/logger';
import { resolveApiCredentials } from '@/shared/utils/provider-resolution';

const logger = createLogger('DispatchSummary');

const SUMMARY_MODEL = 'claude-haiku-4-5-20251001';
const SUMMARY_TIMEOUT_MS = 10_000;
const MAX_SUMMARY_LENGTH = 300;

const SYSTEM_PROMPT = `You are a concise task summarizer. Given a user's original request and the agent's final output, write a 2-3 sentence summary of what was accomplished. Focus on outcomes, not process. Be specific about files created/modified, data produced, or actions taken. Do not use markdown formatting.`;

const ERROR_SYSTEM_PROMPT = `You are a concise task summarizer for an interrupted agent run. Given the user's original request, the work the agent completed before failing, and the error that stopped it, write 2-3 sentences that: (1) state what the agent DID finish, (2) name the failure in plain language, (3) suggest the next step the user can take to recover (e.g. "retry this turn", "start a new conversation", "check the model key"). Do not use markdown. Lead with the completed work, not the error.`;

/**
 * Generate a completion summary for a dispatched task.
 *
 * @param prompt - The original user prompt
 * @param assistantOutput - The final assistant messages (concatenated text)
 * @param toolsUsed - List of tool names that were invoked
 * @param errorContext - Optional error message — when provided, an error-aware
 *   summary is produced instead of a completion summary
 * @returns A 2-3 sentence summary, or null if generation fails
 */
export async function generateDispatchSummary(
  prompt: string,
  assistantOutput: string,
  toolsUsed: string[],
  errorContext?: string,
): Promise<string | null> {
  const isError = !!errorContext;
  try {
    const creds = resolveApiCredentials();
    if (!creds?.apiKey) {
      logger.warn('No API credentials available for summary generation');
      return buildFallbackSummary(prompt, toolsUsed, errorContext);
    }

    const client = new Anthropic({ apiKey: creds.apiKey });

    const userMessage = [
      `Original request: ${prompt}`,
      toolsUsed.length > 0 ? `Tools used: ${toolsUsed.join(', ')}` : '',
      `Agent output (last 2000 chars): ${assistantOutput.slice(-2000)}`,
      errorContext ? `Error that stopped the run: ${errorContext}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), SUMMARY_TIMEOUT_MS);
    let response: Anthropic.Message;
    try {
      response = await client.messages.create(
        {
          model: SUMMARY_MODEL,
          max_tokens: 150,
          system: isError ? ERROR_SYSTEM_PROMPT : SYSTEM_PROMPT,
          messages: [{ role: 'user', content: userMessage }],
        },
        { signal: controller.signal },
      );
    } finally {
      clearTimeout(timeoutId);
    }

    const text =
      response.content[0]?.type === 'text' ? response.content[0].text : null;

    if (text) {
      logger.info('Generated dispatch summary', {
        promptLength: prompt.length,
        summaryLength: text.length,
      });
      return text.slice(0, MAX_SUMMARY_LENGTH);
    }

    return buildFallbackSummary(prompt, toolsUsed, errorContext);
  } catch (error) {
    logger.warn('Failed to generate dispatch summary, using fallback', {
      error: error instanceof Error ? error.message : String(error),
    });
    return buildFallbackSummary(prompt, toolsUsed, errorContext);
  }
}

/**
 * Heuristic fallback when LLM call fails.
 */
function buildFallbackSummary(
  prompt: string,
  toolsUsed: string[],
  errorContext?: string,
): string {
  const truncatedPrompt =
    prompt.length > 100 ? `${prompt.slice(0, 97)}...` : prompt;

  if (errorContext) {
    const truncatedErr =
      errorContext.length > 160
        ? `${errorContext.slice(0, 157)}...`
        : errorContext;
    const toolsNote =
      toolsUsed.length > 0
        ? ` Completed ${toolsUsed.length} tool call${toolsUsed.length > 1 ? 's' : ''} before stopping.`
        : '';
    return `Run stopped before finishing "${truncatedPrompt}".${toolsNote} Error: ${truncatedErr}`;
  }

  if (toolsUsed.length > 0) {
    return `Completed task: "${truncatedPrompt}" using ${toolsUsed.length} tool${toolsUsed.length > 1 ? 's' : ''} (${toolsUsed.slice(0, 3).join(', ')}${toolsUsed.length > 3 ? '...' : ''}).`;
  }

  return `Completed task: "${truncatedPrompt}".`;
}
