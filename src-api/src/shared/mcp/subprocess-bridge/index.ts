/**
 * Build the MCP server config + env that a subprocess-shelled agent (Codex,
 * Gemini, OpenCode, …) should hand to its CLI so the agent can talk to
 * neuma's connectors over the loopback bridge at `/mcp/bridge/<connector>`.
 *
 * For each connector we run the shared connector-tier policy gate; if it
 * passes, mint a per-run bearer token bound to the policy snapshot and add
 * an `mcp_servers.<name>` entry to the returned config. If denied, emit
 * the canonical localised refusal copy as a denial hint that the caller
 * folds into its system prompt.
 *
 * The result includes a `revoke()` callback so the caller can clear the
 * minted tokens once the run finishes (or aborts).
 */
import { DEFAULT_API_HOST } from '@/config/constants';

import { isAssetsCatalogEnabled } from '@/shared/assets/flags';
import {
  type ConnectorPolicyInput,
  evaluateConnectorGate,
  type GlobalConnector,
} from '@/shared/auth/connector-policy';
import {
  type InProcessResultHook,
  type InProcessServerFactory,
  mintInProcessBridgeToken,
  revokeInProcessBridgeToken,
} from '@/shared/mcp/subprocess-bridge/inprocess-bridge';
import {
  type BridgeConnector,
  mintBridgeToken,
  revokeBridgeToken,
} from '@/shared/mcp/subprocess-bridge/token-store';
import type { SessionContext } from '@/shared/services/session-context';

/**
 * `default_tools_approval_mode = "approve"` is REQUIRED, not optional:
 * without it Codex CLI auto-cancels every MCP tool call in non-interactive
 * `codex exec` mode (the error surfaces as `"user cancelled MCP tool
 * call"`). Setting `approval_policy = "never"` at the thread level is NOT
 * sufficient — that flag governs shell/file approvals, not MCP tools.
 * Verified empirically against Codex CLI 0.125.
 */
type SubprocessMcpServers = Record<
  string,
  {
    url: string;
    bearer_token_env_var: string;
    default_tools_approval_mode: 'approve' | 'prompt' | 'never';
  }
>;

export interface SubprocessMcpConfig {
  /** Subset of `CodexOptions.config` adding `mcp_servers.<name>` entries.
   * Streamable HTTP MCP is on by default in Codex CLI 0.125+; no feature
   * flag needed (`codex features list | grep rmcp` returns nothing). */
  codexConfig: { mcp_servers?: SubprocessMcpServers };
  /** Environment variables the CLI subprocess must inherit so it can read
   * each `bearer_token_env_var`. Caller merges into its own env block. */
  env: Record<string, string>;
  /** Localised denial copy for connectors that the policy blocked. The
   * adapter prepends these to the system prompt so the agent emits the
   * canned refusal verbatim if the user asks for a blocked connector. */
  denialHints: string[];
  /** Tear down the per-run tokens. Call from the agent's finally{}. */
  revoke: () => void;
}

export interface BuildSubprocessMcpConfigInput {
  /** Caller's session id — propagated into the token store for diagnostics. */
  sessionId: string;
  channelContext: (ConnectorPolicyInput & { configId?: string }) | undefined;
  locale?: string;
  /** Subset of connectors the caller wants to expose to the subprocess.
   * Defaults to all bridge-supported connectors. */
  connectors?: BridgeConnector[];
  /** Per-run, project-scoped in-process MCP servers to expose alongside the
   * fixed connectors — e.g. Video Mode's `video-edit`/`media`/`ffmpeg`. Each
   * gets its own bridge token bound to its name and a `mcp_servers.<name>`
   * entry pointing at `/mcp/bridge/inproc/<name>`. Runtime-agnostic: the same
   * config drives Codex, Cursor, Gemini, DeepSeek, or any subprocess CLI. */
  inProcessServers?: InProcessBridgeServer[];
  /** Override the API base used in the bridge URL. Defaults to the running
   * server's host:port (5126 in dev, 2620 under the Tauri sidecar). */
  apiBase?: string;
}

export interface InProcessBridgeServer {
  /** MCP server name + URL path segment (`/mcp/bridge/inproc/<name>`). */
  name: string;
  createServer: InProcessServerFactory;
  /** Ambient session context the bridge installs around each request (output
   * dir, project id for media ingest). */
  sessionContext?: SessionContext;
  /** Post-request hook (raw JSON-RPC response text) — see InProcessResultHook. */
  onResult?: InProcessResultHook;
}

const ALL_BRIDGE_CONNECTORS: BridgeConnector[] = [
  'google',
  'connector',
  'assets',
];

function defaultApiBase(): string {
  // Must match the port the API server actually binds to in
  // src-api/src/index.ts: `Number(process.env.PORT) || 5126`. Using
  // DEFAULT_API_PORT (2620) here was wrong — that's the Tauri-sidecar prod
  // default, but in `pnpm dev:api` PORT is unset so the server listens on
  // 5126. Mismatched ports cause silent connection refused on the Codex
  // side and no [McpBridge] logs at all.
  const port = Number(process.env.PORT) || 5126;
  // 127.0.0.1 not localhost — explicit IPv4 dodges any IPv6 resolution
  // landing on a non-loopback interface.
  const host =
    DEFAULT_API_HOST === 'localhost' ? '127.0.0.1' : DEFAULT_API_HOST;
  return `http://${host}:${port}`;
}

/** Map a bridge connector to the policy connector name. They line up today
 * but the indirection is cheap insurance: when a future bridge connector is
 * added whose name doesn't match any policy connector, this map forces an
 * explicit mapping decision instead of an implicit string-equality bug. */
const POLICY_CONNECTOR: Record<'google' | 'connector', GlobalConnector> = {
  google: 'google',
  connector: 'connector',
};

/** Bearer-token env var the CLI process reads. */
const TOKEN_ENV_VAR: Record<BridgeConnector, string> = {
  google: 'NEUMA_MCP_BRIDGE_TOKEN_GOOGLE',
  connector: 'NEUMA_TOOL_TOKEN',
  assets: 'NEUMA_MCP_BRIDGE_TOKEN_ASSETS',
};

// Once-considered: disable Codex's bundled `openai-curated` plugins
// (gmail, github, …) so their SKILL.md prose doesn't bias the model toward
// hosted-connector tool names. Empirically the override
// `-c plugins."gmail@openai-curated".enabled=false` does NOT take effect
// against Codex CLI 0.125 — the model still reads SKILL.md every run.
// Harmless overhead; left as a note so the next person doesn't repeat it.

export async function buildSubprocessMcpConfig(
  input: BuildSubprocessMcpConfigInput,
): Promise<SubprocessMcpConfig> {
  const wanted = input.connectors ?? ALL_BRIDGE_CONNECTORS;
  const apiBase = input.apiBase ?? defaultApiBase();

  const mcpServers: SubprocessMcpServers = {};
  const env: Record<string, string> = {};
  const denialHints: string[] = [];

  for (const connector of wanted) {
    if (connector === 'assets' && !isAssetsCatalogEnabled()) {
      continue;
    }

    // The 'connector' bridge is a meta-transport for Composio-managed
    // connectors; per-tool policy (tier, approval, scope) runs inside the
    // binder at execute time, so the connector-level gate would just
    // duplicate that check against a non-existent seed definition and
    // refuse the whole bridge. The 'assets' bridge is local catalog access,
    // gated by the catalog feature flag above. Skip the connector policy gate
    // for both cases.
    if (connector === 'google') {
      const policyConnector = POLICY_CONNECTOR[connector];
      const gate = evaluateConnectorGate(
        policyConnector,
        input.channelContext,
        input.locale,
      );
      if (!gate.allow) {
        if (gate.denialHint) denialHints.push(gate.denialHint);
        continue;
      }
    }

    // Auth probe is intentionally NOT done here — the bridge route does it
    // on every request anyway, and triggering a token refresh on this
    // synchronous setup path adds latency to every Codex turn.

    const envVar = TOKEN_ENV_VAR[connector];
    const bridgeToken = mintBridgeToken({
      connector,
      policyContext: input.channelContext,
      locale: input.locale,
      sessionId: input.sessionId,
    });
    env[envVar] = bridgeToken;
    mcpServers[connector] = {
      url: `${apiBase}/mcp/bridge/${connector}`,
      bearer_token_env_var: envVar,
      default_tools_approval_mode: 'approve',
    };
  }

  // Per-run in-process servers (Video Mode tool surface, etc.). No policy
  // gate: these are the caller's own project-scoped servers, not shared
  // connectors, and each tool enforces its own workspace/approval rules.
  const inProcTokens: string[] = [];
  for (const server of input.inProcessServers ?? []) {
    const envVar = inProcTokenEnvVar(server.name);
    const token = mintInProcessBridgeToken({
      name: server.name,
      sessionId: input.sessionId,
      createServer: server.createServer,
      sessionContext: server.sessionContext,
      onResult: server.onResult,
    });
    inProcTokens.push(token);
    env[envVar] = token;
    mcpServers[server.name] = {
      url: `${apiBase}/mcp/bridge/inproc/${server.name}`,
      bearer_token_env_var: envVar,
      default_tools_approval_mode: 'approve',
    };
  }

  return {
    codexConfig:
      Object.keys(mcpServers).length > 0 ? { mcp_servers: mcpServers } : {},
    env,
    denialHints,
    revoke: () => {
      // Connector tokens are stored in `env`; in-process tokens are tracked
      // separately because they live in a different registry.
      for (const t of Object.values(env)) revokeBridgeToken(t);
      for (const t of inProcTokens) revokeInProcessBridgeToken(t);
    },
  };
}

/** Bridge-token env var for an in-process server, e.g. `video-edit` →
 * `NEUMA_MCP_BRIDGE_TOKEN_INPROC_VIDEO_EDIT`. */
function inProcTokenEnvVar(name: string): string {
  return `NEUMA_MCP_BRIDGE_TOKEN_INPROC_${name.replace(/-/g, '_').toUpperCase()}`;
}
