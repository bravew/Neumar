/**
 * SkillAnchorBadge — a subtle, non-interactive indicator that a plugin's
 * session-start "discipline anchor" prefixed the reply with a `Skill: <slug>`
 * line. We lift that line out of the message body (see {@link parseSkillAnchor})
 * and show it here as a quiet chip instead of rendering it as plain text.
 */

import { Sparkles } from 'lucide-react';

import { useLanguage } from '@/shared/providers/language-provider';

export function SkillAnchorBadge({ skill }: { skill: string }) {
  const { t } = useLanguage();
  return (
    <span
      className="text-muted-foreground/80 border-border/60 bg-muted/40 inline-flex w-fit items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium"
      title={t.task.skillAnchorTooltip}
    >
      <Sparkles className="size-3 shrink-0" />
      <span className="font-mono">{skill}</span>
    </span>
  );
}
