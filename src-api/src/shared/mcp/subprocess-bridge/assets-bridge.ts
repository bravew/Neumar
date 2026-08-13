/**
 * Adapter that exposes the asset catalog MCP tools over the loopback bridge
 * for subprocess agents such as Codex.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { assetsTools } from '@/shared/mcp/assets-server';

export function buildAssetsBridgeServer(): McpServer {
  const server = new McpServer({ name: 'assets', version: '0.1.0' });
  for (const t of assetsTools) {
    server.registerTool(
      t.name,
      {
        description: t.description,
        inputSchema: t.inputSchema,
        ...(t.annotations ? { annotations: t.annotations } : {}),
      },
      t.handler as Parameters<McpServer['registerTool']>[2],
    );
  }
  return server;
}
