import type { CritiqueState } from '../critique-reducer';

export function JuryTerminalBanner({
  state,
  labels,
}: {
  state: CritiqueState;
  labels: Record<'shipped' | 'degraded' | 'interrupted' | 'failed', string>;
}) {
  if (
    state.phase !== 'shipped' &&
    state.phase !== 'degraded' &&
    state.phase !== 'interrupted' &&
    state.phase !== 'failed'
  ) {
    return null;
  }

  const detail =
    state.phase === 'degraded'
      ? state.degradedReason
      : state.phase === 'failed'
        ? state.error
        : undefined;

  return (
    <div className="border-accent/30 bg-accent/10 text-fg rounded-md border px-3 py-2 text-xs">
      <p className="font-medium">{labels[state.phase]}</p>
      {detail && <p className="text-muted-foreground mt-1">{detail}</p>}
    </div>
  );
}
