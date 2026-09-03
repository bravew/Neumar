/**
 * Frozen Zod contracts for the inbound Neumar MCP tool catalog.
 * Tool handlers and Hono facade routes must share these schemas.
 */

import { z } from 'zod';

export const DEFAULT_PAGE_LIMIT = 50;
export const MAX_PAGE_LIMIT = 100;
export const DEFAULT_SEARCH_LIMIT = 20;
export const DEFAULT_MESSAGE_LIMIT = 20;
export const MAX_MESSAGE_LIMIT = 50;
export const MAX_PAYLOAD_BYTES = 256 * 1024;
export const DEFAULT_RESULT_LIMIT = 50;
export const MAX_COMMENT_CHARS = 8 * 1024;
export const MAX_QUERY_CHARS = 200;

export const EXTERNAL_MCP_SETTING_KEYS = {
  enabled: 'externalMcpEnabled',
  writesEnabled: 'externalMcpWritesEnabled',
  agentRunsEnabled: 'externalMcpAgentRunsEnabled',
  resultLimit: 'externalMcpResultLimit',
} as const;

export const PROJECT_STATUS_VALUES = [
  'active',
  'in_progress',
  'completed',
  'archived',
] as const;

export const TASK_STATUS_VALUES = [
  'running',
  'completed',
  'error',
  'stopped',
] as const;

export const TASK_PRIORITY_VALUES = [
  'urgent',
  'high',
  'medium',
  'low',
] as const;

const limitSchema = (fallback: number, max: number) =>
  z.number().int().min(1).max(max).optional().default(fallback);

export const requestIdSchema = z.string().uuid();
export const cursorSchema = z.string().min(1).max(512).optional();

export const pageMetaSchema = z
  .object({
    nextCursor: z.string().nullable(),
    truncated: z.boolean(),
    byteLength: z.number().int().nonnegative(),
  })
  .strict();

export const healthInputSchema = z.object({}).strict();

export const healthOutputSchema = z
  .object({
    version: z.string(),
    ready: z.boolean(),
    daemonUrl: z.string().nullable(),
    flags: z
      .object({
        enabled: z.boolean(),
        writesEnabled: z.boolean(),
        agentRunsEnabled: z.boolean(),
        resultLimit: z.number().int(),
      })
      .strict(),
  })
  .strict();

export const listProjectsInputSchema = z
  .object({
    status: z.enum(PROJECT_STATUS_VALUES).optional(),
    cursor: cursorSchema,
    limit: limitSchema(DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT),
  })
  .strict();

export const projectSummarySchema = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    color: z.string().nullable(),
    status: z.enum(PROJECT_STATUS_VALUES),
    createdAt: z.string(),
    updatedAt: z.string(),
    taskCounts: z.record(z.string(), z.number().int()).optional(),
  })
  .strict();

export const listProjectsOutputSchema = z
  .object({
    items: z.array(projectSummarySchema),
    nextCursor: z.string().nullable(),
    truncated: z.boolean(),
    byteLength: z.number().int().nonnegative(),
  })
  .strict();

export const getProjectInputSchema = z
  .object({
    projectId: z.string().min(1).max(100),
  })
  .strict();

export const getProjectOutputSchema = projectSummarySchema;

export const listTasksInputSchema = z
  .object({
    projectId: z.string().min(1).optional(),
    status: z.enum(TASK_STATUS_VALUES).optional(),
    cursor: cursorSchema,
    limit: limitSchema(DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT),
  })
  .strict();

export const taskSummarySchema = z
  .object({
    id: z.string(),
    sessionId: z.string(),
    projectId: z.string().nullable(),
    title: z.string().nullable(),
    prompt: z.string(),
    status: z.enum(TASK_STATUS_VALUES),
    priority: z.enum(TASK_PRIORITY_VALUES).nullable(),
    labels: z.array(z.string()),
    blockedReason: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();

export const listTasksOutputSchema = z
  .object({
    items: z.array(taskSummarySchema),
    nextCursor: z.string().nullable(),
    truncated: z.boolean(),
    byteLength: z.number().int().nonnegative(),
  })
  .strict();

export const searchTasksInputSchema = z
  .object({
    query: z.string().min(1).max(MAX_QUERY_CHARS),
    projectId: z.string().min(1).optional(),
    limit: limitSchema(DEFAULT_SEARCH_LIMIT, MAX_PAGE_LIMIT),
  })
  .strict();

export const searchTasksOutputSchema = z
  .object({
    items: z.array(taskSummarySchema),
    truncated: z.boolean(),
    byteLength: z.number().int().nonnegative(),
  })
  .strict();

export const getTaskInputSchema = z
  .object({
    taskId: z.string().min(1),
    includeMessages: z.boolean().optional().default(false),
    includeFiles: z.boolean().optional().default(false),
    messageCursor: cursorSchema,
    messageLimit: limitSchema(DEFAULT_MESSAGE_LIMIT, MAX_MESSAGE_LIMIT),
  })
  .strict();

export const messageSummarySchema = z
  .object({
    id: z.string(),
    type: z.string(),
    content: z.string().nullable(),
    createdAt: z.string().optional(),
  })
  .strict();

export const fileMetadataSchema = z
  .object({
    id: z.number().int(),
    name: z.string(),
    type: z.string(),
    createdAt: z.string(),
  })
  .strict();

export const getTaskOutputSchema = z
  .object({
    task: taskSummarySchema,
    messages: z.array(messageSummarySchema).optional(),
    files: z.array(fileMetadataSchema).optional(),
    nextCursor: z.string().nullable().optional(),
    truncated: z.boolean(),
    byteLength: z.number().int().nonnegative(),
  })
  .strict();

export const getRunTreeInputSchema = z
  .object({
    taskId: z.string().min(1),
  })
  .strict();

export const runTreeNodeSchema = z
  .object({
    id: z.string(),
    taskId: z.string(),
    parentRunId: z.string().nullable(),
    status: z.string(),
    startedAt: z.string(),
    finishedAt: z.string().nullable(),
    costUsd: z.number(),
    attempt: z.number().int(),
    children: z.array(z.unknown()),
  })
  .strict();

export const getRunTreeOutputSchema = z
  .object({
    roots: z.array(runTreeNodeSchema),
    truncated: z.boolean(),
    byteLength: z.number().int().nonnegative(),
  })
  .strict();

export const colorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/)
  .optional();

export const createProjectInputSchema = z
  .object({
    requestId: requestIdSchema,
    name: z.string().min(1).max(100),
    description: z.string().max(500).optional(),
    color: colorSchema,
  })
  .strict();

export const createProjectOutputSchema = projectSummarySchema;

export const createTaskInputSchema = z
  .object({
    requestId: requestIdSchema,
    prompt: z.string().min(1),
    projectId: z.string().min(1).optional(),
    title: z.string().max(200).optional(),
    priority: z.enum(TASK_PRIORITY_VALUES).optional(),
  })
  .strict();

export const createTaskOutputSchema = z
  .object({
    projectId: z.string().nullable(),
    sessionId: z.string(),
    taskId: z.string(),
    task: taskSummarySchema,
  })
  .strict();

export const updateTaskInputSchema = z
  .object({
    taskId: z.string().min(1),
    title: z.string().max(200).optional(),
    priority: z.enum(TASK_PRIORITY_VALUES).optional(),
    labels: z.array(z.string().min(1).max(40)).max(20).optional(),
    blockedReason: z.string().max(500).optional(),
    projectId: z.string().min(1).nullable().optional(),
  })
  .strict();

export const updateTaskOutputSchema = taskSummarySchema;

export const addTaskCommentInputSchema = z
  .object({
    requestId: requestIdSchema,
    taskId: z.string().min(1),
    content: z.string().min(1).max(MAX_COMMENT_CHARS),
  })
  .strict();

export const addTaskCommentOutputSchema = z
  .object({
    id: z.string(),
    taskId: z.string(),
    authorType: z.literal('agent'),
    authorId: z.literal('external-mcp'),
    content: z.string(),
    createdAt: z.string(),
  })
  .strict();

export const startAgentRunInputSchema = z
  .object({
    requestId: requestIdSchema,
    taskId: z.string().min(1),
    profileId: z.string().min(1).optional(),
  })
  .strict();

export const startAgentRunOutputSchema = z
  .object({
    runId: z.string(),
    taskId: z.string(),
    status: z.string(),
  })
  .strict();

export const getAgentRunInputSchema = z
  .object({
    runId: z.string().min(1),
  })
  .strict();

export const getAgentRunOutputSchema = z
  .object({
    runId: z.string(),
    taskId: z.string(),
    status: z.string(),
    awaitingInput: z.boolean(),
    costUsd: z.number().nullable(),
    error: z.string().nullable(),
  })
  .strict();

export const cancelAgentRunInputSchema = z
  .object({
    runId: z.string().min(1),
  })
  .strict();

export const cancelAgentRunOutputSchema = z
  .object({
    runId: z.string(),
    status: z.string(),
  })
  .strict();
