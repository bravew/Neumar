/**
 * Adapter that exposes the existing in-process Google tool definitions
 * (`googleTools` from `src-api/src/shared/mcp/google-server.ts`) as a fresh
 * upstream `McpServer` instance suitable for the loopback HTTP MCP bridge.
 *
 * We intentionally rebuild the server per request instead of caching one —
 * `WebStandardStreamableHTTPServerTransport.handleRequest()` is single-shot
 * in stateless mode (`sessionIdGenerator: undefined`) and the Anthropic SDK
 * already manages the in-process Claude path's lifecycle separately, so a
 * cached singleton would risk cross-request state bleed for very little win.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { filterToolsByScopes } from '@/shared/mcp/google-server';

export function buildGoogleBridgeServer(grantedScopes: string[]): McpServer {
  const server = new McpServer({ name: 'google', version: '1.0.0' });
  for (const t of filterToolsByScopes(grantedScopes)) {
    server.registerTool(
      t.name,
      {
        description: t.description,
        inputSchema: t.inputSchema,
        ...(t.annotations ? { annotations: t.annotations } : {}),
      },
      // The handler signature matches: ({...args}, extra) => Promise<CallToolResult>
      // The Anthropic SDK's `tool()` wrapper produces handlers that ignore `extra`,
      // so calling them with the upstream MCP signature is safe.
      t.handler as Parameters<McpServer['registerTool']>[2],
    );
  }
  return server;
}
