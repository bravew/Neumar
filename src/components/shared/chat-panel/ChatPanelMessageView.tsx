import type { ReactNode } from 'react';

import {
  CheckCircle2,
  FileJson2,
  ShieldQuestion,
  Workflow,
} from 'lucide-react';

import { cn } from '@/shared/lib/utils';
import { parseGenUIEnvelope } from '@/shared/types/gen-ui';

import { GenUIRenderer } from './GenUIRenderer';
import { MessageBubble } from './MessageBubble';
import { QuestionFormCard } from './QuestionFormCard';
import {
  ToolActivityGroup,
  type ToolActivityGroupLabels,
} from './ToolActivityGroup';
import type {
  ChatPanelActionMessage,
  ChatPanelLifecycleMessage,
  ChatPanelMessage,
  ChatPanelQuestionMessage,
  ChatPanelStateMessage,
  ChatPanelTextMessage,
  ChatPanelToolMessage,
  ChatRunLifecycleStatus,
  ChatSurfaceKind,
  ChatSurfacePersistTier,
  ChatSurfaceRequest,
  ChatSurfaceRespondedBy,
  ChatSurfaceStatus,
} from './types';

export interface ChatPanelMessageViewLabels {
  toolGroup: ToolActivityGroupLabels;
  surface: {
    kind: Record<ChatSurfaceKind, string>;
    status: Record<ChatSurfaceStatus, string>;
    persist: Record<ChatSurfacePersistTier, string>;
    respondedBy: Record<ChatSurfaceRespondedBy, string>;
    payload: string;
    response: string;
  };
  lifecycle: Record<ChatRunLifecycleStatus, string>;
  state: {
    updated: string;
    value: string;
  };
}

export interface ChatPanelMessageViewProps {
  message: ChatPanelMessage;
  labels: ChatPanelMessageViewLabels;
  onQuestionSubmit?: (
    message: ChatPanelQuestionMessage,
    answers: Record<string, string>,
  ) => void;
  renderAction?: (message: ChatPanelActionMessage) => ReactNode;
  renderTextContent?: (message: ChatPanelTextMessage) => ReactNode;
}

export function ChatPanelMessageView({
  message,
  labels,
  onQuestionSubmit,
  renderAction,
  renderTextContent,
}: ChatPanelMessageViewProps) {
  switch (message.kind) {
    case 'text':
      return (
        <MessageBubble
          role={message.role}
          className={message.role === 'assistant' ? 'max-w-full' : undefined}
        >
          {renderTextContent ? (
            renderTextContent(message)
          ) : (
            <DefaultTextContent message={message} />
          )}
        </MessageBubble>
      );
    case 'tool':
      return <ToolMessage message={message} labels={labels.toolGroup} />;
    case 'question':
      return (
        <MessageBubble role="assistant" className="max-w-full">
          <QuestionFormCard
            questions={message.question.questions}
            answered={message.question.answered}
            answerText={message.question.answerText}
            onSubmit={(answers) => onQuestionSubmit?.(message, answers)}
          />
        </MessageBubble>
      );
    case 'action':
      return renderAction ? <>{renderAction(message)}</> : null;
    case 'surface':
      return (
        <MessageBubble role="assistant" className="max-w-full">
          <SurfaceRequestCard
            surface={message.surface}
            labels={labels.surface}
          />
        </MessageBubble>
      );
    case 'lifecycle':
      return (
        <MessageBubble role="system" className="max-w-full">
          <LifecycleEvent message={message} labels={labels.lifecycle} />
        </MessageBubble>
      );
    case 'state':
      return (
        <MessageBubble role="system" className="max-w-full">
          <StateUpdateEvent message={message} labels={labels.state} />
        </MessageBubble>
      );
    default:
      return null;
  }
}

function DefaultTextContent({ message }: { message: ChatPanelTextMessage }) {
  const genUI =
    message.role === 'assistant' ? parseGenUIEnvelope(message.content) : null;
  if (genUI) return <GenUIRenderer envelope={genUI} />;
  return <div className="whitespace-pre-wrap">{message.content}</div>;
}

function ToolMessage({
  message,
  labels,
}: {
  message: ChatPanelToolMessage;
  labels: ToolActivityGroupLabels;
}) {
  return (
    <MessageBubble role="assistant" className="max-w-full">
      <ToolActivityGroup calls={message.calls} labels={labels} />
    </MessageBubble>
  );
}

function SurfaceRequestCard({
  surface,
  labels,
}: {
  surface: ChatSurfaceRequest;
  labels: ChatPanelMessageViewLabels['surface'];
}) {
  const title = getPayloadTitle(surface.payload) ?? labels.kind[surface.kind];
  const payloadPreview =
    surface.status === 'pending' ? formatJsonPreview(surface.payload) : null;
  const responsePreview = formatJsonPreview(surface.value);
  return (
    <section className="border-border/60 bg-background my-2 space-y-2 rounded-lg border p-3">
      <div className="flex min-w-0 items-start gap-3">
        <SurfaceIcon status={surface.status} />
        <div className="min-w-0 flex-1">
          <div className="text-foreground truncate text-sm font-medium">
            {title}
          </div>
          <div className="text-muted-foreground mt-1 flex flex-wrap gap-1.5 text-[11px]">
            <span className="bg-muted rounded px-1.5 py-0.5">
              {labels.status[surface.status]}
            </span>
            {surface.persist ? (
              <span className="bg-muted rounded px-1.5 py-0.5">
                {labels.persist[surface.persist]}
              </span>
            ) : null}
            {surface.respondedBy ? (
              <span className="bg-muted rounded px-1.5 py-0.5">
                {labels.respondedBy[surface.respondedBy]}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {payloadPreview ? (
        <JsonPreview label={labels.payload} value={payloadPreview} />
      ) : null}
      {responsePreview ? (
        <JsonPreview label={labels.response} value={responsePreview} />
      ) : null}
    </section>
  );
}

function SurfaceIcon({ status }: { status: ChatSurfaceStatus }) {
  const Icon = status === 'resolved' ? CheckCircle2 : ShieldQuestion;
  return (
    <Icon
      className={cn(
        'mt-0.5 size-4 shrink-0',
        status === 'resolved' && 'text-emerald-500',
        status === 'pending' && 'text-primary',
        status === 'timeout' && 'text-amber-500',
      )}
    />
  );
}

function LifecycleEvent({
  message,
  labels,
}: {
  message: ChatPanelLifecycleMessage;
  labels: ChatPanelMessageViewLabels['lifecycle'];
}) {
  const { iteration, message: detail, stageId, status } = message.lifecycle;
  return (
    <div className="flex min-w-0 items-start gap-2 text-xs">
      <Workflow className="mt-0.5 size-3.5 shrink-0" />
      <div className="min-w-0">
        <div className="text-foreground font-medium">{labels[status]}</div>
        {(stageId || iteration !== undefined || detail) && (
          <div className="text-muted-foreground mt-0.5 break-words">
            {[stageId, iteration !== undefined ? `#${iteration}` : null, detail]
              .filter(Boolean)
              .join(' / ')}
          </div>
        )}
      </div>
    </div>
  );
}

function StateUpdateEvent({
  message,
  labels,
}: {
  message: ChatPanelStateMessage;
  labels: ChatPanelMessageViewLabels['state'];
}) {
  const value = formatJsonPreview(message.state.value);
  return (
    <div className="space-y-1 text-xs">
      <div className="flex min-w-0 items-center gap-2">
        <FileJson2 className="size-3.5 shrink-0" />
        <span className="text-foreground font-medium">{labels.updated}</span>
        {message.state.path ? (
          <span className="text-muted-foreground min-w-0 truncate font-mono">
            {message.state.path}
          </span>
        ) : null}
      </div>
      {value ? <JsonPreview label={labels.value} value={value} /> : null}
    </div>
  );
}

function JsonPreview({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-muted/30 rounded-md p-2">
      <div className="text-muted-foreground mb-1 text-[10px] font-medium">
        {label}
      </div>
      <pre className="text-foreground/80 max-h-28 overflow-auto text-[10px] whitespace-pre-wrap">
        {value}
      </pre>
    </div>
  );
}

function getPayloadTitle(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }
  const title = (payload as { title?: unknown }).title;
  return typeof title === 'string' && title.trim() ? title : null;
}

function formatJsonPreview(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
