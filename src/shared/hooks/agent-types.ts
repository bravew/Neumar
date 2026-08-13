import type { Task } from '@/shared/db';
import type { BackgroundTask } from '@/shared/lib/background-tasks';

export interface PermissionRequest {
  id: string;
  tool: string;
  command?: string;
  description: string;
  risk_level?: 'low' | 'medium' | 'high';
}

// Question types for AskUserQuestion tool
export interface QuestionOption {
  label: string;
  description: string;
}

export type QuestionGate =
  | 'approval'
  | 'cost'
  | 'rights'
  | 'upload'
  | 'destructive_edit';

export type QuestionPolicy =
  | { behavior: 'manual'; gate?: QuestionGate }
  | { behavior: 'optional'; defaultOptionLabel: string };

export interface AgentQuestion {
  question: string;
  header: string;
  options: QuestionOption[];
  multiSelect: boolean;
  policy: QuestionPolicy;
}

export interface PendingQuestion {
  id: string;
  toolUseId: string;
  questions: AgentQuestion[];
}

export interface CloudStorageAttachmentSourceContext {
  kind: 'cloud-storage';
  connectionId: string;
  connectionProvider: string;
  connectionLabel?: string;
  providerItemId: string;
  providerItemName?: string;
  providerItemPath?: string;
}

export interface AssetCatalogAttachmentSourceContext {
  kind: 'asset-catalog';
  assetId: string;
  assetTitle?: string;
  assetSource?: string;
  sourceId?: string;
  storagePath?: string;
}

export type AttachmentSourceContext =
  | CloudStorageAttachmentSourceContext
  | AssetCatalogAttachmentSourceContext;

// Attachment type for messages with images/files
export interface MessageAttachment {
  id: string;
  type: 'image' | 'file';
  name: string;
  data: string; // Base64 data for images, empty string for path-based files
  mimeType?: string;
  path?: string; // File path when loaded from disk
  file?: File; // Original File object (for saving without base64 in Tauri desktop)
  isLoading?: boolean; // True when attachment is being loaded
  sourceContext?: AttachmentSourceContext;
}

export interface AgentMessage {
  type:
    | 'text'
    | 'tool_use'
    | 'tool_result'
    | 'result'
    | 'error'
    | 'session'
    | 'done'
    | 'user'
    | 'permission_request'
    | 'plan'
    | 'direct_answer'
    | 'thinking'
    | 'planning_status';
  content?: string;
  name?: string;
  id?: string; // tool_use id
  input?: unknown;
  subtype?: string;
  cost?: number;
  duration?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  model?: string;
  message?: string;
  /** Live backend session id used for stopping the current run. */
  sessionId?: string;
  /** Durable provider session/thread handle used for later resume. */
  resumeSessionId?: string;
  // Permission request fields
  permission?: PermissionRequest;
  // Tool result fields
  toolUseId?: string;
  output?: string;
  isError?: boolean;
  // Planning progress fields
  elapsedMs?: number;
  /** Truncated snippet of the model's reasoning (from thinking_delta events) */
  thinkingText?: string;
  // Plan fields
  plan?: TaskPlan;
  // Attachments for user messages (images, files)
  attachments?: MessageAttachment[];
  // Trace fields — for timeline/waterfall visualization
  /** ISO timestamp when this message was emitted */
  startedAt?: string;
  /** Links tool_result back to the originating tool_use message ID */
  parentId?: string;
}

export interface PlanStep {
  id: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
}

export interface TaskPlan {
  id: string;
  goal: string;
  steps: PlanStep[];
  notes?: string;
  createdAt?: Date;
}

export interface ContinueConversationOptions {
  /** Optional subtype tag for the user message (e.g. 'question_answer') */
  subtype?: string;
  /** Re-run the last persisted user turn without adding another user message. */
  retry?: boolean;
  /** Resume the provider/agent runtime session instead of rebuilding context. */
  resumeSessionId?: string;
}

// Conversation message format for API
export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  imagePaths?: string[]; // Image file paths for context
}

export type AgentPhase =
  | 'idle'
  | 'planning'
  | 'awaiting_approval'
  | 'executing';

export interface SessionInfo {
  sessionId: string;
  taskIndex: number;
}

/** Optional model override — takes precedence over the settings-derived config. */
export interface ModelOverride {
  providerId?: string;
  dialect?: 'standard' | 'kimi-k3';
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  agentType?: string;
}

export interface UseAgentReturn {
  messages: AgentMessage[];
  isRunning: boolean;
  taskId: string | null;
  sessionId: string | null;
  agentSessionId: string | null;
  taskIndex: number;
  sessionFolder: string | null;
  taskFolder: string | null; // Full path to current task folder (sessionFolder/task-XX)
  filesVersion: number; // Incremented when files are added (e.g., attachments saved)
  pendingPermission: PermissionRequest | null;
  pendingQuestion: PendingQuestion | null;
  // Two-phase planning
  phase: AgentPhase;
  plan: TaskPlan | null;
  setPlan: (plan: TaskPlan | null) => void;
  isPlanRestored: boolean; // true when plan was loaded from a previous session (not freshly generated)
  runAgent: (
    prompt: string,
    existingTaskId?: string,
    sessionInfo?: SessionInfo,
    attachments?: MessageAttachment[],
    workDir?: string,
    modelOverride?: ModelOverride,
    mentionedMcpServers?: string[],
    pinnedSkills?: string[],
  ) => Promise<string>;
  approvePlan: () => Promise<void>;
  rejectPlan: () => void;
  continueConversation: (
    reply: string,
    attachments?: MessageAttachment[],
    modelOverride?: ModelOverride,
    mentionedMcpServers?: string[],
    pinnedSkills?: string[],
    options?: ContinueConversationOptions,
  ) => Promise<void>;
  stopAgent: () => Promise<void>;
  clearMessages: () => void;
  loadTask: (taskId: string) => Promise<Task | null>;
  loadMessages: (taskId: string) => Promise<void>;
  respondToPermission: (
    permissionId: string,
    approved: boolean,
  ) => Promise<void>;
  respondToQuestion: (
    questionId: string,
    answers: Record<string, string>,
  ) => Promise<void>;
  setSessionInfo: (sessionId: string, taskIndex: number) => void;
  // Background tasks
  backgroundTasks: BackgroundTask[];
  runningBackgroundTaskCount: number;
}

/** Callbacks and refs needed by the task observer. */
export interface TaskObserverContext {
  activeTaskIdRef: { current: string | null };
  isRunningRef: { current: boolean };
  setIsRunning: (v: boolean) => void;
  setPhase: (v: AgentPhase) => void;
  setMessages: (
    updater: AgentMessage[] | ((prev: AgentMessage[]) => AgentMessage[]),
  ) => void;
  setPlan: (v: TaskPlan | null) => void;
}
