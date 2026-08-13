/**
 * Runtime MCP Server Management
 *
 * Endpoints for adding, removing, reconnecting, and querying MCP servers
 * during an active agent session. Requires a running Query object for the task.
 */

import type { McpServerConfig } from '@anthropic-ai/claude-agent-sdk';
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { z } from 'zod';

import { activeQueryStore } from '@/shared/services/active-query-store';
import { errorMessage } from '@/shared/utils/errors';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('McpRuntime');

// ── Schemas ──────────────────────────────────────────────────────────────────

const StdioConfigSchema = z
  .object({
    type: z.literal('stdio').optional(),
    command: z.string(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
  })
  .transform(({ type: _type, ...config }) => ({
    type: 'stdio' as const,
    ...config,
  }));

const HttpConfigSchema = z.object({
  type: z.literal('http'),
  url: z.string().url(),
});

const SseConfigSchema = z.object({
  type: z.literal('sse'),
  url: z.string().url(),
});

const AddMcpSchema = z.object({
  taskId: z.string().min(1),
  serverName: z.string().min(1),
  config: z.union([StdioConfigSchema, HttpConfigSchema, SseConfigSchema]),
});

const ToggleMcpSchema = z.object({
  taskId: z.string().min(1),
  serverName: z.string().min(1),
  enabled: z.boolean(),
});

const ReconnectMcpSchema = z.object({
  taskId: z.string().min(1),
  serverName: z.string().min(1),
});

const StatusMcpSchema = z.object({
  taskId: z.string().min(1),
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function getQueryOrFail(taskId: string): {
  query: ReturnType<typeof activeQueryStore.getQuery>;
  error?: { message: string; status: ContentfulStatusCode };
} {
  const query = activeQueryStore.getQuery(taskId);
  if (!query) {
    return {
      query: undefined,
      error: {
        message: `No active query for task ${taskId}`,
        status: 404 as ContentfulStatusCode,
      },
    };
  }
  return { query };
}

// ── Routes ───────────────────────────────────────────────────────────────────

export const mcpRuntimeRoutes = new Hono();

/**
 * POST /mcp/runtime/add — Add an MCP server to an active session
 */
mcpRuntimeRoutes.post('/add', zValidator('json', AddMcpSchema), async (c) => {
  const { taskId, serverName, config } = c.req.valid('json');
  const { query, error } = getQueryOrFail(taskId);
  if (error) return c.json({ error: error.message }, error.status);

  try {
    const result = await query!.setMcpServers({
      [serverName]: config as McpServerConfig,
    });
    logger.info(`Added MCP server '${serverName}' to task ${taskId}`);
    return c.json({ ok: true, result });
  } catch (err) {
    const msg = errorMessage(err);
    logger.error(`Failed to add MCP server '${serverName}':`, err);
    return c.json({ error: msg }, 500 as ContentfulStatusCode);
  }
});

/**
 * POST /mcp/runtime/toggle — Enable/disable an MCP server
 */
mcpRuntimeRoutes.post(
  '/toggle',
  zValidator('json', ToggleMcpSchema),
  async (c) => {
    const { taskId, serverName, enabled } = c.req.valid('json');
    const { query, error } = getQueryOrFail(taskId);
    if (error) return c.json({ error: error.message }, error.status);

    try {
      await query!.toggleMcpServer(serverName, enabled);
      logger.info(
        `Toggled MCP server '${serverName}' to ${enabled} for task ${taskId}`,
      );
      return c.json({ ok: true, serverName, enabled });
    } catch (err) {
      const msg = errorMessage(err);
      logger.error(`Failed to toggle MCP server '${serverName}':`, err);
      return c.json({ error: msg }, 500 as ContentfulStatusCode);
    }
  },
);

/**
 * POST /mcp/runtime/reconnect — Reconnect a failed MCP server
 */
mcpRuntimeRoutes.post(
  '/reconnect',
  zValidator('json', ReconnectMcpSchema),
  async (c) => {
    const { taskId, serverName } = c.req.valid('json');
    const { query, error } = getQueryOrFail(taskId);
    if (error) return c.json({ error: error.message }, error.status);

    try {
      await query!.reconnectMcpServer(serverName);
      logger.info(`Reconnected MCP server '${serverName}' for task ${taskId}`);
      return c.json({ ok: true, serverName });
    } catch (err) {
      const msg = errorMessage(err);
      logger.error(`Failed to reconnect MCP server '${serverName}':`, err);
      return c.json({ error: msg }, 500 as ContentfulStatusCode);
    }
  },
);

/**
 * GET /mcp/runtime/status — Get all MCP server statuses for a task
 */
mcpRuntimeRoutes.get(
  '/status',
  zValidator('query', StatusMcpSchema),
  async (c) => {
    const { taskId } = c.req.valid('query');
    const { query, error } = getQueryOrFail(taskId);
    if (error) return c.json({ error: error.message }, error.status);

    try {
      const status = await query!.mcpServerStatus();
      return c.json({ ok: true, servers: status });
    } catch (err) {
      const msg = errorMessage(err);
      logger.error(`Failed to get MCP server status for task ${taskId}:`, err);
      return c.json({ error: msg }, 500 as ContentfulStatusCode);
    }
  },
);
