import type { Settings } from '@/shared/db/settings';

/** Same three ids `ComposerPermissionPicker` can write. */
export const SUPPORTED_PERMISSION_PRESETS = [
  { id: 'plan', planMode: 'on' },
  { id: 'ask', planMode: 'off' },
  { id: 'auto', planMode: 'auto' },
] as const;

export type SupportedPermissionPresetId =
  (typeof SUPPORTED_PERMISSION_PRESETS)[number]['id'];

export type PermissionPresetId = SupportedPermissionPresetId | 'custom';

export interface ToolPermissionRules {
  alwaysAllow: string[];
  alwaysDeny: string[];
  alwaysAsk: string[];
  filesystem?: unknown[];
}

/** Built-in tools that are safe to auto-allow. Matches PermissionSettings. */
export const DEFAULT_TOOL_RULES: ToolPermissionRules = {
  alwaysAllow: [
    'Read',
    'Glob',
    'Grep',
    'LSP',
    'Skill',
    'Edit',
    'Write',
    'TodoWrite',
    'WebFetch',
    'WebSearch',
  ],
  alwaysDeny: [],
  alwaysAsk: [],
  filesystem: [],
};

export function planModeForPreset(
  id: SupportedPermissionPresetId,
): Settings['planMode'] {
  const match = SUPPORTED_PERMISSION_PRESETS.find((preset) => preset.id === id);
  if (!match) return 'on';
  return match.planMode;
}

export function presetIdFromPlanMode(
  planMode: Settings['planMode'] | undefined,
): SupportedPermissionPresetId {
  if (planMode === 'off') return 'ask';
  if (planMode === 'auto') return 'auto';
  return 'plan';
}

function sameEntries(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const a = [...left].sort();
  const b = [...right].sort();
  return a.every((entry, index) => entry === b[index]);
}

export function isHandEditedRules(
  rules: ToolPermissionRules,
  baseline: ToolPermissionRules = DEFAULT_TOOL_RULES,
): boolean {
  return (
    !sameEntries(rules.alwaysAllow, baseline.alwaysAllow) ||
    !sameEntries(rules.alwaysDeny, baseline.alwaysDeny) ||
    !sameEntries(rules.alwaysAsk, baseline.alwaysAsk) ||
    (rules.filesystem?.length ?? 0) !== (baseline.filesystem?.length ?? 0)
  );
}

/** Custom when tool rules were edited. Otherwise the picker id for planMode. */
export function visiblePermissionPreset(
  planMode: Settings['planMode'] | undefined,
  rules: ToolPermissionRules,
): PermissionPresetId {
  if (isHandEditedRules(rules)) return 'custom';
  return presetIdFromPlanMode(planMode);
}

/**
 * Writes only `planMode`. Tool rules are left untouched.
 * Selecting custom is a no-op.
 */
export function applyPermissionPreset<
  T extends { planMode?: Settings['planMode'] },
>(settings: T, id: PermissionPresetId): T {
  if (id === 'custom') return settings;
  return { ...settings, planMode: planModeForPreset(id) };
}
