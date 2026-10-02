import { describe, expect, it } from 'vitest';

import {
  installedFirstRunScreens,
  resolveFirstRun,
} from '@/components/onboarding/first-run-route';

const fresh = {
  cliInstalled: true,
  onboardingCompleted: false,
  onboardingVersionMatches: false,
  quickstartCompleted: false,
};

describe('resolveFirstRun', () => {
  it('starts a fresh profile at welcome', () => {
    expect(resolveFirstRun(fresh)).toEqual({
      kind: 'onboarding',
      step: 'welcome',
    });
    expect(installedFirstRunScreens().length).toBeLessThanOrEqual(4);
  });

  it('shows install when a CLI is missing', () => {
    expect(resolveFirstRun({ ...fresh, cliInstalled: false })).toEqual({
      kind: 'onboarding',
      step: 'install',
    });
  });

  it('resumes a mid-quickstart user at the first idea', () => {
    expect(
      resolveFirstRun({
        cliInstalled: true,
        onboardingCompleted: true,
        onboardingVersionMatches: true,
        quickstartCompleted: false,
      }),
    ).toEqual({ kind: 'onboarding', step: 'idea' });
  });

  it('never re-onboards a finished user', () => {
    expect(
      resolveFirstRun({
        cliInstalled: true,
        onboardingCompleted: true,
        onboardingVersionMatches: true,
        quickstartCompleted: true,
      }),
    ).toEqual({ kind: 'app' });
  });
});
