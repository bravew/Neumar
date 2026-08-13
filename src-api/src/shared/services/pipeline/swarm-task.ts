/**
 * Swarm Mode Task Management
 *
 * Task metadata for multi-agent collaboration.
 * Stores per-task state in app data directory tasks/ for cross-agent sharing.
 */

import { existsSync } from 'fs';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';

import { APP_DIR_NAME } from '@/config/constants';

import { createLogger } from '@/shared/utils/logger';

import type { LinearIssue } from '../linear';

const logger = createLogger('SwarmTask');

const TASKS_DIR = join(homedir(), APP_DIR_NAME, 'tasks');

// ============================================================================
// Types
// ============================================================================

export interface SwarmTask {
  id: string;
  issueId: string;
  issueIdentifier: string;
  worktreePath: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  createdAt: string;
  updatedAt: string;
  dependencies?: string[];
  parentTaskId?: string;
  childTaskIds?: string[];
  role?: string;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Create task metadata for Swarm Mode integration.
 * Returns the generated task ID.
 */
export async function createSwarmTask(
  issue: LinearIssue,
  worktreePath: string,
): Promise<string> {
  const taskId = `task-${issue.identifier}-${crypto.randomUUID()}`;

  if (!existsSync(TASKS_DIR)) {
    await mkdir(TASKS_DIR, { recursive: true });
  }

  const taskFile = join(TASKS_DIR, `${taskId}.json`);

  const taskData: SwarmTask = {
    id: taskId,
    issueId: issue.id,
    issueIdentifier: issue.identifier,
    worktreePath,
    status: 'in_progress',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await writeFile(taskFile, JSON.stringify(taskData, null, 2));

  // Set environment variable for child agents
  process.env.CLAUDE_CODE_TASK_LIST_ID = taskId;

  logger.info(`Created Swarm Mode task: ${taskId}`);
  return taskId;
}

/**
 * Update task status and metadata.
 */
export async function updateSwarmTask(
  taskId: string,
  updates: Partial<SwarmTask>,
): Promise<void> {
  const taskFile = join(TASKS_DIR, `${taskId}.json`);

  if (!existsSync(taskFile)) {
    logger.warn(`Task file not found: ${taskId}`);
    return;
  }

  const content = await readFile(taskFile, 'utf-8');
  const task = JSON.parse(content) as SwarmTask;

  const updated: SwarmTask = {
    ...task,
    ...updates,
    updatedAt: new Date().toISOString(),
  };

  await writeFile(taskFile, JSON.stringify(updated, null, 2));
}

/**
 * Get task metadata by ID.
 */
export async function getSwarmTask(taskId: string): Promise<SwarmTask | null> {
  const taskFile = join(TASKS_DIR, `${taskId}.json`);

  if (!existsSync(taskFile)) {
    return null;
  }

  const content = await readFile(taskFile, 'utf-8');
  return JSON.parse(content) as SwarmTask;
}

/**
 * Link a parent task to a child task (updates both sides).
 */
export async function linkTasks(
  parentId: string,
  childId: string,
): Promise<void> {
  const [parent, child] = await Promise.all([
    getSwarmTask(parentId),
    getSwarmTask(childId),
  ]);

  const updates: Promise<void>[] = [];
  if (parent) {
    const childIds = parent.childTaskIds ?? [];
    if (!childIds.includes(childId)) {
      childIds.push(childId);
      updates.push(updateSwarmTask(parentId, { childTaskIds: childIds }));
    }
  }
  if (child) {
    updates.push(updateSwarmTask(childId, { parentTaskId: parentId }));
  }
  await Promise.all(updates);
}

/**
 * Get all child tasks for a parent.
 */
export async function getTaskChildren(taskId: string): Promise<SwarmTask[]> {
  const parent = await getSwarmTask(taskId);
  if (!parent?.childTaskIds?.length) return [];

  const results = await Promise.all(
    parent.childTaskIds.map((id) => getSwarmTask(id)),
  );
  return results.filter((c): c is SwarmTask => c !== null);
}

/**
 * Check if all children of a task are in a terminal state.
 */
export async function areChildrenComplete(taskId: string): Promise<boolean> {
  const children = await getTaskChildren(taskId);
  if (children.length === 0) return true;
  return children.every(
    (c) => c.status === 'completed' || c.status === 'failed',
  );
}
