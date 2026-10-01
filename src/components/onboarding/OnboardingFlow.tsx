import { useMemo, useState } from 'react';

import { useNavigate, useSearchParams } from 'react-router-dom';

import { markQuickstartDone } from '@/components/setup-guard';
import { APP_NAME } from '@/config/branding';
import { markFirstRunCompleted, seedDemoIfNeeded } from '@/shared/db/first-run';
import {
  getSettings,
  ONBOARDING_VERSION,
  saveSettingItem,
  saveSettings,
} from '@/shared/db/settings';
import { listIdeas } from '@/shared/ideas/registry';
import { useLanguage } from '@/shared/providers/language-provider';

import { InstallToolsStep } from './InstallToolsStep';

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
  const idea = listIdeas()[0];

  const finish = async () => {
    const settings = getSettings();
    saveSettings({ ...settings, planMode: 'on' });
    await Promise.all([
      saveSettingItem('onboardingCompleted', 'true'),
      saveSettingItem('onboardingVersion', ONBOARDING_VERSION),
      saveSettingItem('quickstart_step', 'completed'),
    ]).catch(() => undefined);
    markQuickstartDone();
    try {
      await markFirstRunCompleted();
      await seedDemoIfNeeded();
    } catch {
      // Completion still returns the user home.
    }
    const promptKey =
      idea?.action.kind === 'prefill' ? idea.action.promptKey : '';
    window.dispatchEvent(
      new CustomEvent('ideas:prefill', {
        detail: { prompt: promptKey ? t.ideas.prompt.draftEmail : '' },
      }),
    );
    navigate('/', { replace: true });
  };

  const index = steps.indexOf(step);
  const next = () => {
    const following = steps[index + 1];
    if (!following) {
      void finish();
      return;
    }
    setStep(following);
  };

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
      {step === 'install' ? (
        <InstallToolsStep
          title={t.onboarding.installTools}
          body={t.onboarding.installToolsBody}
        />
      ) : null}
      {step === 'welcome' ? (
        <h1 className="text-2xl font-semibold">
          {t.onboarding.welcomeTitle.replace('{appName}', APP_NAME)}
        </h1>
      ) : null}
      {step === 'connect' ? (
        <h1 className="text-2xl font-semibold">{t.onboarding.connectBrain}</h1>
      ) : null}
      {step === 'idea' ? (
        <div>
          <h1 className="text-2xl font-semibold">{t.ideas.title}</h1>
          <p className="mt-2 text-sm">{t.ideas.promise.draftEmail}</p>
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
