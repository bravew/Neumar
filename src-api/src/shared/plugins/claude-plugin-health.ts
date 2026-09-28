/**
 * Claude Code plugin load health, as reported by the Claude Agent SDK's
 * `system/init.plugin_errors` (SDK 0.3.283). In-memory: it reflects the most
 * recent session start in this process, which is what the settings page
 * shows as current health.
 */

export interface ClaudePluginError {
  plugin: string;
  type: string;
  message: string;
}

export interface ClaudePluginHealth {
  /** Unix ms of the last `system/init` that reported plugin state; null if none yet. */
  checkedAt: number | null;
  errors: ClaudePluginError[];
}

let health: ClaudePluginHealth = { checkedAt: null, errors: [] };

export function recordClaudePluginErrors(errors: ClaudePluginError[]): void {
  health = { checkedAt: Date.now(), errors: errors.map((e) => ({ ...e })) };
}

export function getClaudePluginHealth(): ClaudePluginHealth {
  return { checkedAt: health.checkedAt, errors: [...health.errors] };
}
