import { ArrowUpRight, Sparkles } from 'lucide-react';

import type { DesignChatTurn } from '@/shared/hooks/useDesignChat';
import { useLanguage } from '@/shared/providers/language-provider';
import type { DesignSurface } from '@/shared/types/design-mode';

/**
 * "Next steps" card shown after a build (Open Design `NextStepActions` parity).
 * Surfaces a few curated follow-up actions anchored to the freshly built
 * artifact; clicking one *seeds the composer* (it does not auto-send) so the
 * user can tweak the prompt before running. Suggestions are surface-aware.
 * Self-gating: renders only when a build just finished (idle run, artifact
 * open, no pending questions).
 */
export function DesignNextStepCard({
  surface,
  turns,
  hasOpenQuestions,
  sending,
  artifactFile,
  onPick,
}: {
  surface: DesignSurface;
  turns: DesignChatTurn[];
  hasOpenQuestions: boolean;
  sending: boolean;
  artifactFile: string | null;
  onPick: (prompt: string) => void;
}) {
  const { t } = useLanguage();
  const last = turns[turns.length - 1];
  const ready =
    !sending &&
    !hasOpenQuestions &&
    Boolean(artifactFile) &&
    last?.role === 'assistant' &&
    last.status === 'done';
  if (!ready) return null;
  const isDoc = surface === 'document' || surface === 'campaign';
  const suggestions = isDoc
    ? [
        t.design.nextStepSection,
        t.design.nextStepCopy,
        t.design.nextStepPolish,
        t.design.nextStepVariant,
      ]
    : [
        t.design.nextStepResponsive,
        t.design.nextStepPolish,
        t.design.nextStepSection,
        t.design.nextStepVariant,
      ];

  return (
    <div
      className="border-border/70 bg-accent/30 mt-3 space-y-2 rounded-md border p-2.5"
      data-testid="design-next-step-card"
    >
      <div className="text-muted-foreground flex items-center gap-1.5 text-[11px] font-medium tracking-wide uppercase">
        <Sparkles className="size-3.5" />
        {t.design.nextStepTitle}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {suggestions.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onPick(s)}
            className="border-border bg-background hover:bg-accent text-foreground/90 inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors"
          >
            {s}
            <ArrowUpRight className="text-muted-foreground size-3" />
          </button>
        ))}
      </div>
    </div>
  );
}
