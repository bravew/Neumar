import type { RoundState } from '../critique-reducer';

export function JuryRoundSummary({
  round,
  label,
}: {
  round: RoundState;
  label: string;
}) {
  if (!round.aggregate) return null;
  return (
    <div className="bg-surface-warm text-fg-2 mt-3 rounded-md border px-3 py-2 text-xs">
      {label
        .replace('{round}', String(round.round))
        .replace('{score}', String(round.aggregate.avgScore))
        .replace('{mustFix}', String(round.aggregate.mustFix))
        .replace('{quickWins}', String(round.aggregate.quickWins))}
    </div>
  );
}
