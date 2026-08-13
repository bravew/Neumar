/**
 * Multi-step wizard for creating a new agent profile.
 * Steps: 1) Choose specialty  2) Personalize  3) Configure  4) Review & Create
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useNavigate } from 'react-router-dom';

import { Check, ChevronRight } from 'lucide-react';

import {
  DEFAULT_AVATAR,
  TEMPLATE_AVATARS,
} from '@/components/profiles/avatar-options';
import type { ProviderInfo } from '@/components/profiles/profile-constants';
import type { ProfileFormData } from '@/components/profiles/ProfileDialog';
import {
  TemplateStep,
  type QuickstartTemplate,
} from '@/components/quickstart/TemplateStep';
import { API_BASE_URL } from '@/config';
import {
  AnimatePresence,
  DURATION,
  EASE,
  motion,
  SPRING,
} from '@/config/animation';
import { invalidateProfilesCache } from '@/shared/hooks/useAgentProfiles';
import { useLanguage } from '@/shared/providers/language-provider';
import type { AgentSoul } from '@/shared/types/agent-profile';

import { ConfigureStep } from './ConfigureStep';
import { PersonalizeStep } from './PersonalizeStep';
import { ReviewStep } from './ReviewStep';

// ============================================================================
// Types
// ============================================================================

export interface WizardData {
  template: QuickstartTemplate | null;
  form: ProfileFormData;
}

/** Shape returned by GET /soul/templates/:id */
export interface SoulTemplateEntry {
  id: string;
  quickstart?: boolean;
  icon?: string;
  default_skills?: string[];
  name: Record<string, string>;
  description: Record<string, string>;
  souls: Record<string, AgentSoul>;
}

interface ProfileWizardProps {
  profileId: string;
  initialForm: ProfileFormData;
}

const TOTAL_STEPS = 4;
const STEP_KEYS = ['template', 'personalize', 'configure', 'confirm'] as const;

/** Slide transition variants — extracted to module scope to preserve referential equality. */
const slideVariants = {
  enter: (dir: number) => ({
    x: dir > 0 ? 80 : -80,
    opacity: 0,
  }),
  center: { x: 0, opacity: 1 },
  exit: (dir: number) => ({
    x: dir > 0 ? -80 : 80,
    opacity: 0,
  }),
};

// ============================================================================
// Step indicator
// ============================================================================

function StepIndicator({
  currentStep,
  labels,
}: {
  currentStep: number;
  labels: string[];
}) {
  return (
    <div className="flex items-center justify-center gap-2">
      {labels.map((label, i) => {
        const isCompleted = i < currentStep;
        const isCurrent = i === currentStep;
        return (
          <div key={STEP_KEYS[i]} className="flex items-center gap-2">
            {i > 0 && (
              <ChevronRight className="text-muted-foreground/40 size-3.5" />
            )}
            <div className="flex items-center gap-1.5">
              <div
                className={`flex size-6 items-center justify-center rounded-full text-xs font-semibold transition-colors ${
                  isCompleted
                    ? 'bg-primary text-primary-foreground'
                    : isCurrent
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground'
                }`}
              >
                {isCompleted ? <Check className="size-3.5" /> : i + 1}
              </div>
              <span
                className={`hidden text-xs font-medium transition-colors sm:inline ${
                  isCurrent ? 'text-foreground' : 'text-muted-foreground'
                }`}
              >
                {label}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ============================================================================
// Wizard
// ============================================================================

export function ProfileWizard({ profileId, initialForm }: ProfileWizardProps) {
  const navigate = useNavigate();
  const { t, language } = useLanguage();
  const p = t.profiles;

  const [step, setStep] = useState(0);
  const [data, setData] = useState<WizardData>({
    template: null,
    form: { ...initialForm },
  });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const directionRef = useRef(1);
  const soulFetchRef = useRef<AbortController | null>(null);

  // Fetch providers once for runtime/model selection
  useEffect(() => {
    const ac = new AbortController();
    fetch(`${API_BASE_URL}/providers/agents`, { signal: ac.signal })
      .then((res) => (res.ok ? res.json() : { providers: [] }))
      .then((d) => setProviders(d.providers ?? []))
      .catch(() => {});
    return () => ac.abort();
  }, []);

  // Fetch soul from template and store in form for editing
  const fetchTemplateSoul = useCallback(
    (templateId: string) => {
      if (templateId === 'custom') return;
      soulFetchRef.current?.abort();
      const ac = new AbortController();
      soulFetchRef.current = ac;
      fetch(`${API_BASE_URL}/soul/templates/${templateId}`, {
        signal: ac.signal,
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((entry: SoulTemplateEntry | null) => {
          if (!entry) return;
          const soul = entry.souls[language] ?? entry.souls['en-US'] ?? null;
          if (soul) {
            setData((prev) => ({
              ...prev,
              form: {
                ...prev.form,
                soul,
                soul_version: 1,
                soul_origin: 'predefined',
              },
            }));
          }
        })
        .catch(() => {});
    },
    [language],
  );

  const stepLabels = useMemo(
    () => [
      p.quickstartStepTemplate ?? 'Choose a specialty',
      p.quickstartStepPersonalize ?? 'Make it yours',
      p.quickstartStepConfigure ?? 'Configure',
      p.quickstartStepConfirm ?? 'Ready to go',
    ],
    [p],
  );

  // ── Step transitions ────────────────────────────────────────────────────

  const goForward = useCallback(() => {
    directionRef.current = 1;
    setStep((s) => Math.min(TOTAL_STEPS - 1, s + 1));
  }, []);

  const goBack = useCallback(() => {
    directionRef.current = -1;
    setStep((s) => Math.max(0, s - 1));
  }, []);

  const handleTemplateSelect = useCallback(
    (template: QuickstartTemplate) => {
      const avatar = TEMPLATE_AVATARS[template.id] ?? DEFAULT_AVATAR;
      setData((prev) => ({
        template,
        form: {
          ...prev.form,
          name: template.id === 'custom' ? '' : template.name,
          avatar_icon: avatar.icon,
          avatar_color: avatar.color,
          default_skills:
            template.default_skills.length > 0
              ? template.default_skills
              : prev.form.default_skills,
          runtime_id: prev.form.runtime_id || 'claude',
        },
      }));
      fetchTemplateSoul(template.id);
      directionRef.current = 1;
      setStep(1);
    },
    [fetchTemplateSoul],
  );

  const handleSkipTemplate = useCallback(() => {
    setData((prev) => ({
      template: {
        id: 'custom',
        name: '',
        description: '',
        quickstart: false,
        default_skills: [],
        skill_count: 0,
      },
      form: {
        ...prev.form,
        runtime_id: prev.form.runtime_id || 'claude',
      },
    }));
    directionRef.current = 1;
    setStep(1);
  }, []);

  const updateForm = useCallback(
    (updater: (prev: ProfileFormData) => ProfileFormData) => {
      setData((prev) => ({ ...prev, form: updater(prev.form) }));
    },
    [],
  );

  // ── Create profile ──────────────────────────────────────────────────────

  const handleCreate = useCallback(async () => {
    if (!profileId || !data.form.name.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      const { thinking_config, ...rest } = data.form;
      const payload = {
        ...rest,
        id: profileId,
        soul: data.form.soul ? JSON.stringify(data.form.soul) : undefined,
        default_mcp_servers: JSON.stringify(data.form.default_mcp_servers),
        default_skills: JSON.stringify(data.form.default_skills),
        default_thinking_config: thinking_config
          ? JSON.stringify(thinking_config)
          : null,
      };

      const createRes = await fetch(`${API_BASE_URL}/db/agent-profiles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!createRes.ok) throw new Error('Failed to create profile');

      invalidateProfilesCache();
      navigate(`/org/${profileId}`, { replace: true });
    } catch (e) {
      setCreateError(
        e instanceof Error ? e.message : 'Failed to create profile',
      );
    } finally {
      setCreating(false);
    }
  }, [profileId, data, navigate]);

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full flex-col">
      {/* Stepper */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: DURATION.moderate, ease: EASE.out }}
        className="border-border shrink-0 border-b px-6 py-4"
      >
        <StepIndicator currentStep={step} labels={stepLabels} />
      </motion.div>

      {/* Step content */}
      <div className="relative min-h-0 flex-1 overflow-y-auto">
        <AnimatePresence mode="wait" custom={directionRef.current}>
          {step === 0 && (
            <motion.div
              key="step-template"
              custom={directionRef.current}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ ...SPRING.gentle }}
              className="h-full"
            >
              <TemplateStep
                onSelect={handleTemplateSelect}
                onSkip={handleSkipTemplate}
                skipLabel={p.startFromScratch}
              />
            </motion.div>
          )}

          {step === 1 && (
            <motion.div
              key="step-personalize"
              custom={directionRef.current}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ ...SPRING.gentle }}
              className="h-full"
            >
              <PersonalizeStep
                form={data.form}
                setForm={updateForm}
                templateName={data.template?.name ?? ''}
                onBack={goBack}
                onContinue={goForward}
              />
            </motion.div>
          )}

          {step === 2 && (
            <motion.div
              key="step-configure"
              custom={directionRef.current}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ ...SPRING.gentle }}
              className="h-full"
            >
              <ConfigureStep
                form={data.form}
                setForm={updateForm}
                providers={providers}
                onBack={goBack}
                onContinue={goForward}
              />
            </motion.div>
          )}

          {step === 3 && (
            <motion.div
              key="step-review"
              custom={directionRef.current}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ ...SPRING.gentle }}
              className="h-full"
            >
              <ReviewStep
                data={data}
                providers={providers}
                creating={creating}
                error={createError}
                onBack={goBack}
                onCreate={handleCreate}
                onJumpToStep={(s) => {
                  directionRef.current = -1;
                  setStep(s);
                }}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
