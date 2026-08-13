/**
 * Adapter that re-exposes the in-process Connectors MCP tools
 * (`connectors_list` + `connectors_execute`) as an upstream `McpServer`
 * suitable for the loopback HTTP MCP bridge. Codex / Gemini / OpenCode
 * subprocess runtimes consume this via
 * `mcp_servers.connector.url = "/mcp/bridge/connector"`.
 *
 * Rebuild per request, same rationale as the Google bridge: stateless
 * streamable-HTTP transport is single-shot, and a long-lived server would
 * have to manage cross-request context bleed it doesn't need to.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import {
  buildConnectorsTools,
  type ConnectorMcpContext,
} from '@/shared/mcp/connectors-server';

export function buildConnectorsBridgeServer(
  ctx: ConnectorMcpContext,
): McpServer {
  const server = new McpServer({ name: 'connectors', version: '1.0.0' });
  for (const t of buildConnectorsTools(ctx)) {
    server.registerTool(
      t.name,
      { description: t.description, inputSchema: t.inputSchema },
      // Anthropic SDK's `tool()` handler shape is `(args, extra) =>
      // Promise<CallToolResult>` — identical to McpServer.registerTool's
      // signature, so the handler reuses verbatim.
      t.handler as Parameters<McpServer['registerTool']>[2],
    );
  }
  return server;
}
