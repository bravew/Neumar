import crypto from 'crypto';

import type { AgentMessage } from '@/core/agent/types';

import { ASK_USER_QUESTION_TOOL_NAME } from './instruction';
import type { AskUserQuestionPayload } from './schema';

/**
 * Construct the synthetic AG-UI `tool_use` event that the frontend's
 * AskUserQuestion handler (`src/shared/hooks/useAgent.ts`,
 * `src/components/task/TaskV2MessageBubbleAskUser.tsx`) already knows how
 * to render. The event shape is identical to what Claude's native
 * AskUserQuestion tool emits, so the consumer doesn't need to branch on
 * "was this a real tool call or a text-bridge synthesis".
 */
export function buildAskUserQuestionToolUse(
  payload: AskUserQuestionPayload,
  toolUseId: string = crypto.randomUUID(),
): AgentMessage {
  return {
    type: 'tool_use',
    name: ASK_USER_QUESTION_TOOL_NAME,
    id: toolUseId,
    input: payload as unknown as Record<string, unknown>,
  };
}
