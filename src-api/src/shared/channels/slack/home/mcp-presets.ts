/**
 * Curated catalog of remote MCP servers a user can connect with one
 * click from Slack App Home.
 *
 * Each preset names a hosted MCP endpoint that accepts a Bearer-token
 * Authorization header — the user pastes a token and we register a
 * `slack_user_mcp` row pointing at the preset URL with
 * `Authorization=Bearer <token>` in the env headers map.
 *
 * Adding a preset requires only a verified hosted URL + a doc link to
 * mint the token. We don't maintain tool schemas — the official
 * server owns those.
 */

export interface McpPreset {
  /** Stable key — also used as the saved server name (`slack_user_mcp.name`). */
  key: string;
  /** Display name shown on the Home tab + modal title. */
  displayName: string;
  /** Short description: where the token comes from / what it grants. */
  hint: string;
  /** Help link to the provider's token-mint page. */
  tokenUrl: string;
  /** Hosted MCP endpoint URL. */
  url: string;
  /** Optional placeholder shown in the token input. */
  tokenPlaceholder?: string;
  /**
   * Brand icon shown next to the connector in App Home. Slack `image`
   * elements only accept PNG/JPG/GIF (not SVG), so we point at each
   * provider's PNG favicon. Stable, no asset hosting required.
   */
  iconUrl: string;
}

const FAVICON = (domain: string) =>
  `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;

const PRESETS: McpPreset[] = [
  {
    key: 'github',
    displayName: 'GitHub',
    hint: 'Personal access token from a *GitHub Copilot-enabled* account — the hosted endpoint (api.githubcopilot.com/mcp/) gates non-Copilot tokens with a 401. Classic PAT with `repo` + `read:user` scopes is the most reliable. The official server (https://github.com/github/github-mcp-server) handles every PR/issue/repo operation.',
    tokenUrl:
      'https://github.com/settings/tokens/new?scopes=repo,read:user&description=neumar-slack',
    url: 'https://api.githubcopilot.com/mcp/',
    tokenPlaceholder: 'ghp_…',
    // GitHub's own favicon CDN — Google's s2 proxy returns a redirect for
    // github.com that Slack sometimes refuses to follow.
    iconUrl: 'https://github.githubassets.com/favicons/favicon.png',
  },
  {
    key: 'notion',
    displayName: 'Notion',
    hint: 'Internal-integration secret. After creating, share the relevant pages/databases with the integration.',
    tokenUrl: 'https://www.notion.so/my-integrations',
    url: 'https://mcp.notion.com/mcp',
    tokenPlaceholder: 'ntn_… or secret_…',
    iconUrl: FAVICON('notion.so'),
  },
  {
    key: 'linear',
    displayName: 'Linear',
    hint: 'Personal API key from Linear. Hosted alternative to the built-in Linear tools — useful when you want issue access without admin enabling Linear globally.',
    tokenUrl: 'https://linear.app/settings/api',
    url: 'https://mcp.linear.app/mcp',
    tokenPlaceholder: 'lin_api_…',
    iconUrl: FAVICON('linear.app'),
  },
  {
    key: 'atlassian',
    displayName: 'Atlassian (Jira + Confluence)',
    hint: 'Atlassian API token from id.atlassian.com. Covers Jira issues and Confluence pages via one server.',
    tokenUrl: 'https://id.atlassian.com/manage-profile/security/api-tokens',
    url: 'https://mcp.atlassian.com/v1/sse',
    tokenPlaceholder: 'ATATT3…',
    iconUrl: FAVICON('atlassian.com'),
  },
  {
    key: 'sentry',
    displayName: 'Sentry',
    hint: 'Sentry user auth token with `event:read` and `project:read` scopes. Lets the agent triage error events and recent issues.',
    tokenUrl: 'https://sentry.io/settings/account/api/auth-tokens/',
    url: 'https://mcp.sentry.dev/sse',
    tokenPlaceholder: 'sntrys_…',
    iconUrl: FAVICON('sentry.io'),
  },
];

const BY_KEY = new Map(PRESETS.map((p) => [p.key, p]));

export function listMcpPresets(): McpPreset[] {
  return PRESETS;
}

export function getMcpPreset(key: string): McpPreset | null {
  return BY_KEY.get(key) ?? null;
}
