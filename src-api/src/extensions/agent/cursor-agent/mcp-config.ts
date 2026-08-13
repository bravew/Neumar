/**
 * Per-run workspace MCP wiring for the Cursor Agent CLI.
 *
 * Cursor reads MCP servers from `<workspace>/.cursor/mcp.json`. The loopback
 * subprocess bridge exposes Neuma's in-process MCP servers as streamable-HTTP
 * endpoints (`/mcp/bridge/inproc/<name>`) guarded by per-run bearer tokens —
 * this module renders those endpoints into Cursor's config format for the
 * duration of one run, then restores whatever was there before.
 *
 * Tokens are per-run and revoked by the caller in its `finally`; the config
 * file lives inside the run's own workspace (same trust domain) and is
 * removed/restored on cleanup.
 */

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { SubprocessMcpConfig } from '@/shared/mcp/subprocess-bridge';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('CursorAgentMcp');

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Write bridge servers into `<cwd>/.cursor/mcp.json`, merging with any
 * user-owned entries already present. Returns an async cleanup that restores
 * the previous file content (or removes the file when we created it).
 */
export async function writeCursorWorkspaceMcpConfig(
  cwd: string,
  bridge: SubprocessMcpConfig,
): Promise<() => Promise<void>> {
  const mcpPath = join(cwd, '.cursor', 'mcp.json');

  let originalText: string | null = null;
  try {
    originalText = await readFile(mcpPath, 'utf8');
  } catch {
    originalText = null;
  }

  let existingConfig: Record<string, unknown> = {};
  let existingServers: Record<string, unknown> = {};
  if (originalText) {
    try {
      const parsed: unknown = JSON.parse(originalText);
      if (isRecord(parsed)) {
        existingConfig = parsed;
        if (isRecord(parsed.mcpServers)) {
          existingServers = parsed.mcpServers;
        }
      }
    } catch {
      // Unparseable user file — keep its text for restore, start fresh.
    }
  }

  const bridgedServers: Record<string, unknown> = {};
  for (const [name, entry] of Object.entries(
    bridge.codexConfig.mcp_servers ?? {},
  )) {
    const token = bridge.env[entry.bearer_token_env_var];
    bridgedServers[name] = {
      url: entry.url,
      ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
    };
  }

  await mkdir(dirname(mcpPath), { recursive: true });
  await writeFile(
    mcpPath,
    `${JSON.stringify(
      {
        ...existingConfig,
        mcpServers: { ...existingServers, ...bridgedServers },
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  return async () => {
    try {
      if (originalText !== null) {
        await writeFile(mcpPath, originalText, 'utf8');
      } else {
        await rm(mcpPath, { force: true });
      }
    } catch (err) {
      logger.warn('Failed to restore workspace .cursor/mcp.json', {
        error: String(err),
      });
    }
  };
}
