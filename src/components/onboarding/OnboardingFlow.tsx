import { useMemo, useState } from 'react';

import { useNavigate, useSearchParams } from 'react-router-dom';

import { SetupPage } from '@/app/pages/Setup';
import {
  markOnboardingDone,
  markQuickstartDone,
} from '@/components/setup-guard';
import { APP_NAME } from '@/config/branding';
import { markFirstRunCompleted, seedDemoIfNeeded } from '@/shared/db/first-run';
import {
  getSettingItem,
  getSettings,
  ONBOARDING_VERSION,
  saveSettingItem,
  saveSettings,
  syncSettingsWithBackend,
  useSettingsValue,
  type Settings,
} from '@/shared/db/settings';
import { ideaLabel, ideaPrompt } from '@/shared/ideas/idea-text';
import { requestComposerPrefill } from '@/shared/ideas/prefill';
import { listIdeas } from '@/shared/ideas/registry';
import { visibleIdeas } from '@/shared/ideas/types';
import { useLanguage } from '@/shared/providers/language-provider';

import { createDefaultProfile } from './default-profile';
import { ProviderStep } from './ProviderStep';

const BASE_STEPS = ['welcome', 'connect', 'idea'] as const;

export function OnboardingFlow() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const start = params.get('step');
  const steps = useMemo<readonly string[]>(
    () => (start === 'install' ? ['install', ...BASE_STEPS] : [...BASE_STEPS]),
    [start],
  );
  const initial = start === 'idea' ? 'idea' : steps[0];
  const [step, setStep] = useState<string>(initial);
  // Provider edits stay local until the user moves on, like the old flow's
  // debounced save, so typing a key does not write settings per keystroke.
  const [draft, setDraft] = useState<Settings>(() => getSettings());
  const feedback = useSettingsValue().ui.ideasFeedback;
  const idea = visibleIdeas(listIdeas(), feedback)[0];

  const finish = async () => {
    saveSettings({ ...draft, planMode: 'on' });
    await Promise.all([
      syncSettingsWithBackend(),
      saveSettingItem('onboardingCompleted', 'true'),
      saveSettingItem('onboardingVersion', ONBOARDING_VERSION),
    ]).catch(() => undefined);
    markOnboardingDone();
    try {
      // Same ending as QuickStart's skip path: a default profile, then the
      // first-run markers. A rerun from Data settings keeps the profile it has.
      if (!(await getSettingItem('activeProfileId'))) {
        const profileId = await createDefaultProfile(
          t.profiles.quickstartDefaultName,
        );
        await saveSettingItem('activeProfileId', profileId);
      }
      await saveSettingItem('quickstart_step', 'completed');
      markQuickstartDone();
      await markFirstRunCompleted();
      await seedDemoIfNeeded();
    } catch (error) {
      // Completion still returns the user home.
      if (import.meta.env.DEV) console.warn('[Onboarding] finish:', error);
    }
    const prompt = idea ? ideaPrompt(t.ideas, idea) : '';
    if (prompt) requestComposerPrefill(prompt);
    navigate('/', { replace: true });
  };

  const index = steps.indexOf(step);
  const next = () => {
    if (step === 'connect') saveSettings(draft);
    const following = steps[index + 1];
    if (!following) {
      void finish();
      return;
    }
    setStep(following);
  };

  // The install step reuses the Setup page: it checks the CLIs, shows install
  // commands, and calls back on Continue or Skip.
  if (step === 'install') return <SetupPage onSkip={next} />;

  return (
    <main
      data-testid="onboarding-flow"
      className="mx-auto flex min-h-svh max-w-lg flex-col justify-center gap-4 px-6"
    >
      <p className="text-muted-foreground text-xs">
        {t.onboarding.stepOf
          .replace('{current}', String(index + 1))
          .replace('{total}', String(steps.length))}
      </p>
      {step === 'welcome' ? (
        <h1 className="text-2xl font-semibold">
          {t.onboarding.welcomeTitle.replace('{appName}', APP_NAME)}
        </h1>
      ) : null}
      {step === 'connect' ? (
        <ProviderStep settings={draft} onSettingsChange={setDraft} />
      ) : null}
      {step === 'idea' ? (
        <div>
          <h1 className="text-2xl font-semibold">{t.ideas.title}</h1>
          {idea ? (
            <>
              <p className="mt-2 text-sm">
                {ideaLabel(t.ideas, idea.promiseKey)}
              </p>
              <p className="text-muted-foreground mt-1 text-xs">
                {ideaLabel(t.ideas, idea.howKey)}
              </p>
            </>
          ) : null}
        </div>
      ) : null}
      <button
        type="button"
        className="bg-primary text-primary-foreground h-10 rounded-lg"
        onClick={next}
      >
        {index === steps.length - 1
          ? t.onboarding.getStarted
          : t.onboarding.next}
      </button>
    </main>
  );
}
