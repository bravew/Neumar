/**
 * Canonical local-CLI runtime identity.
 *
 * One runtime id per local CLI, matching `/agent-runtimes` detection ids and
 * agent plugin `metadata.type`. Request schemas validate against this module
 * instead of hand-maintained enums so new adapters cannot drift from the
 * accepted `modelConfig.agentType` values.
 */

import type { AgentProvider } from './types';

/**
 * Every `modelConfig.agentType` value accepted at the API boundary.
 * Local CLI runtimes must have a registered agent plugin of the same id.
 */
export const AGENT_TYPE_IDS = [
  'claude',
  'codex',
  'open-agent-sdk',
  'openai-compat',
  'gemini',
  'gemini-local',
  'opencode-local',
  'cursor-agent',
  'qwen',
  'copilot',
  'kimi',
  'atomcode',
  'custom',
] as const satisfies readonly (AgentProvider | 'custom')[];

export type AgentTypeId = (typeof AGENT_TYPE_IDS)[number];

/**
 * Stale persisted/runtime ids from older clients mapped to canonical ids.
 * `cursor-local` was the pre-2026-07 Cursor IDE adapter id; the runtime is
 * now the `cursor-agent` CLI.
 */
export const LEGACY_AGENT_TYPE_ALIASES: Readonly<Record<string, AgentTypeId>> =
  {
    'cursor-local': 'cursor-agent',
  };

/** Map a possibly-stale agent type to its canonical id (identity when current). */
export function normalizeAgentType(agentType: string): string {
  return LEGACY_AGENT_TYPE_ALIASES[agentType] ?? agentType;
}

/**
 * Runtime model ids arrive from the picker as `<runtimeId>:<model>` (the
 * established `codex:<model>` contract). Strip the prefix for the runtime
 * that owns it; leave foreign or unprefixed ids untouched.
 */
export function stripRuntimeModelPrefix(
  runtimeId: string,
  model: string | undefined,
): string | undefined {
  if (!model) return model;
  const prefix = `${runtimeId}:`;
  if (model.startsWith(prefix)) return model.slice(prefix.length) || undefined;
  return model;
}
