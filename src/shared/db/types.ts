// Database types for sessions, tasks and messages

export type TaskStatus = 'running' | 'completed' | 'error' | 'stopped';

// Session represents a conversation context that can contain multiple tasks
export interface Session {
  id: string; // Format: YYYYMMDDHHmmss_slug
  prompt: string; // Original prompt that started the session
  task_count: number; // Number of tasks in this session
  created_at: string;
  updated_at: string;
}

export interface Task {
  id: string;
  session_id: string; // Reference to session
  task_index: number; // Index within session (1, 2, 3...)
  prompt: string; // Original user message — NEVER modified after creation
  title?: string | null; // Auto-generated display title (separate from prompt)
  work_dir?: string | null; // Per-task workspace directory
  additional_work_dirs?: string | null; // JSON array of extra workspace dirs
  agent_session_id?: string | null; // Provider/agent runtime session used for resume
  status: TaskStatus;
  cost: number | null;
  duration: number | null;
  favorite?: boolean; // Whether task is favorited
  assignee_profile_id?: string | null; // Agent profile assigned to this task
  created_at: string;
  updated_at: string;
}

export type MessageType =
  | 'text'
  | 'tool_use'
  | 'tool_result'
  | 'result'
  | 'error'
  | 'user'
  | 'plan';

export interface Message {
  id: number;
  task_id: string;
  type: MessageType;
  content: string | null;
  tool_name: string | null;
  tool_input: string | null;
  tool_output: string | null;
  tool_use_id: string | null;
  subtype: string | null;
  error_message: string | null;
  attachments: string | null; // JSON string of MessageAttachment[]
  message_id: string | null;
  cost: number | null;
  usage_input: number | null;
  usage_output: number | null;
  usage_cache_read: number | null;
  usage_cache_creation: number | null;
  model: string | null;
  branch_id?: string;
  parent_message_id?: number | null;
  created_at: string;
}

// Input types for creating records
export interface CreateSessionInput {
  id: string;
  prompt: string;
}

export interface CreateTaskInput {
  id: string;
  session_id: string;
  task_index: number;
  prompt: string;
  work_dir?: string;
  additional_work_dirs?: string;
  agent_session_id?: string | null;
  assignee_profile_id?: string;
}

export interface CreateMessageInput {
  task_id: string;
  type: MessageType;
  content?: string;
  tool_name?: string;
  tool_input?: string;
  tool_output?: string;
  tool_use_id?: string;
  subtype?: string;
  error_message?: string;
  attachments?: string; // JSON string of MessageAttachment[]
  message_id?: string | null;
  cost?: number | null;
  usage_input?: number | null;
  usage_output?: number | null;
  usage_cache_read?: number | null;
  usage_cache_creation?: number | null;
  model?: string | null;
}

export interface UpdateTaskInput {
  status?: TaskStatus;
  cost?: number;
  duration?: number;
  prompt?: string;
  title?: string | null;
  work_dir?: string | null;
  agent_session_id?: string | null;
  favorite?: boolean;
  project_id?: string | null;
}

/**
 * Parse the JSON-encoded additional_work_dirs column into a string array.
 * Returns an empty array on null, undefined, or malformed JSON.
 */
export function parseAdditionalWorkDirs(
  raw: string | null | undefined,
): string[] {
  if (!raw) return [];
  try {
    const dirs = JSON.parse(raw);
    return Array.isArray(dirs) ? dirs : [];
  } catch {
    return [];
  }
}

// Library file types
export type FileType =
  | 'image'
  | 'text'
  | 'code'
  | 'document'
  | 'website'
  | 'presentation'
  | 'spreadsheet'
  | 'audio'
  | 'video';

// Media version record (database representation)
export interface MediaVersionRecord {
  id: string;
  task_id: string;
  artifact_id: string;
  version_number: number;
  path: string;
  prompt: string;
  previous_version_id: string | null;
  type: string;
  created_at: string;
}

export interface LibraryFile {
  id: number;
  task_id: string;
  name: string;
  type: FileType;
  path: string;
  preview: string | null;
  thumbnail: string | null;
  is_favorite: boolean;
  created_at: string;
}

export interface CreateFileInput {
  task_id: string;
  name: string;
  type: FileType;
  path: string;
  preview?: string;
  thumbnail?: string;
}
