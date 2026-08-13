/**
 * Frontend Database Layer (API Client)
 *
 * Unified database interface that uses the backend API for all storage operations.
 * This provides a consistent experience across both browser and desktop modes.
 */

import { API_BASE_URL } from '@/config';

import type {
  CreateFileInput,
  CreateMessageInput,
  CreateSessionInput,
  CreateTaskInput,
  LibraryFile,
  MediaVersionRecord,
  Message,
  Session,
  Task,
  UpdateTaskInput,
} from './types';

const DB_API_BASE = `${API_BASE_URL}/db`;

// ============ Helper Functions ============

const API_TIMEOUT_MS = 30_000;

/** Thrown when the API returns 404. Callers can catch this to return null. */
class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

async function apiCall<T>(
  endpoint: string,
  options?: RequestInit,
  baseUrl: string = DB_API_BASE,
): Promise<T> {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
    signal: options?.signal ?? AbortSignal.timeout(API_TIMEOUT_MS),
  });

  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ error: response.statusText }));
    const message = error.error || 'API request failed';

    // Distinguish 404 from other errors so callers can handle "not found" silently
    if (response.status === 404) {
      throw new NotFoundError(message);
    }
    throw new Error(message);
  }

  return response.json();
}

// ============ Session Operations ============

export async function createSession(
  input: CreateSessionInput,
): Promise<Session> {
  return apiCall<Session>('/sessions', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function getSession(id: string): Promise<Session | null> {
  try {
    return await apiCall<Session>(`/sessions/${id}`);
  } catch (error) {
    if (!(error instanceof NotFoundError)) {
      console.error(`[DB] Failed to get session ${id}:`, error);
    }
    return null;
  }
}

export async function getAllSessions(): Promise<Session[]> {
  return apiCall<Session[]>('/sessions');
}

export async function updateSessionTaskCount(
  sessionId: string,
  taskCount: number,
): Promise<void> {
  await apiCall(`/sessions/${sessionId}/task-count`, {
    method: 'PATCH',
    body: JSON.stringify({ taskCount }),
  });
}

export async function getTasksBySessionId(sessionId: string): Promise<Task[]> {
  return apiCall<Task[]>(`/sessions/${sessionId}/tasks`);
}

// ============ Task Operations ============

export async function createTask(input: CreateTaskInput): Promise<Task> {
  return apiCall<Task>('/tasks', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function getTask(id: string): Promise<Task | null> {
  try {
    return await apiCall<Task>(`/tasks/${id}`);
  } catch (error) {
    if (!(error instanceof NotFoundError)) {
      console.error(`[DB] Failed to get task ${id}:`, error);
    }
    return null;
  }
}

export async function getAllTasks(options?: {
  signal?: AbortSignal;
}): Promise<Task[]> {
  return apiCall<Task[]>('/tasks', { signal: options?.signal });
}

export async function searchTasks(
  query: string,
  options?: { limit?: number; signal?: AbortSignal },
): Promise<Task[]> {
  const params = new URLSearchParams({ q: query });
  if (options?.limit) params.set('limit', String(options.limit));
  return apiCall<Task[]>(`/tasks/search?${params}`, {
    signal: options?.signal,
  });
}

export async function updateTask(
  id: string,
  input: UpdateTaskInput,
): Promise<Task | null> {
  try {
    return await apiCall<Task>(`/tasks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  } catch (error) {
    if (!(error instanceof NotFoundError)) {
      console.error(`[DB] Failed to update task ${id}:`, error);
    }
    return null;
  }
}

export async function deleteTask(id: string): Promise<boolean> {
  try {
    await apiCall(`/tasks/${id}`, { method: 'DELETE' });
    return true;
  } catch (error) {
    if (!(error instanceof NotFoundError)) {
      console.error(`[DB] Failed to delete task ${id}:`, error);
    }
    return false;
  }
}

/**
 * Batch delete multiple tasks at once.
 * Returns the number of tasks successfully deleted.
 */
export async function batchDeleteTasks(ids: string[]): Promise<number> {
  try {
    const result = await apiCall<{ deleted: number }>('/tasks/batch-delete', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    });
    return result.deleted;
  } catch (error) {
    console.error('[DB] Failed to batch delete tasks:', error);
    return 0;
  }
}

// ============ Message Operations ============

export async function createMessage(
  input: CreateMessageInput,
): Promise<Message> {
  return apiCall<Message>('/messages', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function getMessagesByTaskId(taskId: string): Promise<Message[]> {
  return apiCall<Message[]>(`/tasks/${taskId}/messages`);
}

export async function deleteMessagesByTaskId(taskId: string): Promise<number> {
  const result = await apiCall<{ deleted: number }>(
    `/tasks/${taskId}/messages`,
    { method: 'DELETE' },
  );
  return result.deleted;
}

export async function deleteMessagesAfter(
  taskId: string,
  afterMessageId: number,
): Promise<number> {
  const result = await apiCall<{ deleted: number }>(
    `/tasks/${taskId}/messages/after/${afterMessageId}`,
    { method: 'DELETE' },
  );
  return result.deleted;
}

export async function updateMessageContent(
  messageId: string,
  content: string,
): Promise<boolean> {
  try {
    await apiCall(`/messages/${messageId}/content`, {
      method: 'PATCH',
      body: JSON.stringify({ content }),
    });
    return true;
  } catch {
    return false;
  }
}

// ============ Branch Operations ============

const BRANCHES_API_BASE = `${API_BASE_URL}/tasks`;

export async function createEditBranch(
  taskId: string,
  fromMessageId: number | string,
  newContent: string,
): Promise<{ branchId: string; newMessageId: number; messageUuid: string }> {
  return apiCall(
    `/${taskId}/branches/edit`,
    { method: 'POST', body: JSON.stringify({ fromMessageId, newContent }) },
    BRANCHES_API_BASE,
  );
}

export async function getBranchesAtForkPoint(
  taskId: string,
  messageId: number,
): Promise<string[]> {
  const result = await apiCall<{ branches: string[] }>(
    `/${taskId}/branches/at/${messageId}`,
    undefined,
    BRANCHES_API_BASE,
  );
  return result.branches;
}

export async function getBranches(taskId: string): Promise<string[]> {
  const result = await apiCall<{ branches: string[] }>(
    `/${taskId}/branches`,
    undefined,
    BRANCHES_API_BASE,
  );
  return result.branches;
}

export async function createBranch(
  taskId: string,
  fromMessageId: number | string,
): Promise<string> {
  const result = await apiCall<{ branchId: string }>(
    `/${taskId}/branches`,
    { method: 'POST', body: JSON.stringify({ fromMessageId }) },
    BRANCHES_API_BASE,
  );
  return result.branchId;
}

export async function regenerateResponse(
  taskId: string,
  afterMessageId: number | string,
  branchId: string,
): Promise<{ deleted: number; branchId: string }> {
  return apiCall(
    `/${taskId}/branches/regenerate`,
    { method: 'POST', body: JSON.stringify({ afterMessageId, branchId }) },
    BRANCHES_API_BASE,
  );
}

export async function searchMessages(
  taskId: string,
  query: string,
): Promise<Message[]> {
  const result = await apiCall<{ messages: Message[] }>(
    `/${taskId}/messages/search?q=${encodeURIComponent(query)}`,
    undefined,
    BRANCHES_API_BASE,
  );
  return result.messages;
}

// Check if the backend database API is reachable
export async function isDatabaseAvailable(): Promise<boolean> {
  try {
    const response = await fetch(`${DB_API_BASE}/settings`, {
      method: 'GET',
      signal: AbortSignal.timeout(3000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

// ============ Library File Operations ============

export async function createFile(input: CreateFileInput): Promise<LibraryFile> {
  return apiCall<LibraryFile>('/files', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function getFilesByTaskId(taskId: string): Promise<LibraryFile[]> {
  return apiCall<LibraryFile[]>(`/tasks/${taskId}/files`);
}

export async function getAllFiles(): Promise<LibraryFile[]> {
  return apiCall<LibraryFile[]>('/files');
}

export async function toggleFileFavorite(
  fileId: number,
): Promise<LibraryFile | null> {
  try {
    return await apiCall<LibraryFile>(`/files/${fileId}/favorite`, {
      method: 'PATCH',
    });
  } catch (error) {
    if (!(error instanceof NotFoundError)) {
      console.error(`[DB] Failed to toggle file favorite ${fileId}:`, error);
    }
    return null;
  }
}

export async function deleteFile(fileId: number): Promise<boolean> {
  try {
    await apiCall(`/files/${fileId}`, { method: 'DELETE' });
    return true;
  } catch (error) {
    if (!(error instanceof NotFoundError)) {
      console.error(`[DB] Failed to delete file ${fileId}:`, error);
    }
    return false;
  }
}

// Get files grouped by task with task info
export async function getFilesGroupedByTask(): Promise<
  { task: Task; files: LibraryFile[] }[]
> {
  return apiCall<{ task: Task; files: LibraryFile[] }[]>('/files/grouped');
}

// ============ Media Version Operations ============

export async function saveMediaVersion(
  version: MediaVersionRecord,
): Promise<void> {
  await apiCall('/media-versions', {
    method: 'POST',
    body: JSON.stringify(version),
  });
}

export async function getMediaVersionsByTaskId(
  taskId: string,
): Promise<MediaVersionRecord[]> {
  return apiCall<MediaVersionRecord[]>(`/tasks/${taskId}/media-versions`);
}

export async function deleteMediaVersionsByTaskId(
  taskId: string,
): Promise<number> {
  const result = await apiCall<{ deleted: number }>(
    `/tasks/${taskId}/media-versions`,
    { method: 'DELETE' },
  );
  return result.deleted;
}
