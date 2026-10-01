export type FirstRunDestination =
  | { kind: 'app' }
  | { kind: 'onboarding'; step: 'welcome' | 'install' | 'idea' };

export interface FirstRunState {
  cliInstalled: boolean;
  onboardingCompleted: boolean;
  onboardingVersionMatches: boolean;
  quickstartCompleted: boolean;
}

/** Where a simple-shell user should land. Fully onboarded users stay in the app. */
export function resolveFirstRun(state: FirstRunState): FirstRunDestination {
  const onboarded = state.onboardingCompleted && state.onboardingVersionMatches;
  if (onboarded && state.quickstartCompleted) return { kind: 'app' };
  if (onboarded && !state.quickstartCompleted) {
    return { kind: 'onboarding', step: 'idea' };
  }
  if (!state.cliInstalled) return { kind: 'onboarding', step: 'install' };
  return { kind: 'onboarding', step: 'welcome' };
}

/** Screens before Home when the CLIs are already installed. */
export function installedFirstRunScreens(): readonly string[] {
  return ['welcome', 'connect', 'idea', 'home'];
}
