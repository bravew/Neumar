import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { getAppDir } from '@/config/constants';

import { getSetting } from '@/shared/db/operations';

/**
 * Directory for inbound user uploads. Visible so the agent's `ls`/Glob
 * finds it; dot-prefixed dirs are a Unix convention for config/state and
 * agents routinely miss them.
 */
export const INBOUND_ATTACHMENTS_DIR = 'attachments';

/** Legacy location kept readable for threads created before the rename. */
export const LEGACY_INBOUND_ATTACHMENTS_DIR = '.attachments';

/** True when the path is inside an inbound attachments folder (new or legacy). */
export function isInboundAttachmentPath(filePath: string): boolean {
  return (
    filePath.includes(`/${INBOUND_ATTACHMENTS_DIR}/`) ||
    filePath.includes(`/${LEGACY_INBOUND_ATTACHMENTS_DIR}/`)
  );
}

/**
 * Build a workspace-qualified userId for memory scope isolation.
 * Slack/Lark user IDs are workspace-scoped (not globally unique), so the
 * scope key must include the workspace/tenant qualifier to prevent cross-
 * workspace memory leakage.
 *
 * Result examples: "T04ABC:U12345" (Slack), "tenant123:ou_abc" (Lark),
 * "U12345" (Telegram — globally unique, no qualifier needed).
 */
export function buildQualifiedUserId(
  platform: string,
  userId: string,
  metadata?: Record<string, unknown>,
): string {
  // Strip `:` from components to prevent scope key collisions.
  // The `:` delimiter separating workspace from userId must be unambiguous.
  const safeId = userId.replace(/:/g, '_');
  switch (platform) {
    case 'slack': {
      const teamId = ((metadata?.teamId as string) ?? '_').replace(/:/g, '_');
      return `${teamId}:${safeId}`;
    }
    case 'lark': {
      const tenantKey = ((metadata?.tenantKey as string) ?? '_').replace(
        /:/g,
        '_',
      );
      return `${tenantKey}:${safeId}`;
    }
    case 'discord': {
      const guildId = ((metadata?.guildId as string) ?? '_').replace(/:/g, '_');
      return `${guildId}:${safeId}`;
    }
    case 'telegram':
    default:
      return safeId;
  }
}

/** Cache of directories already created to avoid redundant mkdirSync syscalls. */
const createdDirs = new Set<string>();

/**
 * Resolve a per-channel workspace directory for a given platform + user.
 *
 * Layout (without threadId):  <baseWorkDir>/channels/<platform>/<userId>/
 * Layout (with threadId):     <baseWorkDir>/channels/<platform>/<userId>/<threadId>/
 *
 * - Each channel user gets their own isolated directory so files from
 *   different Telegram/Discord users never collide.
 * - When threadId is provided, each conversation thread gets its own
 *   subfolder for file isolation across topics.
 * - The directory is created lazily on first message and persists across
 *   sessions, so files survive `/new` (session archive).
 * - Falls back to `~/.neumar/channels/...` when the user hasn't configured
 *   a workspace in Settings.
 */
export function resolveChannelWorkDir(
  platform: string,
  userId: string,
  threadId?: string,
  configId?: string,
): string {
  const baseWorkDir = getSetting('workDir') || getAppDir();
  const safePlatform = platform.replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeUserId = userId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const segments = [baseWorkDir, 'channels', safePlatform];
  // Insert configId short prefix to isolate multiple bots on the same platform
  if (configId) {
    segments.push(configId.slice(0, 8));
  }
  segments.push(safeUserId);
  if (threadId) {
    // Sanitize threadId (Slack thread_ts is like "1712345678.123456")
    const safeThreadId = threadId.replace(/[^a-zA-Z0-9._-]/g, '_');
    segments.push(safeThreadId);
  }
  const dir = path.join(...segments);
  if (!createdDirs.has(dir)) {
    mkdirSync(dir, { recursive: true });
    createdDirs.add(dir);
  }
  return dir;
}
