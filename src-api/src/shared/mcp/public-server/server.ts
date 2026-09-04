import { McpServer, type RegisteredTool } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';

import { getApiVersion } from '@/shared/utils/app-version';

import {
  PUBLIC_MCP_SERVER_NAME,
  PUBLIC_TOOL_CATALOG,
  type PublicToolDefinition,
} from './catalog';
import {
  createDaemonClient,
  errorResult,
  type DaemonClient,
} from './daemon-client';
import { resolveDaemonUrl } from './discover';
import { PUBLIC_MCP_INSTRUCTIONS } from './instructions';
import { createStdioLogger, enableStdioSafeLogging } from './stdio-logger';

const API_VERSION = getApiVersion();
const DEFAULT_IDLE_MS = 30 * 60 * 1000;
const MAX_IDLE_MS = 24 * 60 * 60 * 1000;

export interface PublicMcpServerOptions {
  daemonUrl?: string;
  client?: DaemonClient;
  idleMs?: number;
}

function idleBudget(override?: number): number {
  const raw =
    override ??
    (process.env.NEUMAR_MCP_IDLE_MS
      ? Number(process.env.NEUMAR_MCP_IDLE_MS)
      : DEFAULT_IDLE_MS);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_IDLE_MS;
  return Math.min(MAX_IDLE_MS, raw);
}

function toolResult(data: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data) }],
    structuredContent: data as Record<string, unknown>,
  };
}

function applyCatalogFlags(
  registrations: Map<string, RegisteredTool>,
  flags: { writesEnabled: boolean; agentRunsEnabled: boolean },
): boolean {
  let changed = false;
  for (const tool of PUBLIC_TOOL_CATALOG) {
    if (tool.side === 'read') continue;
    const registered = registrations.get(tool.name);
    if (!registered) continue;
    const want =
      tool.side === 'write' ? flags.writesEnabled : flags.agentRunsEnabled;
    if (want && !registered.enabled) {
      registered.enable();
      changed = true;
    } else if (!want && registered.enabled) {
      registered.disable();
      changed = true;
    }
  }
  return changed;
}

export function createPublicMcpServer(client: DaemonClient): McpServer {
  const registrations = new Map<string, RegisteredTool>();

  const syncFlags = async () => {
    try {
      const health = await client.health();
      return applyCatalogFlags(registrations, health.flags);
    } catch {
      return applyCatalogFlags(registrations, {
        writesEnabled: false,
        agentRunsEnabled: false,
      });
    }
  };

  const server = new McpServer(
    {
      name: PUBLIC_MCP_SERVER_NAME,
      version: API_VERSION,
    },
    {
      capabilities: { tools: { listChanged: true } },
      instructions: PUBLIC_MCP_INSTRUCTIONS,
    },
  );

  for (const tool of PUBLIC_TOOL_CATALOG) {
    const registered = registerOne(server, client, tool, registrations);
    if (tool.side !== 'read') registered.disable();
    registrations.set(tool.name, registered);
  }

  wrapHandlerWithFlagSync(server, 'tools/list', syncFlags);
  wrapHandlerWithFlagSync(server, 'tools/call', syncFlags);

  return server;
}

/**
 * SDK v2 installs a synchronous tools/list handler. Replace it so a live
 * stdio process re-fetches daemon flags on every list/call without restarting
 * the host after the user toggles writes in Settings.
 */
function wrapHandlerWithFlagSync(
  server: McpServer,
  method: 'tools/list' | 'tools/call',
  syncWrites: () => Promise<boolean>,
): void {
  const proto = server.server as unknown as {
    _getRequestHandler(
      method: string,
    ): ((request: unknown, extra: unknown) => unknown) | undefined;
    removeRequestHandler(method: string): void;
    setRequestHandler(
      method: string,
      handler: (request: unknown, extra: unknown) => unknown,
    ): void;
  };
  const original = proto._getRequestHandler(method);
  if (!original) {
    throw new Error(
      `MCP SDK did not register a ${method} handler; cannot sync live flags`,
    );
  }
  proto.removeRequestHandler(method);
  proto.setRequestHandler(method, async (request, extra) => {
    await syncWrites();
    return original(request, extra);
  });
}

function registerOne(
  server: McpServer,
  client: DaemonClient,
  tool: PublicToolDefinition,
  registrations: Map<string, RegisteredTool>,
): RegisteredTool {
  return server.registerTool(
    tool.name,
    {
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
      outputSchema: tool.outputSchema,
      annotations: { ...tool.annotations },
    },
    async (args) => {
      try {
        const data = await client.call(
          tool.name,
          (args ?? {}) as Record<string, unknown>,
        );
        if (tool.name === 'neumar_health') {
          const flags = (
            data as {
              flags?: { writesEnabled?: boolean; agentRunsEnabled?: boolean };
            }
          ).flags;
          applyCatalogFlags(registrations, {
            writesEnabled: flags?.writesEnabled === true,
            agentRunsEnabled: flags?.agentRunsEnabled === true,
          });
        }
        return toolResult(data);
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}

function installIdleExit(
  getInFlight: () => number,
  idleMs: number,
  logger: ReturnType<typeof createStdioLogger>,
): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      if (getInFlight() > 0) {
        arm();
        return;
      }
      logger.info('Idle timeout; exiting stdio MCP process');
      process.exit(0);
    }, idleMs);
    timer.unref?.();
  };
  arm();
  const onActivity = () => arm();
  process.stdin.on('data', onActivity);
  return () => {
    if (timer) clearTimeout(timer);
    process.stdin.off('data', onActivity);
  };
}

export async function startPublicMcpServer(
  options: PublicMcpServerOptions = {},
): Promise<void> {
  enableStdioSafeLogging();
  const logger = createStdioLogger();
  const daemonUrl = resolveDaemonUrl(options.daemonUrl);
  const client =
    options.client ?? createDaemonClient({ initialUrl: daemonUrl });
  logger.info(`Starting public MCP stdio server; daemon ${client.currentUrl}`);

  const handle = serveStdio(() => createPublicMcpServer(client), {
    legacy: 'serve',
    onerror: (error) => {
      logger.error('stdio transport error', error);
    },
  });

  const stopIdle = installIdleExit(
    () => client.inFlight,
    idleBudget(options.idleMs),
    logger,
  );

  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}; closing stdio MCP`);
    stopIdle();
    await handle.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.stdin.on('end', () => {
    void shutdown('stdin EOF');
  });
}
