import { useEffect, useState } from 'react';

import {
  AvatarSvg,
  DEFAULT_AVATAR,
  TEMPLATE_AVATARS,
} from '@/components/profiles/avatar-options';
import { API_BASE_URL } from '@/config';
import {
  DURATION,
  EASE,
  listItem,
  motion,
  SCALE,
  SPRING,
  staggerContainerSlow,
} from '@/config/animation';
import { useLanguage } from '@/shared/providers/language-provider';

export interface QuickstartTemplate {
  id: string;
  name: string;
  description: string;
  icon?: string;
  quickstart: boolean;
  default_skills: string[];
  skill_count: number;
  greeting?: string;
}

interface TemplateStepProps {
  onSelect: (template: QuickstartTemplate) => void;
  onSkip: () => void;
  loading?: boolean;
  skipLabel?: string;
}

export function TemplateStep({
  onSelect,
  onSkip,
  loading,
  skipLabel,
}: TemplateStepProps) {
  const { t, language } = useLanguage();
  const p = t.profiles;
  const [templates, setTemplates] = useState<QuickstartTemplate[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    fetch(
      `${API_BASE_URL}/soul/templates?quickstart=true&language=${language}`,
      { signal: controller.signal },
    )
      .then((res) => {
        if (!res.ok)
          throw new Error(`Failed to fetch templates (${res.status})`);
        return res.json();
      })
      .then((data) => {
        if (!controller.signal.aborted) {
          setTemplates(Array.isArray(data) ? data : (data.templates ?? []));
          setError(null);
        }
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setError(err.message);
        }
      });

    return () => controller.abort();
  }, [language]);

  const customTemplate: QuickstartTemplate = {
    id: 'custom',
    name: p.quickstartTemplateCustom ?? 'Custom',
    description:
      p.quickstartTemplateCustomDesc ??
      'Start from scratch and configure everything yourself',
    quickstart: false,
    default_skills: [],
    skill_count: 0,
  };

  return (
    <div className="mx-auto flex max-w-3xl flex-col items-center gap-6 px-4 py-8">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: DURATION.moderate, ease: EASE.out }}
        className="text-center"
      >
        <h2 className="text-2xl font-bold tracking-tight">
          {p.quickstartWelcomeTitle ?? "Choose your agent's specialty"}
        </h2>
        <p className="text-muted-foreground mt-2 text-sm">
          {p.quickstartWelcomeSubtitle ??
            'Each template comes with skills and personality — pick one to get started'}
        </p>
      </motion.div>

      {error && <p className="text-destructive text-sm">{error}</p>}

      <motion.div
        variants={staggerContainerSlow}
        initial="hidden"
        animate="visible"
        className="grid w-full grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4"
      >
        {templates.map((tpl) => (
          <TemplateCard
            key={tpl.id}
            template={tpl}
            onSelect={onSelect}
            disabled={loading}
            skillLabel={p.quickstartSkillsIncluded}
          />
        ))}
        <TemplateCard
          template={customTemplate}
          onSelect={onSelect}
          disabled={loading}
        />
      </motion.div>

      <motion.button
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.6, duration: 0.3 }}
        type="button"
        onClick={onSkip}
        disabled={loading}
        className="text-muted-foreground hover:text-foreground text-sm underline underline-offset-4 transition-colors"
      >
        {skipLabel ?? p.quickstartSkipSetup ?? 'Skip — use default agent'}
      </motion.button>
    </div>
  );
}

function TemplateCard({
  template,
  onSelect,
  disabled,
  skillLabel,
}: {
  template: QuickstartTemplate;
  onSelect: (t: QuickstartTemplate) => void;
  disabled?: boolean;
  skillLabel?: string;
}) {
  const avatar = TEMPLATE_AVATARS[template.id] ?? DEFAULT_AVATAR;

  return (
    <motion.button
      variants={listItem}
      whileHover={{
        scale: SCALE.hover,
        y: -2,
        transition: { ...SPRING.snappy },
      }}
      whileTap={{ scale: SCALE.tap }}
      type="button"
      disabled={disabled}
      onClick={() => onSelect(template)}
      className="bg-card border-border hover:border-primary/50 flex flex-col items-start gap-2 rounded-xl border p-5 text-left transition-shadow hover:shadow-md disabled:pointer-events-none disabled:opacity-50"
    >
      <AvatarSvg
        avatarId={avatar.icon}
        color={avatar.color}
        className="size-10 shrink-0 overflow-hidden rounded-xl"
      />
      <span className="text-sm font-bold">{template.name}</span>
      <span className="text-muted-foreground line-clamp-2 text-xs">
        {template.description}
      </span>
      {template.skill_count > 0 && (
        <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-[10px] font-medium">
          {skillLabel
            ? skillLabel.replace('{count}', String(template.skill_count))
            : `${template.skill_count} skills`}
        </span>
      )}
      {template.greeting && (
        <span className="text-muted-foreground w-full truncate text-xs italic">
          {template.greeting}
        </span>
      )}
    </motion.button>
  );
}
