/**
 * Personal-credential connector registry — the providers a Slack user can
 * paste a personal access token / API key for from the Home tab.
 *
 * Phase-3a (no OAuth): users paste their own PAT. Tokens stored encrypted
 * with the per-user DEK. Future Phase-3b adds an OAuth path on top of the
 * same `slack_user_oauth` table without changing this registry — the
 * connectors here are the canonical user-facing list either way.
 */

export interface CredentialConnector {
  /** Stable key used in `slack_user_oauth.provider`. */
  key: string;
  /** Display name on the Home tab. */
  displayName: string;
  /** Short description shown under the field in the modal. */
  hint: string;
  /** Where the user goes to mint a token (rendered as a help link). */
  tokenUrl: string;
  /**
   * Env var the agent runtime reads. When the user has saved a token for
   * this connector, the run is invoked with `process.env[envVar] = <token>`
   * — this is how Linear MCP, GitHub MCP / tools, and direct API callers
   * pick up the user's auth at run time.
   */
  envVar: string;
  /** Loose token shape check — rejects pasted prompts / placeholders early. */
  validateToken?: (raw: string) => string | null;
}

const looksLikePlaceholder = (s: string) =>
  /<.*>|YOUR_|PASTE_|EXAMPLE/i.test(s);

// GitHub / Notion / Atlassian moved to the MCP catalog (see mcp-presets.ts)
// — adding them as plain env-var credentials never gave the agent reliable
// tool access (the in-sandbox `gh` CLI / curl path 401s because the PAT
// doesn't reach the SDK child process). The MCP route hands the token to
// the official remote server, which actually works.
const CONNECTORS: CredentialConnector[] = [
  {
    key: 'linear',
    displayName: 'Linear',
    hint: 'API key from Linear → Settings → API → Personal API keys.',
    tokenUrl: 'https://linear.app/settings/api',
    envVar: 'LINEAR_API_KEY',
    validateToken(raw) {
      if (looksLikePlaceholder(raw)) return 'looks like a placeholder';
      if (!raw.startsWith('lin_api_') && !raw.startsWith('lin_oauth_')) {
        return 'Linear keys start with lin_api_ or lin_oauth_';
      }
      return null;
    },
  },
  {
    key: 'anthropic',
    displayName: 'Anthropic API',
    hint: 'Claude API key (sk-ant-…). Used for runs you want billed to your own account.',
    tokenUrl: 'https://console.anthropic.com/settings/keys',
    envVar: 'ANTHROPIC_API_KEY',
    validateToken(raw) {
      if (looksLikePlaceholder(raw)) return 'looks like a placeholder';
      if (!raw.startsWith('sk-ant-')) {
        return 'Anthropic keys start with sk-ant-';
      }
      return null;
    },
  },
  {
    key: 'openai',
    displayName: 'OpenAI API',
    hint: 'OpenAI API key (sk-… or sk-proj-…).',
    tokenUrl: 'https://platform.openai.com/api-keys',
    envVar: 'OPENAI_API_KEY',
    validateToken(raw) {
      if (looksLikePlaceholder(raw)) return 'looks like a placeholder';
      if (!/^sk-(proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}$/.test(raw)) {
        return 'OpenAI keys start with sk-, sk-proj-, sk-svcacct-, or sk-admin-';
      }
      return null;
    },
  },
];

const BY_KEY = new Map(CONNECTORS.map((c) => [c.key, c]));

export function listCredentialConnectors(): CredentialConnector[] {
  return CONNECTORS;
}

export function getCredentialConnector(
  key: string,
): CredentialConnector | null {
  return BY_KEY.get(key) ?? null;
}

/** Stable arrow export so callers don't reconstruct it on every message. */
export const connectorKeyToEnvVar = (key: string): string | null =>
  BY_KEY.get(key)?.envVar ?? null;
