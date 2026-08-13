/**
 * Figma MCP Server Configuration
 *
 * Preset for the official Figma remote MCP server.
 * Uses OAuth 2.0 — auth happens on first tool call via browser.
 */

import type { McpHttpServerConfig } from './loader';

/**
 * Figma MCP tool wildcard for allowedTools registration.
 * Uses wildcard to automatically support any tools the Figma MCP server exposes
 * (currently `get_figma_data`, but Figma may add more in the future).
 */
export const FIGMA_TOOL_PATTERN = 'mcp__figma__*';

/** Create Figma MCP server config for the remote OAuth-based server. */
export function createFigmaMcpConfig(): McpHttpServerConfig {
  return {
    type: 'http',
    url: 'https://mcp.figma.com/mcp',
  };
}
