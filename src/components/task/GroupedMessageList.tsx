/**
 * @deprecated This component is superseded by TaskV2Thread which uses
 * react-virtuoso for virtualized rendering. Kept for backward compatibility
 * with legacy V1 task views. Do not use in new code.
 */
import React from 'react';

import type { Artifact } from '@/components/artifacts/types';
import { BranchNavigator } from '@/components/task/BranchNavigator';
import { ErrorMessage } from '@/components/task/ErrorMessage';
import { LocalOutputArtifactPreviews } from '@/components/task/LocalOutputArtifactPreviews';
import { MessageToolbar } from '@/components/task/MessageToolbar';
import { PlanApproval } from '@/components/task/PlanApproval';
import type {
  AGUIMessage,
  AGUIToolCall,
} from '@/components/task/TaskV2MessageBubble';
import {
  MessageBubble,
  ToolCallGroup,
} from '@/components/task/TaskV2MessageBubble';
import { getToolName } from '@/components/task/TaskV2MessageBubble.types';
import { UserMessageBubble } from '@/components/task/UserMessageBubble';
import { getSettings } from '@/shared/db/settings';
import type { TaskPlan } from '@/shared/hooks/agent-types';
import type { MessageAttachment } from '@/shared/hooks/useAgent';
import type { BranchMeta } from '@/shared/stores/branch-store';

/** Detect raw JSON plan objects from the agent stream (shown via plan-approval card). */
function isPlanJson(content: string): boolean {
  const trimmed = content.trimStart();
  if (!trimmed.startsWith('{')) return false;
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === 'object' && parsed.type === 'plan';
  } catch {
    return false;
  }
}

// ── Grouped item types ───────────────────────────────────────────────────────

export type GroupedItem =
  | { type: 'message'; key: string; msg: AGUIMessage }
  | {
      type: 'tool-group';
      key: string;
      toolCalls: AGUIToolCall[];
    }
  | {
      type: 'plan-approval';
      key: string;
      plan: TaskPlan;
      isWaitingApproval: boolean;
    }
  | {
      type: 'branch-nav';
      key: string;
      forkPointId: string | number;
      branches: BranchMeta[];
      currentIndex: number;
      totalBranches: number;
    }
  | {
      type: 'output-artifacts';
      key: string;
      artifacts: Artifact[];
    };

/**
 * Pure function that converts a flat message array into grouped items.
 * Used by Virtuoso for virtualized rendering.
 */
export function groupMessages(
  messages: AGUIMessage[],
  pendingPlan: TaskPlan | null,
  isWaitingApproval: boolean,
): GroupedItem[] {
  const items: GroupedItem[] = [];
  let planInserted = false;
  let i = 0;
  // Set right after a tool-group containing an AskUserQuestion call; consumed
  // by the very next message. AskUserQuestionCard already renders that
  // answer inline as its "answered" state, so the plain user bubble here
  // would just duplicate it.
  let awaitingQuestionAnswer = false;

  while (i < messages.length) {
    const msg = messages[i];
    const wasAwaitingQuestionAnswer = awaitingQuestionAnswer;
    awaitingQuestionAnswer = false;
    if (wasAwaitingQuestionAnswer && msg.role === 'user') {
      i++;
      continue;
    }

    // Insert plan card after the first user message
    if (!planInserted && pendingPlan && msg.role === 'user') {
      items.push({ type: 'message', key: msg.id, msg });
      items.push({
        type: 'plan-approval',
        key: 'plan-card',
        plan: pendingPlan,
        isWaitingApproval,
      });
      planInserted = true;
      i++;
      continue;
    }

    // Skip tool result messages — consumed by tool-group
    if (msg.role === 'tool') {
      i++;
      continue;
    }

    // Skip reasoning messages — they clutter the UI
    if (msg.role === 'reasoning') {
      i++;
      continue;
    }

    // Skip plan messages — raw JSON plan objects from the agent stream.
    // These are handled by the plan-approval card, not as regular messages.
    if (msg.role === 'assistant' && msg.content && !msg.toolCalls?.length) {
      if (isPlanJson(msg.content)) {
        i++;
        continue;
      }
    }

    // Group consecutive tool-call-only / reasoning / tool-result messages
    // into one collapsible block. Also absorbs adjacent reasoning blocks.
    const isToolOnly =
      msg.role === 'assistant' &&
      msg.toolCalls &&
      msg.toolCalls.length > 0 &&
      !msg.content?.trim();
    if (isToolOnly) {
      const grouped: AGUIToolCall[] = [...msg.toolCalls!];
      let j = i + 1;
      while (j < messages.length) {
        const next = messages[j];
        if (next.role === 'tool' || next.role === 'reasoning') {
          j++;
          continue;
        }
        if (
          next.role === 'assistant' &&
          next.toolCalls?.length &&
          !next.content?.trim()
        ) {
          grouped.push(...next.toolCalls);
          j++;
          continue;
        }
        break;
      }
      items.push({
        type: 'tool-group',
        key: `tg-${msg.id}`,
        toolCalls: grouped,
      });
      awaitingQuestionAnswer = grouped.some(
        (tc) => getToolName(tc) === 'AskUserQuestion',
      );
      i = j;
      continue;
    }

    // Regular message
    items.push({ type: 'message', key: msg.id, msg });
    i++;
  }

  return items;
}

// ── Component (renders GroupedItem[] to JSX) ─────────────────────────────────

/** @deprecated Use TaskV2Thread with react-virtuoso instead. */
export function GroupedMessageList({
  messages,
  pendingPlan,
  isWaitingApproval,
  thinkingLabel,
  attachmentMap,
  onSendMessage,
  onApprovePlan,
  onRejectPlan,
  onCancelTool,
}: {
  messages: AGUIMessage[];
  pendingPlan: TaskPlan | null;
  isWaitingApproval: boolean;
  thinkingLabel: string;
  attachmentMap: Map<string, MessageAttachment[]>;
  onSendMessage: (text: string) => void;
  onApprovePlan: () => void;
  onRejectPlan: () => void;
  onCancelTool?: (toolUseId: string) => void;
}) {
  const items = groupMessages(messages, pendingPlan, isWaitingApproval);

  return (
    <>
      {items.map((item) =>
        renderGroupedItem(item, {
          thinkingLabel,
          attachmentMap,
          messages,
          onSendMessage,
          onApprovePlan,
          onRejectPlan,
          onCancelTool,
        }),
      )}
    </>
  );
}

// ── Shared item renderer (used by both GroupedMessageList and Virtuoso) ──────

export interface GroupedItemRenderContext {
  thinkingLabel: string;
  attachmentMap: Map<string, MessageAttachment[]>;
  messages: AGUIMessage[];
  allArtifacts?: Artifact[];
  onSendMessage: (text: string) => void;
  onApprovePlan: () => void;
  onRejectPlan: () => void;
  onCancelTool?: (toolUseId: string) => void;
  onEditMessage?: (messageId: string, newContent: string) => void;
  onRegenerate?: (messageId: string) => void;
  onForkFromHere?: (messageId: string) => void;
  onBranchNavigate?: (
    forkPointId: string | number,
    direction: 'prev' | 'next',
  ) => void;
}

/**
 * Prefer the attachments field on the message (from DB/snapshot), falling
 * back to the in-memory attachmentMap. The map is only populated for the
 * current session's submits; once the user navigates away, only the
 * message-side payload survives.
 */
function resolveAttachments(
  msg: AGUIMessage,
  map: Map<string, MessageAttachment[]>,
): MessageAttachment[] | undefined {
  if (msg.attachments) {
    try {
      const parsed = JSON.parse(msg.attachments) as MessageAttachment[];
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch {
      /* fall through to map */
    }
  }
  return map.get(msg.id);
}

export function renderGroupedItem(
  item: GroupedItem,
  ctx: GroupedItemRenderContext,
): React.ReactNode {
  switch (item.type) {
    case 'message':
      // User messages use the editable UserMessageBubble
      if (item.msg.role === 'user') {
        return (
          <UserMessageBubble
            key={item.key}
            messageId={item.msg.id}
            content={item.msg.content}
            attachments={resolveAttachments(item.msg, ctx.attachmentMap)}
            onEditMessage={ctx.onEditMessage}
          />
        );
      }
      if (item.msg.isError) {
        return (
          <div key={item.key} className="mx-auto max-w-4xl px-4">
            <ErrorMessage
              message={item.msg.content}
              subtype={item.msg.subtype}
            />
          </div>
        );
      }
      return (
        <React.Fragment key={item.key}>
          <MessageBubble
            message={item.msg}
            thinkingLabel={ctx.thinkingLabel}
            attachments={resolveAttachments(item.msg, ctx.attachmentMap)}
            allMessages={ctx.messages}
            allArtifacts={ctx.allArtifacts}
            onSendMessage={ctx.onSendMessage}
            onCancelTool={ctx.onCancelTool}
          />
          {item.msg.content && (
            <MessageToolbar
              content={item.msg.content}
              onRetry={
                ctx.onRegenerate
                  ? () => ctx.onRegenerate!(item.msg.id)
                  : undefined
              }
              onFork={
                ctx.onForkFromHere
                  ? () => ctx.onForkFromHere!(item.msg.id)
                  : undefined
              }
            />
          )}
        </React.Fragment>
      );
    case 'output-artifacts':
      return (
        <LocalOutputArtifactPreviews
          key={item.key}
          artifacts={item.artifacts}
        />
      );
    case 'tool-group':
      return (
        <ToolCallGroup
          key={item.key}
          toolCalls={item.toolCalls}
          allMessages={ctx.messages}
          onSendMessage={ctx.onSendMessage}
          onCancelTool={ctx.onCancelTool}
        />
      );
    case 'plan-approval':
      return (
        <PlanApproval
          key={item.key}
          plan={item.plan}
          isWaitingApproval={item.isWaitingApproval}
          autoExecute={(getSettings().planMode ?? 'on') === 'auto'}
          onApprove={ctx.onApprovePlan}
          onReject={ctx.onRejectPlan}
        />
      );
    case 'branch-nav':
      return (
        <BranchNavigator
          key={item.key}
          totalBranches={item.totalBranches}
          currentIndex={item.currentIndex}
          onPrevious={() => ctx.onBranchNavigate?.(item.forkPointId, 'prev')}
          onNext={() => ctx.onBranchNavigate?.(item.forkPointId, 'next')}
        />
      );
    default: {
      const _exhaustive: never = item;
      return _exhaustive;
    }
  }
}
