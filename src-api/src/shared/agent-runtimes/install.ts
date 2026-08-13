// Allowlisted install/update option resolution + canonical command hashing.
// The browser sends only { method, confirmedCommandHash }; the server
// recomputes the hash from the registry option and rejects mismatches.
// Commands are spawned with shell:false — args are never interpolated.

import { createHash } from 'crypto';

import { AGENT_DEFS, getAgentDef } from './registry.js';
import type {
  AgentRuntimeDef,
  Platform,
  RuntimeInstallOption,
  RuntimeUpdateOption,
} from './types.js';

export type Intent = 'install' | 'update';

export function canonicalCommandString(
  option: RuntimeInstallOption | RuntimeUpdateOption,
): string {
  // Stable, unambiguous string used as the hash input. JSON serialization
  // of the structured option keeps args distinct from any whitespace in
  // the rendered shell preview.
  return JSON.stringify({
    id: option.id,
    command: option.command,
    args: option.args,
  });
}

export function commandHash(
  option: RuntimeInstallOption | RuntimeUpdateOption,
): string {
  return createHash('sha256')
    .update(canonicalCommandString(option))
    .digest('hex');
}

export function platformOptions(
  options: RuntimeInstallOption[] | RuntimeUpdateOption[] | undefined,
  platform: Platform = process.platform,
): Array<RuntimeInstallOption | RuntimeUpdateOption> {
  if (!options) return [];
  return options.filter((o) => o.platforms.includes(platform));
}

export function getOptions(
  def: AgentRuntimeDef,
  intent: Intent,
): Array<RuntimeInstallOption | RuntimeUpdateOption> {
  return intent === 'install' ? (def.install ?? []) : (def.update ?? []);
}

export function findOption(
  agentId: string,
  intent: Intent,
  optionId: string,
): {
  def: AgentRuntimeDef;
  option: RuntimeInstallOption | RuntimeUpdateOption;
} | null {
  const def = getAgentDef(agentId);
  if (!def) return null;
  const list = getOptions(def, intent);
  const option = list.find((o) => o.id === optionId);
  if (!option) return null;
  return { def, option };
}

// Public helper for the API layer to render structured options with their
// commandHash precomputed (the browser pins the hash before confirming).
export function describeOptions(
  agentId: string,
  intent: Intent,
  platform: Platform = process.platform,
) {
  const def = getAgentDef(agentId);
  if (!def) return null;
  const list = platformOptions(getOptions(def, intent), platform);
  return list.map((option) => ({
    ...option,
    commandHash: commandHash(option),
    rendered: renderShellPreview(option),
  }));
}

// Render a copy-pasteable shell preview for the confirm dialog. We do NOT
// pass this string to a shell — only spawn(option.command, option.args).
export function renderShellPreview(
  option: RuntimeInstallOption | RuntimeUpdateOption,
): string {
  const parts = [option.command, ...option.args];
  return parts.map(quoteIfNeeded).join(' ');
}

function quoteIfNeeded(s: string): string {
  if (s.length === 0) return "''";
  if (/^[A-Za-z0-9_./@:=+-]+$/.test(s)) return s;
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

// Catalog endpoint: every agent × every intent × current platform.
export function catalog(platform: Platform = process.platform) {
  return AGENT_DEFS.map((def) => ({
    id: def.id,
    install: platformOptions(def.install, platform).map((option) => ({
      ...option,
      commandHash: commandHash(option),
      rendered: renderShellPreview(option),
    })),
    update: platformOptions(def.update, platform).map((option) => ({
      ...option,
      commandHash: commandHash(option),
      rendered: renderShellPreview(option),
    })),
  }));
}
