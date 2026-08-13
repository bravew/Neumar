import type {
  CritiqueArtifactRef,
  PanelEvent,
} from '@/shared/types/design-mode';

export type CritiquePhase =
  | 'idle'
  | 'running'
  | 'shipped'
  | 'degraded'
  | 'interrupted'
  | 'failed';

export interface JuryMustFixItem {
  id: string;
  body: string;
}

export interface PanelistView {
  role: string;
  round: number;
  status: 'open' | 'dimmed' | 'closed';
  rating: number | null;
  mustFix: JuryMustFixItem[];
}

export interface RoundState {
  round: number;
  panelists: Record<string, PanelistView>;
  aggregate: { mustFix: number; quickWins: number; avgScore: number } | null;
}

export interface CritiqueState {
  runId: string | null;
  phase: CritiquePhase;
  protocolVersion: 'design-jury.v1' | null;
  roles: string[];
  startedAt: string | null;
  rounds: Record<number, RoundState>;
  panelists: Record<string, PanelistView>;
  parserWarnings: string[];
  artifactRef?: CritiqueArtifactRef;
  degradedReason?: string;
  error?: string;
}

export const initialCritiqueState: CritiqueState = {
  runId: null,
  phase: 'idle',
  protocolVersion: null,
  roles: [],
  startedAt: null,
  rounds: {},
  panelists: {},
  parserWarnings: [],
};

const TERMINAL_PHASES = new Set<CritiquePhase>([
  'shipped',
  'degraded',
  'interrupted',
  'failed',
]);

export function critiqueReducer(
  state: CritiqueState,
  event: PanelEvent,
): CritiqueState {
  if (event.type === 'run_started') {
    return {
      ...initialCritiqueState,
      runId: event.runId,
      phase: 'running',
      protocolVersion: event.protocolVersion,
      roles: event.roles,
      startedAt: event.startedAt,
    };
  }

  if (!state.runId || event.runId !== state.runId) return state;

  if (isTerminal(state.phase) && event.type !== 'parser_warning') {
    return state;
  }

  if (event.type === 'parser_warning') {
    return {
      ...state,
      parserWarnings: [...state.parserWarnings, event.warning],
    };
  }

  if (event.type === 'panelist_open') {
    return updatePanelist(state, event.round, event.role, (panelist) => ({
      ...panelist,
      status: 'open',
    }));
  }

  if (event.type === 'panelist_dim') {
    return updatePanelist(state, event.round, event.role, (panelist) => ({
      ...panelist,
      status: 'dimmed',
      rating: event.rating,
    }));
  }

  if (event.type === 'panelist_must_fix') {
    return updatePanelist(state, event.round, event.role, (panelist) => ({
      ...panelist,
      mustFix: [...panelist.mustFix, { id: event.itemId, body: event.body }],
    }));
  }

  if (event.type === 'panelist_close') {
    return updatePanelist(state, event.round, event.role, (panelist) => ({
      ...panelist,
      status: 'closed',
    }));
  }

  if (event.type === 'round_end') {
    const round = getRound(state, event.round);
    return {
      ...state,
      rounds: {
        ...state.rounds,
        [event.round]: { ...round, aggregate: event.aggregate },
      },
    };
  }

  if (event.type === 'shipped') {
    return { ...state, phase: 'shipped', artifactRef: event.artifactRef };
  }

  if (event.type === 'degraded') {
    return { ...state, phase: 'degraded', degradedReason: event.reason };
  }

  if (event.type === 'interrupted') {
    return { ...state, phase: 'interrupted' };
  }

  if (event.type === 'failed') {
    return { ...state, phase: 'failed', error: event.error };
  }

  event satisfies never;
  return state;
}

export function reduceCritiqueEvents(
  events: Iterable<PanelEvent>,
  initial = initialCritiqueState,
) {
  let state = initial;
  for (const event of events) state = critiqueReducer(state, event);
  return state;
}

function updatePanelist(
  state: CritiqueState,
  roundNumber: number,
  role: string,
  update: (panelist: PanelistView) => PanelistView,
) {
  const round = getRound(state, roundNumber);
  const panelist = update(
    round.panelists[role] ?? {
      role,
      round: roundNumber,
      status: 'open',
      rating: null,
      mustFix: [],
    },
  );
  const panelistKey = `${roundNumber}:${role}`;
  return {
    ...state,
    rounds: {
      ...state.rounds,
      [roundNumber]: {
        ...round,
        panelists: { ...round.panelists, [role]: panelist },
      },
    },
    panelists: { ...state.panelists, [panelistKey]: panelist },
  };
}

function getRound(state: CritiqueState, round: number): RoundState {
  return (
    state.rounds[round] ?? {
      round,
      panelists: {},
      aggregate: null,
    }
  );
}

function isTerminal(phase: CritiquePhase) {
  return TERMINAL_PHASES.has(phase);
}
