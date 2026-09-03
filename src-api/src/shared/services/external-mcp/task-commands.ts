import { randomUUID } from 'node:crypto';

import type { z } from 'zod';

import { getDatabase } from '@/shared/db';
import {
  type AgentRunRow,
  createProject,
  createSession,
  createTask,
  createTaskComment,
  getAgentRunsByTaskId,
  getAllProjects,
  getAllTasks,
  getFilesByTaskId,
  getMessagesByTaskId,
  getProject,
  getProjectWithTaskSummary,
  getTask,
  searchTasks,
  updateTask,
} from '@/shared/db/operations';
import type { Message, Project, Task } from '@/shared/db/types';
import { ExternalMcpError } from '@/shared/mcp/public-server/errors';
import {
  MAX_MESSAGE_LIMIT,
  MAX_PAYLOAD_BYTES,
  addTaskCommentOutputSchema,
  createTaskOutputSchema,
  fileMetadataSchema,
  getRunTreeOutputSchema,
  getTaskOutputSchema,
  listProjectsOutputSchema,
  listTasksOutputSchema,
  messageSummarySchema,
  projectSummarySchema,
  searchTasksOutputSchema,
  taskSummarySchema,
} from '@/shared/mcp/public-server/schemas';

import { withIdempotency } from './idempotency';
import { byteLengthOf, capObject, paginateItems } from './pagination';
import { getExternalMcpFlags, isUuid, requireUuid } from './policy';

type ProjectSummary = z.infer<typeof projectSummarySchema>;
type TaskSummary = z.infer<typeof taskSummarySchema>;
type MessageSummary = z.infer<typeof messageSummarySchema>;
type GetTaskOutput = z.infer<typeof getTaskOutputSchema>;
type CreateTaskOutput = z.infer<typeof createTaskOutputSchema>;
type AddCommentOutput = z.infer<typeof addTaskCommentOutputSchema>;

function parseLabels(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

export function toProjectSummary(
  project: Project & { task_counts?: Record<string, number> },
): ProjectSummary {
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    color: project.color,
    status: project.status,
    createdAt: project.created_at,
    updatedAt: project.updated_at,
    ...(project.task_counts ? { taskCounts: project.task_counts } : {}),
  };
}

export function toTaskSummary(task: Task): TaskSummary {
  return {
    id: task.id,
    sessionId: task.session_id,
    projectId: task.project_id ?? null,
    title: task.title ?? null,
    prompt: task.prompt,
    status: task.status,
    priority: task.priority ?? null,
    labels: parseLabels(task.labels),
    blockedReason: task.blocked_reason ?? null,
    createdAt: task.created_at,
    updatedAt: task.updated_at,
  };
}

function effectiveLimit(requested: number): number {
  return Math.min(requested, getExternalMcpFlags().resultLimit);
}

export function listProjectsCommand(input: {
  status?: Project['status'];
  cursor?: string;
  limit: number;
}) {
  const items = getAllProjects(input.status).map((project) =>
    toProjectSummary(project),
  );
  return listProjectsOutputSchema.parse(
    paginateItems(items, {
      cursor: input.cursor,
      limit: effectiveLimit(input.limit),
      getKey: (item) => ({ updatedAt: item.updatedAt, id: item.id }),
    }),
  );
}

export function getProjectCommand(projectId: string): ProjectSummary {
  if (isUuid(projectId)) {
    const project = getProjectWithTaskSummary(projectId);
    if (!project) {
      throw new ExternalMcpError('NOT_FOUND', 'Project not found');
    }
    return projectSummarySchema.parse(toProjectSummary(project));
  }

  const needle = projectId.toLowerCase();
  const matches = getAllProjects().filter(
    (project) => project.name.toLowerCase() === needle,
  );
  if (matches.length === 0) {
    throw new ExternalMcpError('NOT_FOUND', 'Project not found');
  }
  if (matches.length > 1) {
    throw new ExternalMcpError(
      'AMBIGUOUS_RESULT',
      'Multiple projects share that name; use the UUID',
    );
  }
  const match = matches[0];
  if (!match) {
    throw new ExternalMcpError('NOT_FOUND', 'Project not found');
  }
  const summary = getProjectWithTaskSummary(match.id);
  if (!summary) {
    throw new ExternalMcpError('NOT_FOUND', 'Project not found');
  }
  return projectSummarySchema.parse(toProjectSummary(summary));
}

export function listTasksCommand(input: {
  projectId?: string;
  status?: Task['status'];
  cursor?: string;
  limit: number;
}) {
  if (input.projectId) requireUuid(input.projectId, 'projectId');
  let tasks = getAllTasks(
    input.projectId ? { projectId: input.projectId } : undefined,
  );
  if (input.status) {
    tasks = tasks.filter((task) => task.status === input.status);
  }
  return listTasksOutputSchema.parse(
    paginateItems(tasks.map(toTaskSummary), {
      cursor: input.cursor,
      limit: effectiveLimit(input.limit),
      getKey: (item) => ({ updatedAt: item.updatedAt, id: item.id }),
    }),
  );
}

export function searchTasksCommand(input: {
  query: string;
  projectId?: string;
  limit: number;
}) {
  if (input.projectId) requireUuid(input.projectId, 'projectId');
  const limit = effectiveLimit(input.limit);
  const tasks = searchTasks(input.query, limit + 1, {
    projectId: input.projectId,
  });
  const truncated = tasks.length > limit;
  const items = tasks.slice(0, limit).map(toTaskSummary);
  const result = { items, truncated, byteLength: 0 };
  result.byteLength = byteLengthOf(result);
  if (result.byteLength > MAX_PAYLOAD_BYTES) {
    throw new ExternalMcpError(
      'PAYLOAD_TOO_LARGE',
      'Search result exceeds the payload cap',
    );
  }
  return searchTasksOutputSchema.parse(result);
}

function toMessageSummary(message: Message): MessageSummary {
  return messageSummarySchema.parse({
    id: String(message.id),
    type: message.type,
    content: message.content,
    createdAt: message.created_at,
  });
}

export function getTaskCommand(input: {
  taskId: string;
  includeMessages: boolean;
  includeFiles: boolean;
  messageCursor?: string;
  messageLimit: number;
}): GetTaskOutput {
  const task = getTask(input.taskId);
  if (!task) throw new ExternalMcpError('NOT_FOUND', 'Task not found');

  const output: GetTaskOutput = {
    task: toTaskSummary(task),
    truncated: false,
    byteLength: 0,
  };

  if (input.includeMessages) {
    const messages = getMessagesByTaskId(input.taskId).map(toMessageSummary);
    const page = paginateItems(messages, {
      cursor: input.messageCursor,
      limit: Math.min(input.messageLimit, MAX_MESSAGE_LIMIT),
      getKey: (item) => ({
        updatedAt: item.createdAt ?? '',
        id: item.id,
      }),
    });
    output.messages = page.items;
    output.nextCursor = page.nextCursor;
    output.truncated = page.truncated;
  }

  if (input.includeFiles) {
    output.files = getFilesByTaskId(input.taskId).map((file) =>
      fileMetadataSchema.parse({
        id: file.id,
        name: file.name,
        type: file.type,
        createdAt: file.created_at,
      }),
    );
  }

  const capped = capObject(output);
  output.truncated = output.truncated || capped.truncated;
  output.byteLength = capped.byteLength;
  return getTaskOutputSchema.parse(output);
}

interface SlimRunNode {
  id: string;
  taskId: string;
  parentRunId: string | null;
  sourceRunId: string | null;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  costUsd: number;
  attempt: number;
  children: SlimRunNode[];
}

function slimRunTree(rows: AgentRunRow[]): SlimRunNode[] {
  const byId = new Map<string, SlimRunNode>();
  for (const row of rows) {
    byId.set(row.id, {
      id: row.id,
      taskId: row.task_id,
      parentRunId: row.parent_run_id,
      sourceRunId: row.source_run_id,
      status: row.status,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      costUsd: row.cost_usd,
      attempt: row.attempt,
      children: [],
    });
  }
  const roots: SlimRunNode[] = [];
  for (const node of byId.values()) {
    const lineageParentId = node.parentRunId ?? node.sourceRunId;
    const parent =
      lineageParentId && lineageParentId !== node.id
        ? byId.get(lineageParentId)
        : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

function publicRunTree(
  nodes: SlimRunNode[],
): Array<Omit<SlimRunNode, 'sourceRunId'>> {
  return nodes.map(({ sourceRunId: _sourceRunId, children, ...node }) => ({
    ...node,
    children: publicRunTree(children),
  }));
}

export function getRunTreeCommand(taskId: string) {
  const task = getTask(taskId);
  if (!task) throw new ExternalMcpError('NOT_FOUND', 'Task not found');
  const result = {
    roots: publicRunTree(slimRunTree(getAgentRunsByTaskId(taskId))),
    truncated: false,
    byteLength: 0,
  };
  const capped = capObject(result);
  result.truncated = capped.truncated;
  result.byteLength = capped.byteLength;
  return getRunTreeOutputSchema.parse(result);
}

export function createProjectCommand(input: {
  requestId: string;
  name: string;
  description?: string;
  color?: string;
}): ProjectSummary {
  return withIdempotency('create_project', input.requestId, input, () => {
    const created = createProject({
      id: randomUUID(),
      name: input.name,
      description: input.description,
      color: input.color,
    });
    return projectSummarySchema.parse(toProjectSummary(created));
  });
}

export function createTaskCommand(input: {
  requestId: string;
  prompt: string;
  projectId?: string;
  title?: string;
  priority?: Task['priority'];
}): CreateTaskOutput {
  if (input.projectId) {
    requireUuid(input.projectId, 'projectId');
    if (!getProject(input.projectId)) {
      throw new ExternalMcpError('NOT_FOUND', 'Project not found');
    }
  }
  return withIdempotency('create_task', input.requestId, input, () => {
    const sessionId = randomUUID();
    const taskId = randomUUID();
    const created = getDatabase().transaction(() => {
      createSession({ id: sessionId, prompt: input.prompt });
      createTask({
        id: taskId,
        session_id: sessionId,
        task_index: 0,
        prompt: input.prompt,
        project_id: input.projectId ?? null,
      });
      if (input.title !== undefined || input.priority !== undefined) {
        updateTask(taskId, {
          title: input.title,
          priority: input.priority,
        });
      }
      const task = getTask(taskId);
      if (!task) {
        throw new ExternalMcpError('NOT_FOUND', 'Task was not created');
      }
      return task;
    })();
    return createTaskOutputSchema.parse({
      projectId: created.project_id ?? null,
      sessionId: created.session_id,
      taskId: created.id,
      task: toTaskSummary(created),
    });
  });
}

export function updateTaskCommand(input: {
  taskId: string;
  title?: string;
  priority?: Task['priority'];
  labels?: string[];
  blockedReason?: string;
  projectId?: string | null;
}): TaskSummary {
  requireUuid(input.taskId, 'taskId');
  const existing = getTask(input.taskId);
  if (!existing) throw new ExternalMcpError('NOT_FOUND', 'Task not found');
  if (input.projectId) {
    requireUuid(input.projectId, 'projectId');
    if (!getProject(input.projectId)) {
      throw new ExternalMcpError('NOT_FOUND', 'Project not found');
    }
  }
  const updated = updateTask(input.taskId, {
    title: input.title,
    priority: input.priority,
    labels: input.labels ? JSON.stringify(input.labels) : undefined,
    blocked_reason: input.blockedReason,
    project_id: input.projectId,
  });
  if (!updated) throw new ExternalMcpError('NOT_FOUND', 'Task not found');
  return taskSummarySchema.parse(toTaskSummary(updated));
}

export function addTaskCommentCommand(input: {
  requestId: string;
  taskId: string;
  content: string;
}): AddCommentOutput {
  requireUuid(input.taskId, 'taskId');
  if (!getTask(input.taskId)) {
    throw new ExternalMcpError('NOT_FOUND', 'Task not found');
  }
  return withIdempotency('add_task_comment', input.requestId, input, () => {
    const created = createTaskComment({
      id: randomUUID(),
      task_id: input.taskId,
      author_type: 'agent',
      author_id: 'external-mcp',
      content: input.content,
    });
    return addTaskCommentOutputSchema.parse({
      id: created.id,
      taskId: created.task_id,
      authorType: 'agent' as const,
      authorId: 'external-mcp' as const,
      content: created.content,
      createdAt: created.created_at,
    });
  });
}
