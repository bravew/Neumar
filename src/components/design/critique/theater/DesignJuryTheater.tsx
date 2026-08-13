import { useLanguage } from '@/shared/providers/language-provider';

import type { CritiqueState } from '../critique-reducer';
import { JuryStage } from './JuryStage';
import { JuryTerminalBanner } from './JuryTerminalBanner';

export function DesignJuryTheater({ state }: { state: CritiqueState }) {
  const { t } = useLanguage();
  const labels = {
    region: t.design.designJuryTheaterLabel,
    round: t.design.designJuryRound,
    score: t.design.designJuryScore,
    mustFix: t.design.designJuryMustFix,
    roundSummary: t.design.designJuryRoundSummary,
    roles: t.design.designJuryRoles,
  };

  return (
    <div className="space-y-3" aria-live="polite">
      <JuryTerminalBanner
        state={state}
        labels={{
          shipped: t.design.designJuryShipped,
          degraded: t.design.designJuryDegraded,
          interrupted: t.design.designJuryInterrupted,
          failed: t.design.designJuryFailed,
        }}
      />
      <JuryStage state={state} labels={labels} />
      {state.parserWarnings.length > 0 && (
        <div className="border-warn/30 bg-warn/10 rounded-md border p-2 text-xs">
          <p className="font-medium">{t.design.designJuryWarnings}</p>
          <ul className="mt-1 list-disc space-y-1 pl-4">
            {state.parserWarnings.map((warning, index) => (
              <li key={`${warning}-${index}`}>{warning}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
