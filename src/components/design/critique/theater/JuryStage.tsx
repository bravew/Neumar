import type { CritiqueState } from '../critique-reducer';
import { JuryPanelistCard } from './JuryPanelistCard';
import { JuryRoundSummary } from './JuryRoundSummary';

export function JuryStage({
  state,
  labels,
}: {
  state: CritiqueState;
  labels: {
    region: string;
    round: string;
    score: string;
    mustFix: string;
    roundSummary: string;
    roles: Record<string, string>;
  };
}) {
  const rounds = Object.values(state.rounds).sort(
    (left, right) => left.round - right.round,
  );
  if (rounds.length === 0) return null;

  return (
    <div role="region" aria-label={labels.region} className="space-y-3">
      {rounds.map((round) => (
        <section key={round.round} className="space-y-2">
          <h4 className="text-muted-foreground text-xs font-medium">
            {labels.round.replace('{round}', String(round.round))}
          </h4>
          <div className="grid gap-2">
            {Object.values(round.panelists).map((panelist) => (
              <JuryPanelistCard
                key={`${round.round}:${panelist.role}`}
                panelist={panelist}
                roleLabel={labels.roles[panelist.role] ?? panelist.role}
                scoreLabel={labels.score}
                mustFixLabel={labels.mustFix}
              />
            ))}
          </div>
          <JuryRoundSummary round={round} label={labels.roundSummary} />
        </section>
      ))}
    </div>
  );
}
