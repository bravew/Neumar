import { useCallback, useState } from 'react';

import { AvatarSvg } from '@/components/profiles/avatar-options';
import { listItem, motion, staggerContainer } from '@/config/animation';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

interface PersonalizeStepProps {
  templateName: string;
  avatarIcon: string;
  avatarColor: string;
  templateGreeting?: string;
  skillCount: number;
  initialData: { name: string; tone: string; role: string };
  onNext: (data: { name: string; tone: string; role: string }) => void;
  onBack: () => void;
  onSkip: () => void;
}

const INPUT_CLASS =
  'bg-muted/50 border-border focus:border-primary/50 w-full rounded-lg border px-3 py-2 text-sm outline-none transition-colors';
const LABEL_CLASS = 'text-foreground/70 text-xs font-medium';

export function PersonalizeStep({
  templateName,
  avatarIcon,
  avatarColor,
  templateGreeting,
  skillCount,
  initialData,
  onNext,
  onBack,
  onSkip,
}: PersonalizeStepProps) {
  const { t } = useLanguage();
  const p = t.profiles;
  const [name, setName] = useState(initialData.name);
  const [role, setRole] = useState(initialData.role);
  const [tone, setTone] = useState(initialData.tone);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      onNext({ name: name.trim() || initialData.name, tone, role });
    },
    [name, tone, role, initialData.name, onNext],
  );

  return (
    <motion.div
      variants={staggerContainer}
      initial="hidden"
      animate="visible"
      className="flex flex-col gap-5"
    >
      {/* Header */}
      <motion.div variants={listItem} className="flex items-center gap-3">
        <AvatarSvg
          avatarId={avatarIcon}
          color={avatarColor}
          className="size-10 shrink-0 overflow-hidden rounded-xl"
        />
        <div>
          <h2 className="text-foreground text-base font-semibold">
            {p.quickstartPersonalizeTitle ?? 'Personalize your agent'}
          </h2>
          <p className="text-muted-foreground text-xs">
            {p.quickstartPersonalizeSubtitle ??
              'Tweak the basics — you can fine-tune everything later'}
          </p>
        </div>
      </motion.div>

      {/* Form */}
      <motion.form
        variants={listItem}
        onSubmit={handleSubmit}
        className="flex flex-col gap-4"
      >
        <div className="flex flex-col gap-1.5">
          <label className={LABEL_CLASS}>{p.name ?? 'Name'}</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={INPUT_CLASS}
            placeholder={templateName}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className={LABEL_CLASS}>{p.role ?? 'Role'}</label>
          <input
            type="text"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className={INPUT_CLASS}
            placeholder={initialData.role}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className={LABEL_CLASS}>{p.soulTone ?? 'Tone'}</label>
          <input
            type="text"
            value={tone}
            onChange={(e) => setTone(e.target.value)}
            className={INPUT_CLASS}
            placeholder={initialData.tone}
          />
        </div>

        {/* Skills badge */}
        {skillCount > 0 && (
          <div className="flex flex-col gap-1.5">
            <label className={LABEL_CLASS}>
              {p.quickstartBundledSkills ?? 'Bundled skills'}
            </label>
            <div className="flex items-center gap-2">
              <span className="bg-primary/10 text-primary rounded-full px-2.5 py-0.5 text-xs font-medium">
                {skillCount}{' '}
                {skillCount === 1
                  ? (p.quickstartSkillSingular ?? 'skill')
                  : (p.quickstartSkillPlural ?? 'skills')}
              </span>
            </div>
          </div>
        )}

        {/* Greeting preview */}
        {templateGreeting && (
          <div className="bg-muted/30 border-border/50 rounded-lg border p-3">
            <p className="text-muted-foreground mb-1 text-xs font-medium">
              {p.quickstartGreetingPreview ?? 'Greeting preview'}
            </p>
            <p className="text-foreground/80 text-sm italic">
              &ldquo;{templateGreeting}&rdquo;
            </p>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-between pt-2">
          <button
            type="button"
            onClick={onBack}
            className={cn(
              'text-muted-foreground hover:text-foreground rounded-lg px-3 py-1.5 text-sm transition-colors',
            )}
          >
            &larr; {p.quickstartBack ?? 'Back'}
          </button>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onSkip}
              className="text-muted-foreground hover:text-foreground text-xs underline transition-colors"
            >
              {p.quickstartSkipDetails ?? 'Use template defaults'}
            </button>
            <button
              type="submit"
              className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg px-4 py-1.5 text-sm font-medium transition-colors"
            >
              {p.quickstartContinue ?? 'Continue'} &rarr;
            </button>
          </div>
        </div>
      </motion.form>
    </motion.div>
  );
}
