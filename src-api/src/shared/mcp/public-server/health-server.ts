import { McpServer } from '@modelcontextprotocol/server';

import { PUBLIC_MCP_SERVER_NAME, PUBLIC_TOOL_CATALOG } from './catalog';
import { PUBLIC_MCP_INSTRUCTIONS } from './instructions';
import {
  DEFAULT_RESULT_LIMIT,
  healthInputSchema,
  healthOutputSchema,
} from './schemas';

export interface HealthServerOptions {
  version?: string;
  ready?: boolean;
  daemonUrl?: string | null;
  flags?: {
    enabled: boolean;
    writesEnabled: boolean;
    agentRunsEnabled: boolean;
    resultLimit: number;
  };
}

/**
 * Smallest SDK v2 server: `neumar_health` only.
 * Checkpoint 3 replaces this with the full read catalog behind the same name.
 */
export function createHealthMcpServer(
  options: HealthServerOptions = {},
): McpServer {
  const version = options.version ?? '0.0.0';
  const server = new McpServer(
    {
      name: PUBLIC_MCP_SERVER_NAME,
      version,
    },
    {
      capabilities: { tools: {} },
      instructions: PUBLIC_MCP_INSTRUCTIONS,
    },
  );

  const healthTool = PUBLIC_TOOL_CATALOG[0];
  if (!healthTool || healthTool.name !== 'neumar_health') {
    throw new Error('Catalog contract broken: neumar_health must be first');
  }

  server.registerTool(
    healthTool.name,
    {
      title: healthTool.title,
      description: healthTool.description,
      inputSchema: healthInputSchema,
      outputSchema: healthOutputSchema,
      annotations: { ...healthTool.annotations },
    },
    async () => {
      const structuredContent = {
        version,
        ready: options.ready ?? false,
        daemonUrl: options.daemonUrl ?? null,
        flags: options.flags ?? {
          enabled: false,
          writesEnabled: false,
          agentRunsEnabled: false,
          resultLimit: DEFAULT_RESULT_LIMIT,
        },
      };
      return {
        content: [
          { type: 'text' as const, text: JSON.stringify(structuredContent) },
        ],
        structuredContent,
      };
    },
  );

  return server;
}
