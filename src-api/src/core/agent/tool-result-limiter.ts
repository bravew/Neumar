/**
 * Tool Result Limiter (Display/DB side)
 *
 * Limits what gets stored in SQLite and streamed to the frontend via SSE.
 * The SDK already handles model-side truncation internally (50K per-tool,
 * 200K per-message), so this module only protects the frontend/DB from
 * oversized payloads that cause UI sluggishness.
 */

import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('ToolResultLimiter');

// ============================================================================
// Per-tool display limits (characters)
// ============================================================================

const MAX_DISPLAY_CHARS: Record<string, number> = {
  Bash: 50_000,
  Grep: 30_000,
  Glob: 20_000,
  Read: 100_000,
  WebFetch: 50_000,
  WebSearch: 30_000,
  default: 50_000,
};

// ============================================================================
// Public API
// ============================================================================

/**
 * Truncate a tool result for display/storage if it exceeds the per-tool limit.
 * Returns the (possibly truncated) result and whether truncation occurred.
 *
 * The SDK already persists full results to disk — no file I/O needed here.
 */
export function limitForDisplay(
  toolName: string,
  result: string,
): { result: string; truncated: boolean } {
  const limit =
    MAX_DISPLAY_CHARS[toolName] ?? MAX_DISPLAY_CHARS['default'] ?? 50_000;

  if (result.length <= limit) {
    return { result, truncated: false };
  }

  logger.debug(
    `Truncating ${toolName} result: ${result.length} → ${limit} chars`,
  );

  const truncated = result.slice(0, limit);
  return {
    result:
      truncated +
      '\n\n[Output truncated for display. Full output available in workspace.]',
    truncated: true,
  };
}
