import { AlertTriangle, ArrowRight } from 'lucide-react';

import { useLanguage } from '@/shared/providers/language-provider';

import type { TurnBudgetOutcome } from './useAgentDock';

interface AgentDockTurnBudgetProps {
  outcome: TurnBudgetOutcome | null;
  disabled?: boolean;
  onContinue?: () => void;
}

/**
 * Typed turn budget (P2-5). The run's stop reason is normalized server-side
 * across Claude / Codex / Cursor, so this renders one sentence and — when the
 * run stopped against a ceiling rather than finishing — an explicit continue.
 */
export function AgentDockTurnBudget({
  outcome,
  disabled,
  onContinue,
}: AgentDockTurnBudgetProps) {
  const { t } = useLanguage();
  const b = t.video.editor.agentDock.turnBudget;
  if (!outcome || outcome.reason === 'end_turn') return null;

  const message = (b.reason[outcome.reason] ?? b.reason.unknown).replace(
    '{limit}',
    outcome.limit === undefined ? '—' : String(outcome.limit),
  );

  return (
    <div
      className="border-border bg-muted/40 mx-3 mb-2 flex flex-wrap items-center gap-2 rounded-md border px-2 py-1.5"
      data-testid="agent-turn-budget"
      role="status"
    >
      <AlertTriangle
        className={
          outcome.exhausted
            ? 'text-destructive size-3.5 shrink-0'
            : 'text-muted-foreground size-3.5 shrink-0'
        }
      />
      <span className="text-muted-foreground min-w-0 flex-1 text-[11px]">
        {message}
      </span>
      {outcome.exhausted && onContinue ? (
        <button
          type="button"
          onClick={onContinue}
          disabled={disabled}
          className="border-border text-foreground hover:bg-muted inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] disabled:opacity-60"
        >
          {b.continue}
          <ArrowRight className="size-3" />
        </button>
      ) : null}
    </div>
  );
}
