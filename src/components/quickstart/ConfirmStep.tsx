import { Check } from 'lucide-react';
import { motion } from 'motion/react';

import { AvatarSvg } from '@/components/profiles/avatar-options';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

interface ConfirmStepProps {
  profileData: {
    name: string;
    role: string;
    tone: string;
    avatarIcon: string;
    avatarColor: string;
    greeting?: string;
    skillCount: number;
  };
  loading?: boolean;
  onStart: () => void;
  onCustomize: () => void;
}

export function ConfirmStep({
  profileData,
  loading,
  onStart,
  onCustomize,
}: ConfirmStepProps) {
  const { t } = useLanguage();
  const p = t.profiles;

  return (
    <div className="mx-auto flex max-w-lg flex-col items-center gap-6 px-4 py-8">
      {/* Animated checkmark */}
      <motion.div
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 200, damping: 18, delay: 0.1 }}
        className="bg-primary/10 flex h-16 w-16 items-center justify-center rounded-full"
      >
        <Check className="text-primary h-8 w-8" strokeWidth={2.5} />
      </motion.div>

      <h2 className="text-2xl font-bold tracking-tight">
        {p.quickstartConfirmTitle ?? 'Your agent is ready!'}
      </h2>

      {/* Summary card */}
      <div className="bg-card border-border w-full rounded-xl border p-6">
        <div className="flex items-center gap-3">
          <AvatarSvg
            avatarId={profileData.avatarIcon}
            color={profileData.avatarColor}
            className="size-12 shrink-0 overflow-hidden rounded-xl"
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-semibold">
              {profileData.name}
            </p>
            <p className="text-muted-foreground truncate text-sm">
              {profileData.role}
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {profileData.tone && (
            <span className="bg-muted text-muted-foreground rounded-full px-2.5 py-0.5 text-xs font-medium">
              {profileData.tone}
            </span>
          )}
          {profileData.skillCount > 0 && (
            <span className="bg-primary/10 text-primary rounded-full px-2.5 py-0.5 text-xs font-medium">
              {profileData.skillCount}{' '}
              {profileData.skillCount === 1
                ? (p.quickstartSkillSingular ?? 'skill')
                : (p.quickstartSkillPlural ?? 'skills')}
            </span>
          )}
        </div>

        {profileData.greeting && (
          <blockquote className="border-muted-foreground/30 text-muted-foreground mt-4 border-l-2 pl-3 text-sm italic">
            {profileData.greeting}
          </blockquote>
        )}
      </div>

      {/* CTAs */}
      <div className="flex flex-col items-center gap-3">
        <button
          type="button"
          onClick={onStart}
          disabled={loading}
          className={cn(
            'bg-primary text-primary-foreground hover:bg-primary/90',
            'rounded-lg px-8 py-3 font-medium transition-colors',
            'disabled:pointer-events-none disabled:opacity-50',
          )}
        >
          {p.quickstartStartChatting ?? 'Start chatting'}
        </button>
        <button
          type="button"
          onClick={onCustomize}
          disabled={loading}
          className="text-muted-foreground hover:text-foreground text-sm underline underline-offset-4 transition-colors disabled:pointer-events-none disabled:opacity-50"
        >
          {p.quickstartCustomizeFurther ?? 'Customize further in Settings'}
        </button>
      </div>
    </div>
  );
}
