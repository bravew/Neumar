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

import { getDatabase } from '@/shared/db';
import { advertisedUiResourceUri } from '@/shared/mcp/ui-resource-gate';
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

const UiResourceSchema = z.object({
  taskId: z.string().min(1),
  serverName: z.string().min(1).max(128),
  toolName: z.string().min(1).max(256),
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

function taskInvokedMcpTool(
  taskId: string,
  serverName: string,
  toolName: string,
): boolean {
  const row = getDatabase()
    .prepare(
      `SELECT 1 AS ok FROM messages
       WHERE task_id = ? AND type = 'tool_use' AND tool_name = ?
       LIMIT 1`,
    )
    .get(taskId, `mcp__${serverName}__${toolName}`);
  return row !== undefined;
}

/**
 * POST /mcp/runtime/ui-resource — Read the ui:// resource a connected server
 * advertised on a tool the host invoked. The URI comes from that advertisement,
 * not from the caller, and the tool must already be stored as a tool_use row.
 * The contents are untrusted HTML; the client renders them in the artifact sandbox.
 */
mcpRuntimeRoutes.post(
  '/ui-resource',
  zValidator('json', UiResourceSchema),
  async (c) => {
    const { taskId, serverName, toolName } = c.req.valid('json');
    const { query, error } = getQueryOrFail(taskId);
    if (error) return c.json({ error: error.message }, error.status);

    try {
      if (!taskInvokedMcpTool(taskId, serverName, toolName)) {
        return c.json(
          { error: 'This tool has not been invoked' },
          404 as ContentfulStatusCode,
        );
      }
      const servers = await query!.mcpServerStatus();
      const uri = advertisedUiResourceUri(servers, serverName, toolName);
      if (!uri) {
        return c.json(
          { error: 'This tool does not advertise a UI resource' },
          404 as ContentfulStatusCode,
        );
      }
      const resource = await query!.readMcpResource(serverName, uri);
      return c.json({ ok: true, uri, contents: resource.contents });
    } catch (err) {
      const msg = errorMessage(err);
      logger.error(
        `Failed to read MCP UI resource ${serverName}/${toolName}:`,
        err,
      );
      return c.json({ error: msg }, 500 as ContentfulStatusCode);
    }
  },
);
