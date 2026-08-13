import { afterEach, describe, expect, it } from 'vitest';

import {
  isOnDemandClarificationEnabled,
  isSupplementalSkillSelectionEnabled,
} from '@/shared/rollout/multi-mode-reliability';

afterEach(() => {
  delete process.env.NEUMA_ON_DEMAND_CLARIFICATION_ENABLED;
  delete process.env.NEUMA_SUPPLEMENTAL_SKILLS_ENABLED;
});

describe('multi-mode reliability rollout flags', () => {
  it('defaults both compatibility features on', () => {
    expect(isOnDemandClarificationEnabled()).toBe(true);
    expect(isSupplementalSkillSelectionEnabled()).toBe(true);
  });

  it.each(['0', 'false', 'off'])(
    'disables on-demand clarification with %s',
    (value) => {
      process.env.NEUMA_ON_DEMAND_CLARIFICATION_ENABLED = value;
      expect(isOnDemandClarificationEnabled()).toBe(false);
      expect(isSupplementalSkillSelectionEnabled()).toBe(true);
    },
  );

  it('disables supplemental skills independently', () => {
    process.env.NEUMA_SUPPLEMENTAL_SKILLS_ENABLED = 'false';
    expect(isSupplementalSkillSelectionEnabled()).toBe(false);
    expect(isOnDemandClarificationEnabled()).toBe(true);
  });
});
