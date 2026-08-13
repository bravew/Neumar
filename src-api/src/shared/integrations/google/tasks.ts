/**
 * Google Tasks Integration
 *
 * Provides Tasks API v1 operations using the user's OAuth tokens.
 * Requires the tasks scope, requested incrementally.
 */

import { GOOGLE_TASKS_SCOPES } from '@/config/oauth';

import { getConnectionBroker } from '@/shared/auth/connection-broker';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('TasksIntegration');

const TASKS_API_BASE = 'https://tasks.googleapis.com/tasks/v1';

/** Required scopes for Tasks operations */
export const REQUIRED_SCOPES = GOOGLE_TASKS_SCOPES;

// ============================================================================
// Types
// ============================================================================

export interface TaskList {
  id: string;
  title: string;
  updated: string;
  selfLink: string;
}

export interface Task {
  id: string;
  title: string;
  notes?: string;
  status: 'needsAction' | 'completed';
  due?: string;
  completed?: string;
  parent?: string;
  position: string;
  updated: string;
  selfLink: string;
  links?: Array<{ type: string; description: string; link: string }>;
}

// ============================================================================
// Helpers
// ============================================================================

async function tasksFetch(
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const client = await getConnectionBroker().getServiceClient('google');
  const res = await client(`${TASKS_API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    logger.error(`Tasks API error (${path}): ${res.status} ${body}`);
    throw new Error(`Tasks API error: ${res.status} — ${body}`);
  }

  return res;
}

// ============================================================================
// Public API — Task Lists
// ============================================================================

/** List all task lists for the authenticated user */
export async function listTaskLists(maxResults = 100): Promise<TaskList[]> {
  const res = await tasksFetch(`/users/@me/lists?maxResults=${maxResults}`);
  const data = await res.json();
  return (data.items as TaskList[]) ?? [];
}

/** Get a specific task list */
export async function getTaskList(taskListId: string): Promise<TaskList> {
  const res = await tasksFetch(`/users/@me/lists/${taskListId}`);
  return res.json() as Promise<TaskList>;
}

// ============================================================================
// Public API — Tasks
// ============================================================================

/** List tasks in a task list */
export async function listTasks(
  taskListId: string,
  options?: {
    maxResults?: number;
    showCompleted?: boolean;
    showHidden?: boolean;
    dueMin?: string;
    dueMax?: string;
    pageToken?: string;
  },
): Promise<{ tasks: Task[]; nextPageToken?: string }> {
  const params = new URLSearchParams();
  if (options?.maxResults) params.set('maxResults', String(options.maxResults));
  if (options?.showCompleted !== undefined)
    params.set('showCompleted', String(options.showCompleted));
  if (options?.showHidden !== undefined)
    params.set('showHidden', String(options.showHidden));
  if (options?.dueMin) params.set('dueMin', options.dueMin);
  if (options?.dueMax) params.set('dueMax', options.dueMax);
  if (options?.pageToken) params.set('pageToken', options.pageToken);

  const qs = params.toString();
  const res = await tasksFetch(
    `/lists/${taskListId}/tasks${qs ? `?${qs}` : ''}`,
  );
  const data = await res.json();
  return {
    tasks: (data.items as Task[]) ?? [],
    nextPageToken: data.nextPageToken,
  };
}

/** Get a single task */
export async function getTask(
  taskListId: string,
  taskId: string,
): Promise<Task> {
  const res = await tasksFetch(`/lists/${taskListId}/tasks/${taskId}`);
  return res.json() as Promise<Task>;
}

/** Create a new task */
export async function createTask(
  taskListId: string,
  task: { title: string; notes?: string; due?: string; status?: string },
): Promise<Task> {
  const res = await tasksFetch(`/lists/${taskListId}/tasks`, {
    method: 'POST',
    body: JSON.stringify(task),
  });
  const created = (await res.json()) as Task;
  logger.info(`Created task "${created.title}" in list ${taskListId}`);
  return created;
}

/** Update a task */
export async function updateTask(
  taskListId: string,
  taskId: string,
  updates: Partial<Pick<Task, 'title' | 'notes' | 'due' | 'status'>>,
): Promise<Task> {
  const res = await tasksFetch(`/lists/${taskListId}/tasks/${taskId}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
  return res.json() as Promise<Task>;
}

/** Mark a task as completed */
export async function completeTask(
  taskListId: string,
  taskId: string,
): Promise<Task> {
  return updateTask(taskListId, taskId, {
    status: 'completed',
  });
}

/** Delete a task */
export async function deleteTask(
  taskListId: string,
  taskId: string,
): Promise<void> {
  await tasksFetch(`/lists/${taskListId}/tasks/${taskId}`, {
    method: 'DELETE',
  });
  logger.info(`Deleted task ${taskId} from list ${taskListId}`);
}

/** Move a task (change parent or position) */
export async function moveTask(
  taskListId: string,
  taskId: string,
  parentId?: string,
  previousId?: string,
): Promise<Task> {
  const params = new URLSearchParams();
  if (parentId) params.set('parent', parentId);
  if (previousId) params.set('previous', previousId);

  const qs = params.toString();
  const res = await tasksFetch(
    `/lists/${taskListId}/tasks/${taskId}/move${qs ? `?${qs}` : ''}`,
    { method: 'POST' },
  );
  return res.json() as Promise<Task>;
}
