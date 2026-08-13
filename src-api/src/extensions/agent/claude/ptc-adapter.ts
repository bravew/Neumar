/**
 * PTC Tool Adapter
 *
 * Converts Agent SDK tool() definitions into the format needed for the
 * Anthropic Messages API (used by PTC execution path).
 */

import type { SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

import { createLogger } from '@/shared/utils/logger';

import type { PTCToolDefinition, ToolHandler } from './ptc-types';

const logger = createLogger('ClaudeAgent:PTC:Adapter');

/**
 * Concrete input examples for key tools. Improves PTC accuracy by teaching
 * Claude correct parameter patterns for complex tools.
 * @see https://www.anthropic.com/engineering/advanced-tool-use
 */
const TOOL_INPUT_EXAMPLES: Record<string, Record<string, unknown>[]> = {
  linear_create_issue: [
    { title: 'Fix login timeout', priority: 2 },
    {
      title: 'Add dark mode',
      description: 'Support system dark mode preference',
      labelIds: ['label-ui'],
    },
  ],
  linear_update_issue: [
    { issueId: 'ENG-123', priority: 1 },
    { issueId: 'ENG-456', stateId: 'done-state-id' },
  ],
  linear_upload_file: [
    {
      issueId: 'ENG-123',
      filePath: '/path/to/screenshot.png',
      caption: 'Current UI screenshot',
    },
    {
      issueId: 'ENG-456',
      filename: 'error.log',
      contentText: '2026-04-11 ERROR: NullPointerException at...',
    },
  ],
  linear_search_issues: [
    { query: 'login bug', limit: 10 },
    { query: 'high priority unassigned' },
  ],
  google_gmail_send_message: [
    {
      to: 'alice@example.com',
      subject: 'Meeting notes',
      body: 'Hi Alice, here are the notes...',
    },
  ],
  google_calendar_create_event: [
    {
      calendarId: 'primary',
      summary: 'Team Standup',
      startDateTime: '2026-02-24T09:00:00-05:00',
      endDateTime: '2026-02-24T09:30:00-05:00',
      timeZone: 'America/New_York',
    },
  ],
  media_generate_image: [
    {
      prompt: 'A serene mountain landscape at sunset, photorealistic',
      count: 1,
      size: '1024x1024',
    },
  ],
  memory_store: [
    {
      content: 'User prefers dark mode in all applications',
      category: 'preference',
      importance: 0.8,
    },
  ],
};

export interface AdaptedTools {
  definitions: PTCToolDefinition[];
  handlers: Map<string, ToolHandler>;
}

/**
 * Convert Agent SDK tool() objects into PTC-compatible definitions and handlers.
 *
 * Uses Zod 4's built-in toJSONSchema() to convert input schemas.
 * Enriches tools with input_examples for better PTC accuracy.
 */
export function adaptMcpTools(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sdkTools: SdkMcpToolDefinition<any>[],
): AdaptedTools {
  const definitions: PTCToolDefinition[] = [];
  const handlers = new Map<string, ToolHandler>();

  for (const t of sdkTools) {
    try {
      // Convert Zod schema to JSON Schema using Zod 4 built-in
      const jsonSchema = z.toJSONSchema(z.object(t.inputSchema));

      definitions.push({
        name: t.name,
        description: t.description,
        input_schema: jsonSchema as Record<string, unknown>,
        input_examples: TOOL_INPUT_EXAMPLES[t.name],
      });

      // Wrap the handler — the PTC loop receives CallToolResult directly
      handlers.set(t.name, async (input: unknown) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return t.handler(input as any, {});
      });
    } catch (error) {
      logger.warn(
        `Failed to adapt tool "${t.name}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  logger.info(`Adapted ${definitions.length}/${sdkTools.length} tools for PTC`);
  return { definitions, handlers };
}

/**
 * Extract text content from a CallToolResult for inclusion in tool_result messages.
 */
export function extractToolResultText(
  result: Awaited<ReturnType<ToolHandler>>,
): string {
  if (!result.content || result.content.length === 0) {
    return '';
  }

  return result.content
    .filter(
      (block): block is { type: 'text'; text: string } => block.type === 'text',
    )
    .map((block) => block.text)
    .join('\n');
}
