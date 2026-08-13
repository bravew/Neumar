import type { MessageAttachment } from '@/shared/hooks/agent-types';

export type ChatPanelRole = 'user' | 'assistant' | 'system' | 'reasoning';

export type NonEmptyArray<T> = [T, ...T[]];

export interface ChatPanelMessageExtras {
  task?: unknown;
  video?: unknown;
  design?: unknown;
}

export interface ChatQuestionOption {
  label: string;
  description?: string;
}

export interface ChatQuestion {
  question: string;
  header: string;
  options: ChatQuestionOption[];
  multiSelect: boolean;
}

export interface ChatQuestionRequest {
  id: string;
  toolCallId: string;
  questions: NonEmptyArray<ChatQuestion>;
  answered?: boolean;
  answerText?: string;
  sourceMessageId?: string;
}

export type ChatToolCallStage =
  | 'pending'
  | 'streaming'
  | 'executing'
  | 'complete'
  | 'error'
  | 'cancelled';

export interface ChatToolCall {
  id: string;
  name: string;
  stage: ChatToolCallStage;
  argsText: string;
  args: Record<string, unknown>;
  result?: string;
  isError?: boolean;
  sourceMessageId?: string;
  cancellable?: boolean;
  cancellationReason?: string;
}

export interface ChatPanelAction {
  id: string;
  name: string;
  summary?: string;
  args?: Record<string, unknown>;
  status?: string;
  requiresApproval?: boolean;
  payload?: unknown;
}

export type ChatSurfaceKind =
  | 'form'
  | 'choice'
  | 'confirmation'
  | 'oauth-prompt';
export type ChatSurfacePersistTier = 'run' | 'conversation' | 'project';
export type ChatSurfaceStatus = 'pending' | 'resolved' | 'timeout';
export type ChatSurfaceRespondedBy = 'user' | 'agent' | 'auto' | 'cache';

export interface ChatSurfaceRequest {
  id: string;
  kind: ChatSurfaceKind;
  status: ChatSurfaceStatus;
  payload: unknown;
  persist?: ChatSurfacePersistTier;
  value?: unknown;
  respondedBy?: ChatSurfaceRespondedBy;
}

export type ChatRunLifecycleStatus =
  | 'started'
  | 'pipeline_stage_started'
  | 'pipeline_stage_completed'
  | 'completed'
  | 'cancelled'
  | 'failed';

export interface ChatRunLifecycle {
  status: ChatRunLifecycleStatus;
  stageId?: string;
  iteration?: number;
  message?: string;
}

export interface ChatStateUpdate {
  path: string;
  value: unknown;
}

interface ChatPanelMessageBase<
  Kind extends string,
  Extras extends ChatPanelMessageExtras = ChatPanelMessageExtras,
> {
  id: string;
  kind: Kind;
  role: ChatPanelRole;
  createdAt: string;
  extras?: Extras;
}

export interface ChatPanelTextMessage<
  Extras extends ChatPanelMessageExtras = ChatPanelMessageExtras,
> extends ChatPanelMessageBase<'text', Extras> {
  content: string;
  attachments?: MessageAttachment[];
  isError?: boolean;
  subtype?: string;
}

export interface ChatPanelToolMessage<
  Extras extends ChatPanelMessageExtras = ChatPanelMessageExtras,
> extends ChatPanelMessageBase<'tool', Extras> {
  role: 'assistant';
  calls: NonEmptyArray<ChatToolCall>;
}

export interface ChatPanelQuestionMessage<
  Extras extends ChatPanelMessageExtras = ChatPanelMessageExtras,
> extends ChatPanelMessageBase<'question', Extras> {
  role: 'assistant';
  question: ChatQuestionRequest;
}

export interface ChatPanelActionMessage<
  Extras extends ChatPanelMessageExtras = ChatPanelMessageExtras,
> extends ChatPanelMessageBase<'action', Extras> {
  role: 'assistant';
  action: ChatPanelAction;
}

export interface ChatPanelSurfaceMessage<
  Extras extends ChatPanelMessageExtras = ChatPanelMessageExtras,
> extends ChatPanelMessageBase<'surface', Extras> {
  role: 'assistant';
  surface: ChatSurfaceRequest;
}

export interface ChatPanelLifecycleMessage<
  Extras extends ChatPanelMessageExtras = ChatPanelMessageExtras,
> extends ChatPanelMessageBase<'lifecycle', Extras> {
  role: 'system';
  lifecycle: ChatRunLifecycle;
}

export interface ChatPanelStateMessage<
  Extras extends ChatPanelMessageExtras = ChatPanelMessageExtras,
> extends ChatPanelMessageBase<'state', Extras> {
  role: 'system';
  state: ChatStateUpdate;
}

export type ChatPanelMessage<
  Extras extends ChatPanelMessageExtras = ChatPanelMessageExtras,
> =
  | ChatPanelTextMessage<Extras>
  | ChatPanelToolMessage<Extras>
  | ChatPanelQuestionMessage<Extras>
  | ChatPanelActionMessage<Extras>
  | ChatPanelSurfaceMessage<Extras>
  | ChatPanelLifecycleMessage<Extras>
  | ChatPanelStateMessage<Extras>;

export function asNonEmptyArray<T>(items: T[]): NonEmptyArray<T> | null {
  return items.length > 0 ? (items as NonEmptyArray<T>) : null;
}
