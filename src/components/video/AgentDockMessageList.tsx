import { MessageBubble } from '@/components/shared/chat-panel';
import { useLanguage } from '@/shared/providers/language-provider';
import type { VideoMediaItem, VideoProject } from '@/shared/types/video';

import { AgentActionCard } from './AgentActionCard';
import { agentActionTitle } from './agentDockViewUtils';
import { AgentToolCallGroup } from './AgentToolCallGroup';
import {
  type AgentActionRecord,
  type AgentDockMessage,
  type ToolCallRecord,
} from './useAgentDock';
import { VideoAgentMessageContent } from './VideoAgentMessageContent';

interface AgentDockMessageListProps {
  messages: AgentDockMessage[];
  project: VideoProject;
  streaming: boolean;
  onPreview: (asset: VideoMediaItem) => void;
  onSend: (text: string) => void;
  onAcceptAction: (action: AgentActionRecord) => void;
  onRejectAction: (action: AgentActionRecord) => void;
  onRefineAction: (action: AgentActionRecord) => void;
  onCancelAction: (action: AgentActionRecord) => void;
}

type RenderItem =
  | { kind: 'message'; message: AgentDockMessage; isLastAssistantText: boolean }
  | { kind: 'toolGroup'; id: string; calls: ToolCallRecord[] };

/**
 * Coalesces consecutive `kind: 'tool'` messages into a single collapsible
 * group (mirroring how TaskV2 chat handles tool-use), while leaving text
 * bubbles and action cards in their original order.
 */
function buildRenderItems(messages: AgentDockMessage[]): RenderItem[] {
  const items: RenderItem[] = [];
  const lastAssistantTextIndex = (() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const m = messages[i];
      if (m.kind === 'text' && m.role === 'assistant') return i;
    }
    return -1;
  })();

  let pending: ToolCallRecord[] = [];
  let pendingStartId: string | null = null;
  const flush = () => {
    if (pending.length > 0 && pendingStartId) {
      items.push({
        kind: 'toolGroup',
        id: `toolgroup:${pendingStartId}`,
        calls: pending,
      });
    }
    pending = [];
    pendingStartId = null;
  };

  messages.forEach((message, index) => {
    if (message.kind === 'tool') {
      if (pending.length === 0) pendingStartId = message.id;
      pending.push(message.call);
      return;
    }
    flush();
    items.push({
      kind: 'message',
      message,
      isLastAssistantText: index === lastAssistantTextIndex,
    });
  });
  flush();
  return items;
}

export function AgentDockMessageList({
  messages,
  project,
  streaming,
  onPreview,
  onSend,
  onAcceptAction,
  onRejectAction,
  onRefineAction,
  onCancelAction,
}: AgentDockMessageListProps) {
  const { t } = useLanguage();
  const items = buildRenderItems(messages);
  // Every text the user has sent. An action chip whose `send://` payload matches
  // one of these renders as already-clicked — derived from the persisted user
  // messages so the "used" state survives a reload.
  const usedActionTexts = new Set<string>();
  for (const m of messages) {
    if (m.kind === 'text' && m.role === 'user') {
      usedActionTexts.add(m.content.trim());
    }
  }
  return (
    <>
      {items.map((item) => {
        if (item.kind === 'toolGroup') {
          return <AgentToolCallGroup key={item.id} calls={item.calls} />;
        }
        const { message, isLastAssistantText } = item;
        if (message.kind === 'text') {
          return (
            <MessageBubble
              key={message.id}
              role={message.role}
              className={
                message.role === 'assistant' ? 'max-w-full' : undefined
              }
            >
              {message.role === 'user' ? (
                <div className="whitespace-pre-wrap">{message.content}</div>
              ) : (
                <VideoAgentMessageContent
                  content={message.content}
                  project={project}
                  streaming={streaming}
                  surfaceQuickReplies={isLastAssistantText && !streaming}
                  usedActionTexts={usedActionTexts}
                  onPreview={onPreview}
                  onSend={onSend}
                />
              )}
            </MessageBubble>
          );
        }
        if (message.kind === 'action') {
          const action = message.action;
          return (
            <AgentActionCard
              key={message.id}
              action={action}
              title={agentActionTitle(
                action.name,
                t.video.editor.agentDock.actions,
              )}
              labels={t.video.editor.agentDock}
              onAccept={() => onAcceptAction(action)}
              onReject={() => onRejectAction(action)}
              onRefine={() => onRefineAction(action)}
              onRetry={() => onAcceptAction(action)}
              onCancel={() => onCancelAction(action)}
            />
          );
        }
        if (message.kind === 'activity') {
          const dock = t.video.editor.agentDock;
          const { content } = message.activity;
          const phase =
            typeof content.phase === 'string' ? content.phase : undefined;
          const phaseLabel =
            phase === 'awaiting_approval'
              ? dock.awaitingApproval
              : phase === 'running' || phase === 'planning'
                ? dock.running
                : phase === 'failed'
                  ? dock.failed
                  : phase === 'cancelled'
                    ? dock.cancelled
                    : dock.completed;
          const goal =
            typeof content.goal === 'string'
              ? content.goal
              : typeof content.message === 'string'
                ? content.message
                : '';
          const steps = Array.isArray(content.steps) ? content.steps : [];
          return (
            <MessageBubble
              key={message.id}
              role="assistant"
              className="max-w-full"
            >
              <div className="border-border/60 bg-muted/20 rounded-lg border p-3 text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-foreground min-w-0 truncate font-medium">
                    {goal}
                  </span>
                  <span className="text-muted-foreground ml-auto shrink-0 text-xs">
                    {phaseLabel}
                  </span>
                </div>
                {steps.length > 0 ? (
                  <ol className="text-muted-foreground mt-2 space-y-1 text-xs">
                    {steps.map((step, index) => (
                      <li
                        key={
                          step &&
                          typeof step === 'object' &&
                          typeof (step as { id?: unknown }).id === 'string'
                            ? (step as { id: string }).id
                            : index
                        }
                      >
                        {step &&
                        typeof step === 'object' &&
                        typeof (step as { description?: unknown })
                          .description === 'string'
                          ? (step as { description: string }).description
                          : ''}
                      </li>
                    ))}
                  </ol>
                ) : null}
              </div>
            </MessageBubble>
          );
        }
        if (message.kind === 'subagent') {
          const dock = t.video.editor.agentDock;
          const { name, id, status } = message.subagent;
          const statusLabel =
            status === 'running'
              ? dock.running
              : status === 'suspended'
                ? dock.suspended
                : status === 'error'
                  ? dock.failed
                  : dock.completed;
          return (
            <MessageBubble
              key={message.id}
              role="system"
              className="max-w-full"
            >
              <div className="flex items-center gap-2 text-xs">
                <span className="text-foreground min-w-0 truncate font-medium">
                  {name || id.slice(0, 8)}
                </span>
                <span className="text-muted-foreground ml-auto shrink-0">
                  {statusLabel}
                </span>
              </div>
            </MessageBubble>
          );
        }
        return null;
      })}
    </>
  );
}
