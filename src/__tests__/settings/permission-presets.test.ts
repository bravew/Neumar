import { describe, expect, it } from 'vitest';

import {
  applyPermissionPreset,
  DEFAULT_TOOL_RULES,
  SUPPORTED_PERMISSION_PRESETS,
  visiblePermissionPreset,
  type ToolPermissionRules,
} from '@/shared/permissions/presets';

const rules: ToolPermissionRules = {
  alwaysAllow: ['Bash(git *)'],
  alwaysDeny: [],
  alwaysAsk: [],
  filesystem: [],
};

describe('permission presets', () => {
  it.each(SUPPORTED_PERMISSION_PRESETS)(
    'writes only planMode for $id',
    ({ id, planMode }) => {
      const settings = {
        planMode: 'on' as const,
        toolRules: rules,
      };
      const next = applyPermissionPreset(settings, id);
      expect(next.planMode).toBe(planMode);
      expect(next.toolRules).toBe(rules);
      expect(next.toolRules).toEqual(rules);
    },
  );

  it('reports custom for a hand-edited rule list without changing planMode', () => {
    expect(visiblePermissionPreset('on', rules)).toBe('custom');
    const settings = { planMode: 'on' as const, toolRules: rules };
    expect(applyPermissionPreset(settings, 'custom')).toBe(settings);
  });

  it('uses the picker id when rules still match the default list', () => {
    expect(visiblePermissionPreset('off', DEFAULT_TOOL_RULES)).toBe('ask');
    expect(visiblePermissionPreset('auto', DEFAULT_TOOL_RULES)).toBe('auto');
    expect(visiblePermissionPreset('on', DEFAULT_TOOL_RULES)).toBe('plan');
  });
});
