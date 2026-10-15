import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OnboardingFlow } from '@/components/onboarding/OnboardingFlow';
import { APP_SLUG } from '@/config/branding';
import {
  clearAllSettings,
  defaultSettings,
  saveSettings,
  type Settings,
} from '@/shared/db/settings';

import { renderWithProviders } from '../helpers/render-with-providers';

vi.mock('@/components/setup-guard', () => ({
  markOnboardingDone: vi.fn(),
  markQuickstartDone: vi.fn(),
}));

/** Every plan mode written through `saveSettings`, oldest first. */
const writtenPlanModes: Array<Settings['planMode'] | undefined> = [];

function stubStorage() {
  const values = new Map<string, string>();
  writtenPlanModes.length = 0;
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
      if (key === `${APP_SLUG}_settings`) {
        writtenPlanModes.push(
          (JSON.parse(value) as Partial<Settings>).planMode,
        );
      }
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
    clear: () => values.clear(),
  });
}

/**
 * A profile the user already finished setup with, plus the plan mode they
 * chose in the composer picker, Settings, or plan approval.
 */
function profileWith(planMode: Settings['planMode']): Settings {
  return { ...defaultSettings, planMode };
}

/**
 * Finish the wizard the way the Data settings rerun does: the flow opens on
 * its last step and completion runs from there.
 */
async function completeFlow() {
  const user = userEvent.setup();
  renderWithProviders(<OnboardingFlow />, {
    initialEntries: ['/onboarding?step=idea'],
  });
  await user.click(screen.getByRole('button', { name: 'Get Started' }));
}

describe('OnboardingFlow plan mode', () => {
  beforeEach(() => {
    stubStorage();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ success: true })),
    );
  });

  it.each(['on', 'off', 'auto'] as const)(
    'keeps the stored %s when a setup rerun completes',
    async (planMode) => {
      saveSettings(profileWith(planMode));
      const writesBefore = writtenPlanModes.length;

      await completeFlow();

      expect(writtenPlanModes.length).toBeGreaterThan(writesBefore);
      expect(writtenPlanModes.at(-1)).toBe(planMode);
    },
  );

  it('defaults to on when no profile was ever stored', async () => {
    // A fresh install: no settings key and no cached settings, so the flow
    // reads the defaults.
    await clearAllSettings();

    await completeFlow();

    // The write carries the fresh-install default, from the same source.
    expect(defaultSettings.planMode).toBe('on');
    expect(writtenPlanModes.at(-1)).toBe(defaultSettings.planMode);
  });
});
