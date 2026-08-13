/**
 * QuickStartWizard Page — 3-step wizard for first-time profile setup
 *
 * Steps: Template Selection → Personalize → Confirm
 *
 * Supports resume from interrupted state via persisted quickstart_step
 * and quickstart_profile_id settings. Users can skip at any step to
 * create a default "General Helper" profile.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useNavigate } from 'react-router-dom';

import { AnimatePresence, motion } from 'motion/react';

import {
  DEFAULT_AVATAR,
  TEMPLATE_AVATARS,
} from '@/components/profiles/avatar-options';
import { ConfirmStep } from '@/components/quickstart/ConfirmStep';
import { PersonalizeStep } from '@/components/quickstart/PersonalizeStep';
import {
  TemplateStep,
  type QuickstartTemplate,
} from '@/components/quickstart/TemplateStep';
import { markQuickstartDone } from '@/components/setup-guard';
import { API_BASE_URL } from '@/config';
import { markFirstRunCompleted, seedDemoIfNeeded } from '@/shared/db/first-run';
import { getSettingItem, saveSettingItem } from '@/shared/db/settings';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import { randomUUID } from '@/shared/utils/uuid';

// ============================================================================
// Types
// ============================================================================

type WizardStep = 'template' | 'personalize' | 'confirm';

interface PersonalizeData {
  name: string;
  tone: string;
  role: string;
}

// ============================================================================
// Constants
// ============================================================================

const STEPS: WizardStep[] = ['template', 'personalize', 'confirm'];

const STEP_I18N_KEYS: Record<WizardStep, string> = {
  template: 'quickstartStepTemplate',
  personalize: 'quickstartStepPersonalize',
  confirm: 'quickstartStepConfirm',
};

// TEMPLATE_AVATARS and DEFAULT_AVATAR imported from avatar-options

const SLIDE_VARIANTS = {
  enter: (direction: number) => ({
    x: direction > 0 ? 80 : -80,
    opacity: 0,
  }),
  center: { x: 0, opacity: 1 },
  exit: (direction: number) => ({
    x: direction > 0 ? -80 : 80,
    opacity: 0,
  }),
};

const SLIDE_TRANSITION = { duration: 0.25, ease: 'easeInOut' as const };

// ============================================================================
// StepIndicator
// ============================================================================

function StepIndicator({
  currentStep,
  t,
}: {
  currentStep: WizardStep;
  t: Record<string, string>;
}) {
  const currentIdx = STEPS.indexOf(currentStep);

  return (
    <div className="flex items-center justify-center gap-8">
      {STEPS.map((step, idx) => {
        const isActive = idx === currentIdx;
        const isCompleted = idx < currentIdx;
        const label = t[STEP_I18N_KEYS[step]] ?? step;

        return (
          <div key={step} className="flex items-center gap-2">
            <div
              className={cn(
                'flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium transition-colors',
                isActive &&
                  'bg-primary text-primary-foreground ring-primary/30 ring-2',
                isCompleted && 'bg-primary/20 text-primary',
                !isActive && !isCompleted && 'bg-muted text-muted-foreground',
              )}
            >
              {isCompleted ? '✓' : idx + 1}
            </div>
            <span
              className={cn(
                'text-sm transition-colors',
                isActive && 'text-foreground font-medium',
                !isActive && 'text-muted-foreground',
              )}
            >
              {label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function QuickStartWizard() {
  const { t, language } = useLanguage();
  const navigate = useNavigate();
  const qs = useMemo(
    () => (t.profiles as Record<string, unknown>) ?? {},
    [t.profiles],
  );

  const [step, setStep] = useState<WizardStep>('template');
  const [profileId, setProfileId] = useState<string | null>(null);
  const [templateData, setTemplateData] = useState<QuickstartTemplate | null>(
    null,
  );
  const [personalizeData, setPersonalizeData] = useState<PersonalizeData>({
    name: '',
    tone: '',
    role: '',
  });
  const [direction, setDirection] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  // ── Resume from persisted state ──────────────────────────────────────────
  useEffect(() => {
    mountedRef.current = true;
    const controller = new AbortController();

    async function resume() {
      const [savedStep, savedProfileId] = await Promise.all([
        getSettingItem('quickstart_step'),
        getSettingItem('quickstart_profile_id'),
      ]);

      if (controller.signal.aborted) return;

      if (savedStep === 'completed') {
        navigate('/', { replace: true });
        return;
      }

      if (
        savedStep &&
        STEPS.includes(savedStep as WizardStep) &&
        savedStep !== 'template'
      ) {
        setStep(savedStep as WizardStep);
      }
      if (savedProfileId) {
        setProfileId(savedProfileId);
      }
    }

    resume();

    return () => {
      mountedRef.current = false;
      controller.abort();
    };
  }, [navigate]);

  // ── Skip Handler ─────────────────────────────────────────────────────────
  const handleSkip = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const id = randomUUID();
      const avatar = TEMPLATE_AVATARS['general-assistant'] ?? DEFAULT_AVATAR;
      const defaultName =
        (qs as Record<string, string>).quickstartDefaultName ??
        'General Helper';
      const createRes = await fetch(`${API_BASE_URL}/db/agent-profiles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          name: defaultName,
          runtime_id: 'claude',
          avatar_icon: avatar.icon,
          avatar_color: avatar.color,
        }),
      });
      if (!createRes.ok) throw new Error('Failed to create default profile');

      const applyRes = await fetch(
        `${API_BASE_URL}/soul/agent-profiles/${id}/apply`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ template_id: 'general-assistant' }),
        },
      );
      if (!applyRes.ok) throw new Error('Failed to apply template');

      await Promise.all([
        saveSettingItem('quickstart_step', 'completed'),
        saveSettingItem('activeProfileId', id),
      ]);

      markQuickstartDone();
      // Mark first-run + seed demo task — both idempotent.
      try {
        await markFirstRunCompleted();
        await seedDemoIfNeeded();
      } catch (e) {
        if (import.meta.env.DEV)
          console.warn('[QuickStart] post-completion bootstrap failed:', e);
      }
      if (mountedRef.current) navigate('/', { replace: true });
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : 'Setup failed');
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [navigate, qs]);

  // ── Template Selection Handler ───────────────────────────────────────────
  const handleTemplateSelect = useCallback(
    async (template: QuickstartTemplate) => {
      setLoading(true);
      setError(null);
      try {
        const id = randomUUID();
        const avatar = TEMPLATE_AVATARS[template.id] ?? DEFAULT_AVATAR;
        const createRes = await fetch(`${API_BASE_URL}/db/agent-profiles`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id,
            name: template.name,
            runtime_id: 'claude',
            avatar_icon: avatar.icon,
            avatar_color: avatar.color,
          }),
        });
        if (!createRes.ok) throw new Error('Failed to create profile');

        const applyRes = await fetch(
          `${API_BASE_URL}/soul/agent-profiles/${id}/apply`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ template_id: template.id, language }),
          },
        );
        if (!applyRes.ok) throw new Error('Failed to apply template');

        setProfileId(id);
        setTemplateData(template);
        setPersonalizeData((prev) => ({ ...prev, name: template.name }));

        await Promise.all([
          saveSettingItem('quickstart_step', 'personalize'),
          saveSettingItem('quickstart_profile_id', id),
        ]);

        if (mountedRef.current) {
          setDirection(1);
          setStep('personalize');
        }
      } catch (err) {
        if (mountedRef.current) {
          setError(
            err instanceof Error ? err.message : 'Template setup failed',
          );
        }
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    },
    [language],
  );

  // ── Personalize Handler ──────────────────────────────────────────────────
  const handlePersonalizeContinue = useCallback(
    async (data: PersonalizeData) => {
      if (!profileId) return;
      setLoading(true);
      setError(null);
      try {
        const updateRes = await fetch(
          `${API_BASE_URL}/db/agent-profiles/${profileId}`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: data.name, role: data.role }),
          },
        );
        if (!updateRes.ok) throw new Error('Failed to update profile');

        setPersonalizeData(data);
        await saveSettingItem('quickstart_step', 'confirm');

        if (mountedRef.current) {
          setDirection(1);
          setStep('confirm');
        }
      } catch (err) {
        if (mountedRef.current) {
          setError(err instanceof Error ? err.message : 'Update failed');
        }
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    },
    [profileId],
  );

  // ── Confirm Handler ──────────────────────────────────────────────────────
  const handleConfirm = useCallback(async () => {
    if (!profileId) return;
    setLoading(true);
    setError(null);
    try {
      await Promise.all([
        saveSettingItem('quickstart_step', 'completed'),
        saveSettingItem('activeProfileId', profileId),
      ]);

      markQuickstartDone();
      // Mark first-run + seed demo task — both idempotent.
      try {
        await markFirstRunCompleted();
        await seedDemoIfNeeded();
      } catch (e) {
        if (import.meta.env.DEV)
          console.warn('[QuickStart] post-completion bootstrap failed:', e);
      }
      if (mountedRef.current) navigate('/', { replace: true });
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : 'Confirmation failed');
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [profileId, navigate]);

  // ── Back Handler ─────────────────────────────────────────────────────────
  const handleBack = useCallback(() => {
    const idx = STEPS.indexOf(step);
    if (idx > 0) {
      setDirection(-1);
      setStep(STEPS[idx - 1]);
    }
  }, [step]);

  // ── Render ───────────────────────────────────────────────────────────────
  const stepContent = () => {
    switch (step) {
      case 'template':
        return (
          <TemplateStep
            onSelect={handleTemplateSelect}
            onSkip={handleSkip}
            loading={loading}
          />
        );
      case 'personalize':
        return (
          <PersonalizeStep
            templateName={templateData?.name ?? ''}
            avatarIcon={
              (templateData && TEMPLATE_AVATARS[templateData.id]?.icon) ??
              DEFAULT_AVATAR.icon
            }
            avatarColor={
              (templateData && TEMPLATE_AVATARS[templateData.id]?.color) ??
              DEFAULT_AVATAR.color
            }
            templateGreeting={templateData?.greeting}
            skillCount={templateData?.skill_count ?? 0}
            initialData={personalizeData}
            onNext={handlePersonalizeContinue}
            onBack={handleBack}
            onSkip={handleSkip}
          />
        );
      case 'confirm':
        return (
          <ConfirmStep
            profileData={{
              name: personalizeData.name || templateData?.name || '',
              role: personalizeData.role || '',
              tone: personalizeData.tone || '',
              avatarIcon:
                (templateData && TEMPLATE_AVATARS[templateData.id]?.icon) ??
                DEFAULT_AVATAR.icon,
              avatarColor:
                (templateData && TEMPLATE_AVATARS[templateData.id]?.color) ??
                DEFAULT_AVATAR.color,
              greeting: templateData?.greeting,
              skillCount: templateData?.skill_count ?? 0,
            }}
            loading={loading}
            onStart={handleConfirm}
            onCustomize={() => {
              if (profileId) navigate(`/org/${profileId}`);
            }}
          />
        );
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-2xl space-y-10">
        {/* Step indicator */}
        <StepIndicator currentStep={step} t={qs as Record<string, string>} />

        {/* Error banner */}
        {error && (
          <p className="text-destructive text-center text-sm">{error}</p>
        )}

        {/* Step content with transitions */}
        <div className="relative min-h-[400px]">
          <AnimatePresence mode="wait" custom={direction}>
            <motion.div
              key={step}
              custom={direction}
              variants={SLIDE_VARIANTS}
              initial="enter"
              animate="center"
              exit="exit"
              transition={SLIDE_TRANSITION}
            >
              {stepContent()}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
