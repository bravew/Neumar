/**
 * @deprecated This component is superseded by TaskV2Thread which uses
 * react-virtuoso for virtualized rendering. Kept for backward compatibility
 * with legacy V1 task views. Do not use in new code.
 */
import React from 'react';

import type { Artifact } from '@/components/artifacts/types';
import { BranchNavigator } from '@/components/task/BranchNavigator';
import { ErrorMessage } from '@/components/task/ErrorMessage';
import {
  groupMessages,
  type GroupedItem,
} from '@/components/task/groupMessages';
import { LocalOutputArtifactPreviews } from '@/components/task/LocalOutputArtifactPreviews';
import { MessageToolbar } from '@/components/task/MessageToolbar';
import { PlanApproval } from '@/components/task/PlanApproval';
import { ActivityGroup } from '@/components/task/TaskV2ActivityGroup';
import type { AGUIMessage } from '@/components/task/TaskV2MessageBubble';
import {
  MessageBubble,
  ToolCallGroup,
} from '@/components/task/TaskV2MessageBubble';
import { UserMessageBubble } from '@/components/task/UserMessageBubble';
import { getSettings } from '@/shared/db/settings';
import type { TaskPlan } from '@/shared/hooks/agent-types';
import type { MessageAttachment } from '@/shared/hooks/useAgent';

export {
  groupMessages,
  type GroupedItem,
} from '@/components/task/groupMessages';

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
  /** Thread-level run state — gates the live header on activity groups. */
  isRunning?: boolean;
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
    case 'activity':
      return (
        <ActivityGroup
          key={item.key}
          entries={item.entries}
          allMessages={ctx.messages}
          isRunning={ctx.isRunning}
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
