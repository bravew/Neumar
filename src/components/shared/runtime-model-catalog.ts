/**
 * Unified model catalog: provider-backed models (settings) merged with
 * runtime-backed models (`/agent-runtimes` detection), gated per mode.
 *
 * One catalog feeds Task, Design, Video, and Settings pickers so runtime
 * rows cannot drift between surfaces. Runtime-backed options use structured
 * `<runtimeId>:<modelId>` ids (see `@/shared/lib/runtime-model-ids`).
 */

import type { AIProvider } from '@/shared/db/settings';
import type {
  AgentRuntimeStatus,
  ModelOption as RuntimeModelOption,
} from '@/shared/lib/api/agent-runtimes';
import {
  formatRuntimeModelId,
  PREFIXED_RUNTIME_IDS,
  type PrefixedRuntimeId,
  type RuntimeMode,
} from '@/shared/lib/runtime-model-ids';

import { buildModelOptions, type ModelOption } from './ChatInput.types';

/**
 * A runtime row is runnable when the binary is detected and it is not
 * known-unauthenticated. `unknown` auth (no probe) passes — the run itself
 * surfaces auth errors as visible run failures.
 */
export function isRuntimeRunnable(runtime: AgentRuntimeStatus): boolean {
  return runtime.available && runtime.auth?.state !== 'unauthenticated';
}

/** Row-disable texts, resolved from locale strings by the caller. */
export interface RuntimeDisableLabels {
  signInRequired: string;
  unavailableInMode: string;
  unavailableModel: string;
}

const DEFAULT_DISABLE_LABELS: RuntimeDisableLabels = {
  signInRequired: 'Sign-in required — log in via the CLI, then rescan',
  unavailableInMode: 'Not available in this mode yet',
  unavailableModel: 'Model unavailable',
};

/** Convert one detected runtime model into a picker option. */
export function runtimeModelToModelOption(
  runtime: AgentRuntimeStatus,
  model: RuntimeModelOption,
  disabledReason?: string,
  unavailableLabel = DEFAULT_DISABLE_LABELS.unavailableModel,
): ModelOption {
  const modelDisabledReason =
    model.availability === 'unavailable'
      ? (model.unavailableReason ?? unavailableLabel)
      : disabledReason;
  return {
    id: formatRuntimeModelId(runtime.id as PrefixedRuntimeId, model.id),
    label: model.label,
    description: runtime.name,
    provider: runtime.id as ModelOption['provider'],
    source: model.source,
    availability: model.availability,
    unavailableReason: model.unavailableReason,
    contextWindowTokens: model.contextWindowTokens,
    capabilityTags: model.capabilityTags,
    costTier: model.costTier,
    speedTier: model.speedTier,
    compatibleReasoningTiers: model.compatibleReasoningTiers,
    compatibleServiceTiers: model.compatibleServiceTiers,
    ...(modelDisabledReason
      ? { disabled: true, disabledReason: modelDisabledReason }
      : {}),
  };
}

function runtimeModelToProviderOption(
  runtime: AgentRuntimeStatus,
  model: RuntimeModelOption,
  unavailableLabel: string,
): ModelOption {
  return {
    ...runtimeModelToModelOption(runtime, model, undefined, unavailableLabel),
    id: runtime.id === 'codex' ? `codex:${model.id}` : model.id,
    provider: runtime.id as ModelOption['provider'],
  };
}

export function resolveProviderModeSupport(
  providerId: string,
  mode: RuntimeMode,
  runtimes: readonly AgentRuntimeStatus[],
): 'supported' | 'experimental' | 'unsupported' {
  const runtime = runtimes.find((candidate) => candidate.id === providerId);
  if (runtime) return runtime.capabilities.modes?.[mode] ?? 'unsupported';
  return mode === 'video' ? 'unsupported' : 'supported';
}

/**
 * Runtime-backed options for the promoted local CLI runtimes (Cursor Agent,
 * Qwen Code, GitHub Copilot CLI), scoped to a mode. Claude and Codex stay on
 * the provider-backed path (`buildModelOptions`) — they are the
 * compatibility baseline and already carry curated model lists.
 *
 * Installed runtimes that are blocked (sign-in required, or no capability
 * for this mode) stay visible as disabled rows with a concise reason —
 * hiding them reads as "the app doesn't support this CLI".
 */
export function buildRuntimeModelOptions(
  runtimes: readonly AgentRuntimeStatus[],
  mode: RuntimeMode,
  labels: RuntimeDisableLabels = DEFAULT_DISABLE_LABELS,
): ModelOption[] {
  const options: ModelOption[] = [];
  // Defensive: consumers may hand over an unvalidated (mocked) payload.
  const detected = Array.isArray(runtimes) ? runtimes : [];
  for (const runtimeId of PREFIXED_RUNTIME_IDS) {
    const runtime = detected.find((r) => r.id === runtimeId);
    if (!runtime || !runtime.available) continue;
    const modeSupport = resolveProviderModeSupport(runtimeId, mode, detected);
    const disabledReason =
      modeSupport === 'unsupported'
        ? labels.unavailableInMode
        : !isRuntimeRunnable(runtime)
          ? labels.signInRequired
          : undefined;
    // `models` is defensive-optional: mocked or older backends may omit it.
    for (const model of runtime.models ?? []) {
      options.push(
        runtimeModelToModelOption(
          runtime,
          model,
          disabledReason,
          labels.unavailableModel,
        ),
      );
    }
  }
  return options;
}

export interface AgentModelGroup {
  provider: string;
  label: string;
  options: ModelOption[];
}

export function modelMetadataLabel(model: ModelOption): string {
  const parts: string[] = [];
  if (model.contextWindowTokens) {
    const millions = model.contextWindowTokens / 1_000_000;
    parts.push(
      Number.isInteger(millions)
        ? `${millions}M`
        : `${Math.round(model.contextWindowTokens / 1_000)}K`,
    );
  }
  if (model.capabilityTags?.length) parts.push(model.capabilityTags.join(', '));
  return parts.join(' · ');
}

/** Agent-first group order; anything else lands in the trailing group. */
export const AGENT_GROUP_ORDER: readonly string[] = [
  'claude',
  'codex',
  ...PREFIXED_RUNTIME_IDS,
];

/**
 * Group picker options by agent: Claude, Codex, each local CLI runtime
 * (labelled by its brand name from the catalog), then other API providers.
 * Shared by the composer selector and the settings ModelPicker so the two
 * surfaces cannot drift.
 */
export function groupModelOptionsByAgent(
  modelOptions: readonly ModelOption[],
  labels: { claude: string; codex: string; other: string },
): AgentModelGroup[] {
  const groups: AgentModelGroup[] = [];
  for (const provider of AGENT_GROUP_ORDER) {
    const options = modelOptions.filter((m) => m.provider === provider);
    if (options.length === 0) continue;
    const label =
      provider === 'claude'
        ? labels.claude
        : provider === 'codex'
          ? labels.codex
          : // Local CLI runtimes: brand proper noun from the catalog
            options[0].description || provider;
    groups.push({ provider, label, options });
  }
  const other = modelOptions.filter(
    (m) => !AGENT_GROUP_ORDER.includes(m.provider),
  );
  if (other.length > 0) {
    groups.push({ provider: 'other', label: labels.other, options: other });
  }
  return groups;
}

/**
 * Full mode-scoped catalog: provider-backed options filtered by the mode
 * capability gate, then runtime-backed options for runnable local CLIs.
 */
export function buildModeModelOptions(
  s: Record<string, unknown>,
  providers: AIProvider[] | undefined,
  runtimes: readonly AgentRuntimeStatus[],
  mode: RuntimeMode,
): ModelOption[] {
  const labels: RuntimeDisableLabels = {
    signInRequired:
      typeof s.modelPickerRuntimeSignInRequired === 'string'
        ? s.modelPickerRuntimeSignInRequired
        : DEFAULT_DISABLE_LABELS.signInRequired,
    unavailableInMode:
      typeof s.modelPickerRuntimeUnavailableInMode === 'string'
        ? s.modelPickerRuntimeUnavailableInMode
        : DEFAULT_DISABLE_LABELS.unavailableInMode,
    unavailableModel:
      typeof s.modelPickerModelUnavailable === 'string'
        ? s.modelPickerModelUnavailable
        : DEFAULT_DISABLE_LABELS.unavailableModel,
  };
  let providerOptions = buildModelOptions(s, providers).filter(
    (option) =>
      resolveProviderModeSupport(option.provider, mode, runtimes) !==
      'unsupported',
  );
  for (const providerId of ['claude', 'codex'] as const) {
    const runtime = runtimes.find(
      (candidate) => candidate.id === providerId && candidate.available,
    );
    if (
      !runtime ||
      !providerOptions.some((option) => option.provider === providerId)
    ) {
      continue;
    }
    // Only a real probe result supersedes the curated catalog. A runtime that
    // only reports its static `fallback` list carries raw ids and aliases with
    // no pricing/description, so the curated provider rows stay authoritative.
    const discovered = (runtime.models ?? [])
      .filter(
        (model) => model.id !== 'default' && model.source === 'discovered',
      )
      .map((model) =>
        runtimeModelToProviderOption(runtime, model, labels.unavailableModel),
      );
    if (discovered.length === 0) continue;
    const firstIndex = providerOptions.findIndex(
      (option) => option.provider === providerId,
    );
    providerOptions = providerOptions.filter(
      (option) => option.provider !== providerId,
    );
    providerOptions.splice(firstIndex, 0, ...discovered);
  }
  return [
    ...providerOptions,
    ...buildRuntimeModelOptions(runtimes, mode, labels),
  ];
}
