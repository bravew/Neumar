/**
 * GitHub MCP — thin wrapper around the official remote server.
 *
 * Points at GitHub's hosted MCP (`https://api.githubcopilot.com/mcp/` —
 * see https://github.com/github/github-mcp-server). We don't maintain a
 * tool list or any fetch logic on our side; the official server defines
 * the schema and we just forward the user's PAT in the auth header.
 *
 * Falling back to a locally-run `github-mcp-server` Docker container
 * (via stdio) is also an option — users who don't have access to the
 * hosted endpoint can add their preferred local backend via Slack App
 * Home → Add MCP server.
 */

import type { McpHttpServerConfig } from './loader';

const GITHUB_MCP_URL = 'https://api.githubcopilot.com/mcp/';

/** Build an MCP HTTP server config that authenticates with the user's PAT. */
export function getGithubMcpConfig(token: string): McpHttpServerConfig {
  return {
    type: 'http',
    url: GITHUB_MCP_URL,
    headers: {
      Authorization: `Bearer ${token}`,
    },
  };
}
