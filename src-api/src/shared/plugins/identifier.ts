/**
 * Plugin / skill identifier parser
 *
 * Canonical form: `pluginName:skillName`.
 * Bare `skillName` is allowed for legacy / single-skill installs (no plugin
 * namespace). The CLI also emits `plugin_<name>_<tool>` for MCP tools loaded
 * via `--plugin-dir` — see anthropics/claude-code#29360 — which we accept
 * as a valid input shape.
 *
 * `parsePluginIdentifier` returns null only when the input is malformed
 * enough that we cannot guess intent. Callers should treat null as a
 * user-facing error.
 */

import { PLUGIN_NAME_RE } from './manifest';

export interface ParsedIdentifier {
  /** Plugin namespace; `null` for legacy bare skills. */
  plugin: string | null;
  /** Bare skill name without the namespace prefix. */
  skill: string;
}

/**
 * Skill names live in the same alphabet as plugin names (and can include
 * dots for sub-skills, which the Claude CLI emits for nested skills).
 */
const SKILL_NAME_RE = /^[a-z0-9][a-z0-9._-]{0,127}$/;

/** `plugin_<plugin>_<tool>` — workaround for the --plugin-dir bug. */
const CLI_MCP_RE = /^plugin_([a-z0-9-]+)_([a-z0-9._-]+)$/;

/**
 * Parse an identifier in any of the three accepted shapes.
 * Returns `null` on malformed input.
 */
export function parsePluginIdentifier(id: string): ParsedIdentifier | null {
  if (typeof id !== 'string') return null;
  const trimmed = id.trim();
  if (!trimmed) return null;

  // 1. CLI MCP form: plugin_<name>_<tool>
  const cliMatch = CLI_MCP_RE.exec(trimmed);
  if (cliMatch) {
    const plugin = cliMatch[1]!;
    const skill = cliMatch[2]!;
    if (!PLUGIN_NAME_RE.test(plugin) || !SKILL_NAME_RE.test(skill)) return null;
    return { plugin, skill };
  }

  // 2. Canonical form: <plugin>:<skill>
  const colonIdx = trimmed.indexOf(':');
  if (colonIdx > 0) {
    const plugin = trimmed.slice(0, colonIdx);
    const skill = trimmed.slice(colonIdx + 1);
    if (!PLUGIN_NAME_RE.test(plugin) || !SKILL_NAME_RE.test(skill)) return null;
    return { plugin, skill };
  }

  // 3. Bare skill (legacy)
  if (SKILL_NAME_RE.test(trimmed)) {
    return { plugin: null, skill: trimmed };
  }

  return null;
}

/** Format a `{plugin, skill}` pair back into the canonical `plugin:skill`. */
export function formatIdentifier(plugin: string | null, skill: string): string {
  return plugin ? `${plugin}:${skill}` : skill;
}

/**
 * Returns true when this identifier targets the Anthropic-curated public
 * marketplace. Currently a stub against a known-good list, lifted from
 * `anthropics/claude-plugins-official`.
 */
export function isOfficialMarketplaceName(plugin: string): boolean {
  return OFFICIAL_PLUGIN_NAMES.has(plugin);
}

const OFFICIAL_PLUGIN_NAMES: ReadonlySet<string> = new Set([
  // Keep in sync with marketplace.json from anthropics/claude-plugins-official.
  // Empty by default — populated by the marketplace fetch + cache layer.
]);
