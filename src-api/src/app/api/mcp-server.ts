import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { z } from 'zod';

import {
  ExternalMcpError,
  createErrorEnvelope,
  httpStatusForError,
} from '@/shared/mcp/public-server/errors';
import {
  addTaskCommentInputSchema,
  createProjectInputSchema,
  createTaskInputSchema,
  getProjectInputSchema,
  getRunTreeInputSchema,
  getTaskInputSchema,
  listProjectsInputSchema,
  listTasksInputSchema,
  searchTasksInputSchema,
  updateTaskInputSchema,
} from '@/shared/mcp/public-server/schemas';
import { recordExternalMcpAudit } from '@/shared/services/external-mcp/audit';
import { mcpCommandAuth } from '@/shared/services/external-mcp/auth';
import { readDaemonRecord } from '@/shared/services/external-mcp/daemon-record';
import {
  assertAgentRunsEnabled,
  assertFeatureEnabled,
  assertWritesEnabled,
  getExternalMcpFlags,
  rejectCredentialShapedInput,
} from '@/shared/services/external-mcp/policy';
import {
  addTaskCommentCommand,
  createProjectCommand,
  createTaskCommand,
  getProjectCommand,
  getRunTreeCommand,
  getTaskCommand,
  listProjectsCommand,
  listTasksCommand,
  searchTasksCommand,
  updateTaskCommand,
} from '@/shared/services/external-mcp/task-commands';

const API_VERSION = process.env.npm_package_version ?? '26.8.27';

export const mcpServerRoutes = new Hono();

function errorResponse(err: unknown) {
  if (err instanceof ExternalMcpError) {
    return {
      body: err.toEnvelope(),
      status: httpStatusForError(err.code) as ContentfulStatusCode,
    };
  }
  const message =
    err instanceof SyntaxError ? 'Invalid JSON' : 'Command failed';
  return {
    body: createErrorEnvelope('VALIDATION_FAILED', message),
    status: 400 as ContentfulStatusCode,
  };
}

function parseJsonSchema<T>(schema: z.ZodType<T>, value: unknown): T {
  rejectCredentialShapedInput(value);
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ExternalMcpError(
      'VALIDATION_FAILED',
      parsed.error.issues[0]?.message ?? 'Invalid request',
    );
  }
  return parsed.data;
}

function coerceQuery(query: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...query };
  for (const key of ['limit', 'messageLimit']) {
    if (query[key] !== undefined) {
      const n = Number(query[key]);
      if (!Number.isInteger(n)) {
        throw new ExternalMcpError(
          'VALIDATION_FAILED',
          `${key} must be an integer`,
        );
      }
      out[key] = n;
    }
  }
  for (const key of ['includeMessages', 'includeFiles']) {
    if (query[key] !== undefined) {
      out[key] = query[key] === 'true' || query[key] === '1';
    }
  }
  return out;
}

mcpServerRoutes.onError((err, c) => {
  const { body, status } = errorResponse(err);
  recordExternalMcpAudit({
    action: 'block',
    route: c.req.path,
    method: c.req.method,
    code: body.code,
  });
  return c.json(body, status);
});

mcpServerRoutes.get('/status', (c) => {
  const flags = getExternalMcpFlags();
  return c.json({
    version: API_VERSION,
    ready: true,
    daemonUrl: readDaemonRecord()?.url ?? null,
    flags,
  });
});

const command = new Hono();
command.use('*', mcpCommandAuth);

command.get('/projects', (c) => {
  assertFeatureEnabled();
  const input = parseJsonSchema(
    listProjectsInputSchema,
    coerceQuery(c.req.query()),
  );
  recordExternalMcpAudit({
    action: 'allow',
    route: '/projects',
    method: 'GET',
  });
  return c.json(listProjectsCommand(input));
});

command.get('/projects/:id', (c) => {
  assertFeatureEnabled();
  const input = parseJsonSchema(getProjectInputSchema, {
    projectId: c.req.param('id'),
  });
  recordExternalMcpAudit({
    action: 'allow',
    route: '/projects/:id',
    method: 'GET',
  });
  return c.json(getProjectCommand(input.projectId));
});

command.post('/projects', async (c) => {
  assertWritesEnabled();
  const input = parseJsonSchema(createProjectInputSchema, await c.req.json());
  const result = createProjectCommand(input);
  recordExternalMcpAudit({
    action: 'allow',
    route: '/projects',
    method: 'POST',
  });
  return c.json(result, 201 as ContentfulStatusCode);
});

command.get('/tasks/search', (c) => {
  assertFeatureEnabled();
  const input = parseJsonSchema(
    searchTasksInputSchema,
    coerceQuery(c.req.query()),
  );
  recordExternalMcpAudit({
    action: 'allow',
    route: '/tasks/search',
    method: 'GET',
  });
  return c.json(searchTasksCommand(input));
});

command.get('/tasks', (c) => {
  assertFeatureEnabled();
  const input = parseJsonSchema(
    listTasksInputSchema,
    coerceQuery(c.req.query()),
  );
  recordExternalMcpAudit({
    action: 'allow',
    route: '/tasks',
    method: 'GET',
  });
  return c.json(listTasksCommand(input));
});

command.get('/tasks/:id', (c) => {
  assertFeatureEnabled();
  const input = parseJsonSchema(getTaskInputSchema, {
    taskId: c.req.param('id'),
    ...coerceQuery(c.req.query()),
  });
  recordExternalMcpAudit({
    action: 'allow',
    route: '/tasks/:id',
    method: 'GET',
    taskId: input.taskId,
  });
  return c.json(getTaskCommand(input));
});

command.get('/tasks/:id/run-tree', (c) => {
  assertFeatureEnabled();
  const input = parseJsonSchema(getRunTreeInputSchema, {
    taskId: c.req.param('id'),
  });
  recordExternalMcpAudit({
    action: 'allow',
    route: '/tasks/:id/run-tree',
    method: 'GET',
    taskId: input.taskId,
  });
  return c.json(getRunTreeCommand(input.taskId));
});

command.post('/tasks', async (c) => {
  assertWritesEnabled();
  const input = parseJsonSchema(createTaskInputSchema, await c.req.json());
  const result = createTaskCommand(input);
  recordExternalMcpAudit({
    action: 'allow',
    route: '/tasks',
    method: 'POST',
    taskId: result.taskId,
  });
  return c.json(result, 201 as ContentfulStatusCode);
});

command.patch('/tasks/:id', async (c) => {
  assertWritesEnabled();
  const input = parseJsonSchema(updateTaskInputSchema, {
    ...(await c.req.json()),
    taskId: c.req.param('id'),
  });
  const result = updateTaskCommand(input);
  recordExternalMcpAudit({
    action: 'allow',
    route: '/tasks/:id',
    method: 'PATCH',
    taskId: input.taskId,
  });
  return c.json(result);
});

command.post('/tasks/:id/comments', async (c) => {
  assertWritesEnabled();
  const input = parseJsonSchema(addTaskCommentInputSchema, {
    ...(await c.req.json()),
    taskId: c.req.param('id'),
  });
  const result = addTaskCommentCommand(input);
  recordExternalMcpAudit({
    action: 'allow',
    route: '/tasks/:id/comments',
    method: 'POST',
    taskId: input.taskId,
  });
  return c.json(result, 201 as ContentfulStatusCode);
});

command.all('/runs', () => {
  assertAgentRunsEnabled();
  throw new ExternalMcpError(
    'RUN_DISABLED',
    'Agent runs are not available yet',
  );
});

command.all('/runs/:id', () => {
  assertAgentRunsEnabled();
  throw new ExternalMcpError(
    'RUN_DISABLED',
    'Agent runs are not available yet',
  );
});

command.all('/runs/:id/cancel', () => {
  assertAgentRunsEnabled();
  throw new ExternalMcpError(
    'RUN_DISABLED',
    'Agent runs are not available yet',
  );
});

mcpServerRoutes.route('/', command);
