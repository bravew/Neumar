import { useCallback, useMemo } from 'react';

import { AlertCircle, BookOpen, Clock } from 'lucide-react';

import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import type { AgentSoul } from '@/shared/types/agent-profile';

import { SOUL_INPUT_CLASS, SOUL_LABEL_CLASS } from './soul-constants';

// ============================================================================
// Types
// ============================================================================

export interface CorrectionEntry {
  id: string;
  timestamp: string;
  what_went_wrong: string;
  correct_approach: string;
}

export interface LearningEntry {
  id: string;
  timestamp: string;
  category: string;
  content: string;
}

// ============================================================================
// Sub-components
// ============================================================================

function ToggleSwitch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex items-center gap-3"
    >
      <div
        className={cn(
          'relative h-5 w-9 rounded-full transition-colors',
          checked ? 'bg-primary' : 'bg-muted-foreground/30',
        )}
      >
        <div
          className={cn(
            'absolute top-0.5 size-4 rounded-full bg-white shadow transition-transform',
            checked ? 'translate-x-4' : 'translate-x-0.5',
          )}
        />
      </div>
      <span className="text-foreground text-sm">{label}</span>
    </button>
  );
}

function formatTimestamp(ts: string): string {
  try {
    return new Date(ts).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return ts;
  }
}

// ============================================================================
// SoulEvolutionTab
// ============================================================================

export interface SoulEvolutionTabProps {
  soul: AgentSoul;
  onChange: (soul: AgentSoul) => void;
  corrections: CorrectionEntry[];
  learnings: LearningEntry[];
}

export function SoulEvolutionTab({
  soul,
  onChange,
  corrections,
  learnings,
}: SoulEvolutionTabProps) {
  const { t } = useLanguage();

  const evo = useMemo(
    () =>
      soul.evolution ?? {
        self_improving: false,
        max_corrections: 50,
        max_learnings: 100,
      },
    [soul.evolution],
  );

  const updateEvolution = useCallback(
    (patch: Partial<NonNullable<AgentSoul['evolution']>>) => {
      onChange({
        ...soul,
        evolution: { ...evo, ...patch },
      });
    },
    [soul, evo, onChange],
  );

  return (
    <div className="space-y-6">
      {/* Self-Improving Toggle */}
      <div>
        <ToggleSwitch
          checked={evo.self_improving}
          onChange={(self_improving) => updateEvolution({ self_improving })}
          label={t.profiles.soulSelfImproving}
        />
        <p className="text-muted-foreground mt-1.5 text-xs">
          {t.profiles.soulSelfImprovingDesc}
        </p>
      </div>

      {/* Limits */}
      <div className="flex gap-4">
        <div className="flex-1">
          <label className={SOUL_LABEL_CLASS}>
            {t.profiles.soulMaxCorrections}
          </label>
          <input
            type="number"
            min={1}
            max={100}
            value={evo.max_corrections}
            onChange={(e) =>
              updateEvolution({
                max_corrections: Math.max(1, parseInt(e.target.value, 10) || 1),
              })
            }
            className={cn(SOUL_INPUT_CLASS, 'w-24')}
          />
        </div>
        <div className="flex-1">
          <label className={SOUL_LABEL_CLASS}>
            {t.profiles.soulMaxLearnings}
          </label>
          <input
            type="number"
            min={1}
            max={100}
            value={evo.max_learnings}
            onChange={(e) =>
              updateEvolution({
                max_learnings: Math.max(1, parseInt(e.target.value, 10) || 1),
              })
            }
            className={cn(SOUL_INPUT_CLASS, 'w-24')}
          />
        </div>
      </div>

      {evo.last_evolved_at && (
        <p className="text-muted-foreground flex items-center gap-1 text-xs">
          <Clock className="size-3" />
          {t.profiles.soulLastEvolved.replace(
            '{date}',
            formatTimestamp(evo.last_evolved_at),
          )}
        </p>
      )}

      {/* Corrections Timeline */}
      <div>
        <div className="mb-2 flex items-center gap-1.5">
          <AlertCircle className="size-3.5 text-amber-400" />
          <label className={SOUL_LABEL_CLASS}>
            {t.profiles.soulCorrections} ({corrections.length})
          </label>
        </div>
        {corrections.length === 0 ? (
          <p className="text-muted-foreground/60 py-3 text-center text-xs">
            {t.profiles.soulNoCorrections}
          </p>
        ) : (
          <div className="border-border max-h-60 space-y-2 overflow-y-auto rounded-lg border p-2">
            {corrections.map((c) => (
              <div
                key={c.id}
                className="bg-muted/30 rounded-lg border border-amber-500/10 p-2.5"
              >
                <div className="text-muted-foreground mb-1 text-[10px]">
                  {formatTimestamp(c.timestamp)}
                </div>
                <div className="mb-1 text-xs">
                  <span className="font-medium text-amber-400">
                    {t.profiles.soulCorrectionIssue}
                  </span>
                  <span className="text-foreground/80">
                    {c.what_went_wrong}
                  </span>
                </div>
                <div className="text-xs">
                  <span className="font-medium text-emerald-400">
                    {t.profiles.soulCorrectionFix}
                  </span>
                  <span className="text-foreground/80">
                    {c.correct_approach}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Learnings */}
      <div>
        <div className="mb-2 flex items-center gap-1.5">
          <BookOpen className="size-3.5 text-blue-400" />
          <label className={SOUL_LABEL_CLASS}>
            {t.profiles.soulLearnings} ({learnings.length})
          </label>
        </div>
        {learnings.length === 0 ? (
          <p className="text-muted-foreground/60 py-3 text-center text-xs">
            {t.profiles.soulNoLearnings}
          </p>
        ) : (
          <div className="border-border max-h-60 space-y-2 overflow-y-auto rounded-lg border p-2">
            {learnings.map((l) => (
              <div key={l.id} className="bg-muted/30 rounded-lg p-2.5">
                <div className="mb-1 flex items-center gap-2">
                  <span className="rounded-md bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-medium text-blue-400">
                    {l.category}
                  </span>
                  <span className="text-muted-foreground text-[10px]">
                    {formatTimestamp(l.timestamp)}
                  </span>
                </div>
                <p className="text-foreground/80 text-xs">{l.content}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
