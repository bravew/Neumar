/**
 * Per-user MCP overlay loader.
 *
 * Reads `slack_user_mcp` rows for a given Slack identity, decrypts each
 * row's headers/env with that user's DEK, and returns an `McpServerConfig`
 * map suitable for merging on top of the global mcp.json config at turn
 * setup time.
 *
 * **Not yet wired into the agent loop.** The seam lives at
 * `src-api/src/shared/services/gateway/core/message-router.ts:746`
 * (the `runAgent(...)` call site). Hooking this in is Phase 4 of
 * `dev-doc/plan/2026-04-27-slack-app-home.md` — see the TODO marker
 * dropped at that call site (search "TODO(slack-home)").
 *
 * Convention for merging: user-scoped servers shadow globals by `name`.
 * If a user MCP is `pendingAdminApproval` or `enabled === false`, it is
 * skipped — the user sees "Awaiting admin approval" / "Disabled" in
 * Slack Home and the runtime sees nothing.
 */

import {
  type SlackUserMcpRow,
  getSlackUserMcpEnv,
  listSlackUserMcp,
  unwrapDekFor,
} from '@/shared/db/operations-slack-home';

import type {
  McpHttpServerConfig,
  McpSSEServerConfig,
  McpServerConfig,
} from './loader';

export interface UserMcpOverlay {
  /** name → server config, ready to spread over the global mcp.json. */
  servers: Record<string, McpServerConfig>;
  /** Names that were skipped because they're pending or disabled. */
  skipped: Array<{
    name: string;
    reason: 'pending_admin_approval' | 'disabled' | 'unsupported_transport';
  }>;
}

export function loadUserScopedMcpServers(args: {
  slackTeamId: string;
  slackUserId: string;
}): UserMcpOverlay {
  const rows = listSlackUserMcp(args.slackTeamId, args.slackUserId);
  if (rows.length === 0) return { servers: {}, skipped: [] };

  const dek = unwrapDekFor(args.slackTeamId, args.slackUserId);
  const overlay: UserMcpOverlay = { servers: {}, skipped: [] };

  for (const row of rows) {
    if (row.pendingAdminApproval) {
      overlay.skipped.push({
        name: row.name,
        reason: 'pending_admin_approval',
      });
      continue;
    }
    if (!row.enabled) {
      overlay.skipped.push({ name: row.name, reason: 'disabled' });
      continue;
    }

    const env = dek ? (getSlackUserMcpEnv({ id: row.id, dek }) ?? {}) : {};

    const config = buildConfig(row, env);
    if (!config) {
      overlay.skipped.push({
        name: row.name,
        reason: 'unsupported_transport',
      });
      continue;
    }
    overlay.servers[row.name] = config;
  }

  return overlay;
}

function buildConfig(
  row: SlackUserMcpRow,
  env: Record<string, string>,
): McpServerConfig | null {
  // TODO(phase-4b): re-run validateBaseUrl(row.url) here before wiring this
  // into the agent loop. SSRF guard runs at add-time (probe), but a direct
  // DB write could bypass it; revalidating at load time closes that gap.
  if (row.transport === 'http' && row.url) {
    const cfg: McpHttpServerConfig = {
      type: 'http',
      url: row.url,
      headers: env,
    };
    return cfg;
  }
  if (row.transport === 'sse' && row.url) {
    const cfg: McpSSEServerConfig = {
      type: 'sse',
      url: row.url,
      headers: env,
    };
    return cfg;
  }
  // stdio servers from Slack Home are intentionally not constructed here —
  // the desktop sidecar must not spawn arbitrary user-supplied processes
  // without a desktop confirmation surface (see Phase 4 design).
  return null;
}
