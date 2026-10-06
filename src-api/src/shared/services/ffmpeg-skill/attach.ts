/**
 * Host-factory attachment for the managed FFmpeg skill.
 *
 * Builds the fresh in-process config (Claude) and loopback-bridge entry
 * (Codex/Cursor/Kimi), and folds everything a caller needs into one
 * `prepareFfmpegSkillAttachment` result. Kept separate from `handoff.ts`
 * because this module imports the MCP server while the server imports
 * `handoff.ts` for publication — the edge must stay one-way.
 */

import type { McpServerConfig } from '@anthropic-ai/claude-agent-sdk';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { AgentProvider, BridgeInProcessServer } from '@/core/agent/types';

import { createFfmpegSkillMcpServer } from '@/shared/mcp/ffmpeg-skill-server';
import type { SessionContext } from '@/shared/services/session-context';

import {
  appendFfmpegSkillContext,
  FFMPEG_SKILL_ID,
  FFMPEG_SKILL_SERVER_NAME,
  ffmpegSkillCapabilityMessage,
  ffmpegSkillTransportFor,
  type FfmpegSkillTransport,
} from './handoff';

/** Fresh in-process server config for the Claude SDK path. */
export function ffmpegSkillInProcessServer(): McpServerConfig {
  return createFfmpegSkillMcpServer();
}

/** Fresh loopback-bridge entry for subprocess runtimes (Codex/Cursor/Kimi). */
export function ffmpegSkillBridgeServer(sessionContext?: SessionContext): {
  name: string;
  createServer: () => McpServer;
  sessionContext?: SessionContext;
} {
  return {
    name: FFMPEG_SKILL_SERVER_NAME,
    createServer: () => createFfmpegSkillMcpServer().instance,
    sessionContext,
  };
}

export interface FfmpegSkillAttachment {
  transport: FfmpegSkillTransport;
  /** Claude SDK in-process config, when the provider mounts it directly. */
  inProcessMcpServers?: Record<string, McpServerConfig>;
  /** Subprocess loopback-bridge entries, when the provider uses the bridge. */
  bridgeInProcessServers?: BridgeInProcessServer[];
  /** `systemContext` with the selected-skill body appended for bridge providers. */
  systemContext: string;
  /**
   * Non-null only when `ffmpeg` is selected on a provider with no host-factory
   * transport. Callers yield it as a clear error instead of silently dropping
   * the selection.
   */
  capabilityMessage: string | null;
}

/**
 * Compute the managed-server attachment, instruction injection, and capability
 * gate for one run. Attaches the server unconditionally for supported
 * providers (it is a first-party tool surface, like native ffmpeg in Video
 * Mode); the selected-skill body is appended only for bridge providers; an
 * unsupported provider with `ffmpeg` selected yields a capability message.
 */
export async function prepareFfmpegSkillAttachment(input: {
  provider: AgentProvider | undefined;
  pinnedSkills: readonly string[] | undefined;
  systemContext: string;
  sessionContext?: SessionContext;
}): Promise<FfmpegSkillAttachment> {
  const transport = ffmpegSkillTransportFor(input.provider);
  const capabilityMessage = input.pinnedSkills?.includes(FFMPEG_SKILL_ID)
    ? ffmpegSkillCapabilityMessage(input.provider)
    : null;

  if (transport === 'in-process') {
    return {
      transport,
      inProcessMcpServers: {
        [FFMPEG_SKILL_SERVER_NAME]: ffmpegSkillInProcessServer(),
      },
      systemContext: input.systemContext,
      capabilityMessage,
    };
  }

  if (transport === 'bridge') {
    return {
      transport,
      bridgeInProcessServers: [ffmpegSkillBridgeServer(input.sessionContext)],
      systemContext: await appendFfmpegSkillContext(
        input.provider,
        input.pinnedSkills,
        input.systemContext,
      ),
      capabilityMessage,
    };
  }

  return {
    transport,
    systemContext: input.systemContext,
    capabilityMessage,
  };
}
