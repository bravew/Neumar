import { useEffect, useRef } from 'react';

import type { CritiquePhase } from './critique-reducer';
import { DesignJuryTheater } from './theater';
import { useCritiqueStream } from './use-critique-stream';

export type CritiqueRolloutPhase = 'M0' | 'M1' | 'M2' | 'M3' | 'GA';

interface CritiqueTheaterMountProps {
  projectId: string;
  runId: string | null;
  enabled: boolean;
  rolloutPhase?: CritiqueRolloutPhase;
  className?: string;
  onComplete?: (phase: Exclude<CritiquePhase, 'idle' | 'running'>) => void;
}

const TERMINAL_PHASES = new Set<CritiquePhase>([
  'shipped',
  'degraded',
  'interrupted',
  'failed',
]);

export function CritiqueTheaterMount({
  projectId,
  runId,
  enabled,
  rolloutPhase = 'M1',
  className,
  onComplete,
}: CritiqueTheaterMountProps) {
  const shouldRender = Boolean(enabled && runId && rolloutPhase !== 'M0');
  const shouldDarkLaunch = Boolean(
    enabled &&
    runId &&
    rolloutPhase === 'M0' &&
    import.meta.env.VITE_DESIGNMODE_CRITIQUE_DARK_LAUNCH !== '0',
  );
  const completedPhaseRef = useRef<CritiquePhase | null>(null);
  const state = useCritiqueStream(
    projectId,
    shouldRender || shouldDarkLaunch ? runId : null,
    shouldRender || shouldDarkLaunch,
  );

  useEffect(() => {
    if (
      !onComplete ||
      !TERMINAL_PHASES.has(state.phase) ||
      completedPhaseRef.current === state.phase
    ) {
      return;
    }
    completedPhaseRef.current = state.phase;
    onComplete(state.phase as Exclude<CritiquePhase, 'idle' | 'running'>);
  }, [onComplete, state.phase]);

  useEffect(() => {
    completedPhaseRef.current = null;
  }, [runId]);

  if (!shouldRender) return null;

  return (
    <div data-testid="critique-theater-mount" className={className}>
      <DesignJuryTheater state={state} />
    </div>
  );
}
