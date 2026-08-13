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
        return null;
      })}
    </>
  );
}
