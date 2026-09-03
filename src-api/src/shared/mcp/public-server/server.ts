import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';

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

const API_VERSION = process.env.npm_package_version ?? '26.8.27';
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

function registerReadTools(server: McpServer, client: DaemonClient): void {
  const reads = PUBLIC_TOOL_CATALOG.filter((tool) => tool.side === 'read');
  for (const tool of reads) {
    registerOne(server, client, tool);
  }
}

function registerOne(
  server: McpServer,
  client: DaemonClient,
  tool: PublicToolDefinition,
): void {
  server.registerTool(
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
        return toolResult(data);
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}

export function createPublicMcpServer(client: DaemonClient): McpServer {
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
  registerReadTools(server, client);
  return server;
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
  const client = options.client ?? createDaemonClient({ initialUrl: daemonUrl });
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
