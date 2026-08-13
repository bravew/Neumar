/**
 * Slack MCP Server
 *
 * Provides config for the remote Slack MCP server (mcp.slack.com).
 * The Slack MCP server requires a user OAuth token for search/read/write tools.
 */

import type { McpHttpServerConfig } from './loader';

const SLACK_MCP_URL = 'https://mcp.slack.com/mcp';
const MCP_DISCOVERY_TIMEOUT_MS = 10_000;

/** Cache version — increment when user token is revoked to force re-discovery */
let slackMcpCacheVersion = 0;

/**
 * Discover tool names from the Slack MCP server via tools/list.
 * Returns an empty array if the request fails (e.g. invalid token).
 */
export async function discoverSlackMcpTools(
  userToken: string,
): Promise<string[]> {
  try {
    const res = await fetch(SLACK_MCP_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {},
      }),
      signal: AbortSignal.timeout(MCP_DISCOVERY_TIMEOUT_MS),
    });

    if (!res.ok) return [];

    const data = (await res.json()) as {
      result?: { tools?: Array<{ name?: string }> };
      error?: unknown;
    };

    if (data.error || !data.result?.tools) return [];

    const names: string[] = [];
    for (const t of data.result.tools) {
      if (t.name) names.push(t.name);
    }
    return names;
  } catch {
    return [];
  }
}

/**
 * Get MCP server config for Slack, authenticated with the user's OAuth token.
 */
export function getSlackMcpConfig(userToken: string): McpHttpServerConfig {
  return {
    type: 'http',
    url: SLACK_MCP_URL,
    headers: {
      Authorization: `Bearer ${userToken}`,
    },
  };
}

/**
 * Get the current cache version. Callers can store this and compare
 * to detect when the cache was invalidated.
 */
export function getSlackMcpCacheVersion(): number {
  return slackMcpCacheVersion;
}

/**
 * Clear the Slack MCP cache to force re-discovery.
 * Call when the user token is revoked so the MCP loader will re-check
 * token validity before including Slack in the server list.
 */
export function clearSlackMcpCache(): void {
  slackMcpCacheVersion++;
}
