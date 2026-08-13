/**
 * Auto-register media tool outputs as project assets.
 *
 * `mcp__media__media_generate_image`, `_generate_video`, and `_check_video`
 * write files to disk under the project's output dir and return the path
 * in the tool result text (e.g. `File: /abs/path/to/output/foo.png`). The
 * generic media MCP server has no concept of Video Mode project assets, so
 * without this hook the agent describes the file in chat but the Assets
 * panel never sees it.
 *
 * This post-tool-use hook:
 *   1. Matches media_generate_* and media_check_video tool calls.
 *   2. Pulls `File: /path` lines out of the tool result text.
 *   3. For each, calls addProjectAssetFromPath() which validates workspace
 *      containment, copies the file into the project's asset dir, and
 *      appends a MediaItem entry to project.assets[].
 *   4. Serializes via withProjectLock so a parallel video-edit mutation
 *      can't race the asset registration.
 *
 * Files outside the workspace are skipped (validateInputFile in
 * addProjectAssetFromPath throws). Re-running the hook for an already
 * registered path is safe: addProjectAssetFromPath copies to a fresh
 * allocation slot, so the worst case is a duplicate entry — bounded by
 * how many media tool calls run per turn.
 */

import path from 'node:path';

import type { ToolLifecycleHook } from '@/core/agent/tool-lifecycle-hooks';

import { getSessionContext } from '@/shared/services/session-context';
import { createLogger } from '@/shared/utils/logger';
import { withProjectLock } from '@/shared/video/project-lock';
import {
  addProjectAssetFromPath,
  getVideoAssetsDir,
  getVideoProjectDir,
  registerExistingProjectAsset,
} from '@/shared/video/store';

const MEDIA_EXT_RE =
  /\.(?:png|jpe?g|webp|gif|mp4|mov|webm|mp3|wav|m4a|flac|ogg)$/i;

/**
 * Per-session set of file paths we've already registered for the current
 * project, so a duplicate `media_check_video` poll (or a model that
 * repeats the same file across tool calls) doesn't double-register.
 * Scoped to the agent SDK's per-turn sessionId — resets naturally between
 * conversations.
 */
const ingestedPaths = new Map<string, Set<string>>();
function rememberIngested(scopeKey: string, filePath: string): boolean {
  let set = ingestedPaths.get(scopeKey);
  if (!set) {
    set = new Set();
    ingestedPaths.set(scopeKey, set);
  }
  if (set.has(filePath)) return false;
  set.add(filePath);
  // Cap retained scope keys to avoid unbounded memory growth across long-lived
  // sessions. 64 sessions × a few paths each is plenty for any realistic load.
  if (ingestedPaths.size > 64) {
    const oldest = ingestedPaths.keys().next().value;
    if (oldest) ingestedPaths.delete(oldest);
  }
  return true;
}

const logger = createLogger('VideoMediaAssetIngest');

// Match `File: /abs/path/to/foo.ext` lines emitted by the media MCP server.
// Captures only the path; the description / label text is ignored.
//
// Anchored loosely (no `^`/`$`) so this works regardless of how the SDK
// flattens the tool result — markdown formatting, surrounding backticks,
// table cells, or JSON-quoted strings all leave the substring
// `File: /something.ext` intact. The path component refuses whitespace,
// double quotes, and backticks so it stops cleanly at the end of the
// path even when the line continues with extra punctuation.
const FILE_LINE_RE = /File:\s+(\/[^\s"`]+\.[A-Za-z0-9]{2,5})/g;

// Fallback: any absolute path that ends in a media extension. We use this on
// tool results from non-media tools (skill outputs, Read confirmations, etc.)
// and rely on path-containment filtering inside the handler to drop anything
// not under the project dir.
const ANY_MEDIA_PATH_RE =
  /\/[^\s"`<>()]+\.(?:png|jpe?g|webp|gif|mp4|mov|webm|mp3|wav|m4a|flac|ogg)/gi;

export const videoMediaAssetIngestHook: ToolLifecycleHook = {
  event: 'post_tool_use',
  // Run on every tool result. The handler filters by path containment so
  // skills, ffmpeg, future MCP servers — anything that drops a media file
  // inside the project tree — gets surfaced without per-tool matcher edits.
  priority: 0,
  // Synchronous on purpose. Fire-and-forget (`async: true`) raced with the
  // SDK stream ending: when the model's text response finished before the
  // background hook wrote project.assets[], `streaming` flipped to false,
  // polling stopped, and the UI never saw the new asset. Awaiting the hook
  // costs only the file-stat + JSON-write inside registerExistingProjectAsset
  // (no copy in the in-place path) and guarantees project.json is current
  // before the model's "I generated the image" message reaches the client.
  async: false,
  handler: async ({ toolName, toolResult, sessionId }) => {
    const context = getSessionContext();
    const projectId = context?.videoProjectId;
    if (!projectId) return { action: 'allow' };

    const projectDirPrefix =
      path.resolve(getVideoProjectDir(projectId)) + path.sep;

    // Primary: `File: /abs` lines (media MCP). Fallback: any absolute media
    // path inside the project dir (canvas-design output, ffmpeg renders, etc.)
    const labelled = extractFilePaths(toolResult);
    const fallback = labelled.length === 0 ? extractMediaPaths(toolResult) : [];
    const candidates = [...new Set([...labelled, ...fallback])];
    const paths = candidates.filter((candidate) =>
      path.resolve(candidate).startsWith(projectDirPrefix),
    );

    if (paths.length === 0) {
      logger.info('video.asset.ingest_hook_fired', {
        toolName,
        hasProjectId: true,
        sessionId: context.sessionId ?? sessionId,
        labelledCount: labelled.length,
        fallbackCount: fallback.length,
        resultShape: describeToolResultShape(toolResult),
      });
      return { action: 'allow' };
    }

    const scopeKey = `${projectId}:${context.sessionId ?? sessionId ?? 'global'}`;
    await registerProjectMediaPaths(projectId, paths, scopeKey, toolName);
    return { action: 'allow' };
  },
};

/**
 * Register any project-contained media files referenced in a tool result as
 * project assets. Shared by the Claude lifecycle hook (above) and the loopback
 * MCP bridge (for subprocess runtimes like Codex, which have no lifecycle
 * hooks) so media ingestion is provider-agnostic. `scopeKey` dedupes repeated
 * references within one run. Takes the `projectId` explicitly rather than from
 * session context so it works on either path.
 */
export async function ingestProjectMediaFromResult(
  projectId: string,
  toolResult: unknown,
  scopeKey: string,
  toolName = 'bridge',
): Promise<void> {
  const projectDirPrefix =
    path.resolve(getVideoProjectDir(projectId)) + path.sep;
  const labelled = extractFilePaths(toolResult);
  const fallback = labelled.length === 0 ? extractMediaPaths(toolResult) : [];
  const paths = [...new Set([...labelled, ...fallback])].filter((candidate) =>
    path.resolve(candidate).startsWith(projectDirPrefix),
  );
  if (paths.length === 0) return;
  await registerProjectMediaPaths(projectId, paths, scopeKey, toolName);
}

async function registerProjectMediaPaths(
  projectId: string,
  paths: string[],
  scopeKey: string,
  toolName: string,
): Promise<void> {
  const assetsDirPrefix = path.resolve(getVideoAssetsDir(projectId)) + path.sep;
  const fresh = paths.filter((p) => rememberIngested(scopeKey, p));
  if (fresh.length === 0) return;

  try {
    await withProjectLock(projectId, async () => {
      for (const filePath of fresh) {
        try {
          // If the media MCP wrote directly into the project's assets dir
          // (the standard path in Video Mode — SessionContext.mediaOutputDir
          // points there), just register the existing file. Falling back to
          // addProjectAssetFromPath would copy it again under a fresh name,
          // leaving two near-identical entries.
          const inAssetsDir = path
            .resolve(filePath)
            .startsWith(assetsDirPrefix);
          if (inAssetsDir) {
            await registerExistingProjectAsset(projectId, filePath);
          } else {
            await addProjectAssetFromPath(projectId, filePath);
          }
          logger.info('video.asset.auto_registered', {
            projectId,
            toolName,
            path: filePath,
            mode: inAssetsDir ? 'in_place' : 'copied',
          });
        } catch (assetError) {
          // One file failure shouldn't block the others.
          logger.warn('video.asset.auto_register_failed', {
            projectId,
            toolName,
            path: filePath,
            error:
              assetError instanceof Error
                ? assetError.message
                : String(assetError),
          });
        }
      }
    });
  } catch (lockError) {
    logger.warn('video.asset.ingest_lock_failed', {
      projectId,
      toolName,
      error: lockError instanceof Error ? lockError.message : String(lockError),
    });
  }
}

export function extractFilePaths(toolResult: unknown): string[] {
  const text = textFromToolResult(toolResult);
  if (!text) return [];
  const matches = new Set<string>();
  for (const match of text.matchAll(FILE_LINE_RE)) {
    if (match[1]) matches.add(match[1]);
  }
  return [...matches];
}

export function extractMediaPaths(toolResult: unknown): string[] {
  const text = textFromToolResult(toolResult);
  if (!text) return [];
  const matches = new Set<string>();
  for (const match of text.matchAll(ANY_MEDIA_PATH_RE)) {
    if (MEDIA_EXT_RE.test(match[0])) matches.add(match[0]);
  }
  return [...matches];
}

/**
 * Pull all text out of whatever shape the SDK / PTC / MCP layer hands us.
 * Handles:
 *   - a raw string
 *   - an array of content blocks      (some SDK paths pass tool_response
 *                                       as the bare content array)
 *   - an object with `content: ContentBlock[]`  (MCP standard)
 *   - an object with a top-level `text` field
 *   - any other JSON shape — falls back to JSON.stringify so a substring
 *     match still works even if the wrapper changed underneath us.
 * Empty paths can't be parsed; the regex over the resulting string is the
 * single source of truth for what counts as a file reference.
 */
function textFromToolResult(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return collectTextBlocks(value);
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.content)) {
      return collectTextBlocks(record.content as unknown[]);
    }
    if (typeof record.text === 'string') return record.text;
    // Unknown shape — stringify so the regex still has a chance to find
    // `File:` anywhere in the payload. JSON-escaped quotes around the
    // path don't break the path regex because we exclude `"` from the
    // captured path.
    try {
      return JSON.stringify(value);
    } catch {
      return '';
    }
  }
  return String(value);
}

function describeToolResultShape(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `array[${value.length}]`;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).slice(0, 8).join(',');
    return `object{${keys}}`;
  }
  return typeof value;
}

function collectTextBlocks(blocks: unknown[]): string {
  const chunks: string[] = [];
  for (const block of blocks) {
    if (typeof block === 'string') {
      chunks.push(block);
      continue;
    }
    if (!block || typeof block !== 'object') continue;
    const text = (block as { text?: unknown }).text;
    if (typeof text === 'string') chunks.push(text);
  }
  return chunks.join('\n');
}
