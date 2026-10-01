import { MemoryRouter } from 'react-router-dom';

import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearDependencyCache,
  clearOnboardingCache,
  clearQuickstartCache,
  SetupGuard,
} from '@/components/setup-guard';

vi.mock('@/shared/db/settings', () => ({
  getSettingItem: async () => null,
  ONBOARDING_VERSION: '1',
  useSettingsValue: () => ({ ui: { simpleShell: false } }),
}));

vi.mock('@/shared/providers/language-provider', () => ({
  useLanguage: () => ({ t: { setup: { checkingEnvironment: 'Checking' } } }),
}));

vi.mock('@/app/pages/Onboarding', () => ({
  OnboardingPage: () => <p>onboarding</p>,
}));

vi.mock('@/app/pages/Setup', () => ({
  SetupPage: () => <p>setup</p>,
}));

describe('SetupGuard first run', () => {
  beforeEach(() => {
    clearDependencyCache();
    clearOnboardingCache();
    clearQuickstartCache();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ success: true, claudeCode: true })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows onboarding in a full-window layer over the shell', async () => {
    render(
      <MemoryRouter>
        <SetupGuard>
          <p>app</p>
        </SetupGuard>
      </MemoryRouter>,
    );

    const page = await screen.findByText('onboarding');
    const layer = screen.getByTestId('first-run-layer');
    expect(layer).toContainElement(page);
    expect(layer).toHaveClass('fixed', 'inset-0');
    expect(screen.queryByText('app')).not.toBeInTheDocument();
  });
});
