import fs from 'node:fs/promises';

import { resolveProjectPath } from '../fs';
import type { CritiqueArtifactRef } from '../types';
import type { DESIGN_JURY_PROTOCOL_VERSION } from './protocol';

export type PanelEvent =
  | {
      type: 'run_started';
      runId: string;
      protocolVersion: typeof DESIGN_JURY_PROTOCOL_VERSION;
      roles: string[];
      startedAt: string;
    }
  | { type: 'panelist_open'; runId: string; round: number; role: string }
  | {
      type: 'panelist_dim';
      runId: string;
      round: number;
      role: string;
      rating: number;
    }
  | {
      type: 'panelist_must_fix';
      runId: string;
      round: number;
      role: string;
      itemId: string;
      body: string;
    }
  | { type: 'panelist_close'; runId: string; round: number; role: string }
  | {
      type: 'round_end';
      runId: string;
      round: number;
      aggregate: { mustFix: number; quickWins: number; avgScore: number };
    }
  | {
      type: 'parser_warning';
      runId: string;
      round: number | null;
      warning: string;
    }
  | { type: 'shipped'; runId: string; artifactRef?: CritiqueArtifactRef }
  | { type: 'degraded'; runId: string; reason: string }
  | { type: 'interrupted'; runId: string }
  | { type: 'failed'; runId: string; error: string };

export type PanelEventListener = (event: PanelEvent) => void;

const subscribers = new Map<string, Set<PanelEventListener>>();

function keyFor(projectId: string, runId: string) {
  return `${projectId}|${runId}`;
}

export function subscribeDesignJuryEvents(
  projectId: string,
  runId: string,
  listener: PanelEventListener,
) {
  const key = keyFor(projectId, runId);
  const listeners = subscribers.get(key) ?? new Set<PanelEventListener>();
  listeners.add(listener);
  subscribers.set(key, listeners);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) subscribers.delete(key);
  };
}

export function publishDesignJuryEvent(projectId: string, event: PanelEvent) {
  const listeners = subscribers.get(keyFor(projectId, event.runId));
  if (!listeners) return;
  for (const listener of [...listeners]) listener(event);
}

export async function readDesignJuryPanelEvents(
  projectId: string,
  runId: string,
): Promise<PanelEvent[]> {
  const raw = await fs.readFile(
    resolveProjectPath(projectId, `critique/${runId}/transcript.json`)
      .absolutePath,
    'utf-8',
  );
  const parsed = JSON.parse(raw) as { events?: unknown[] };
  return (parsed.events ?? []).filter(isPanelEvent);
}

export function isTerminalPanelEvent(event: PanelEvent) {
  return (
    event.type === 'shipped' ||
    event.type === 'degraded' ||
    event.type === 'interrupted' ||
    event.type === 'failed'
  );
}

export function isPanelEvent(value: unknown): value is PanelEvent {
  if (!value || typeof value !== 'object') return false;
  const event = value as { type?: unknown; runId?: unknown };
  return typeof event.type === 'string' && typeof event.runId === 'string';
}

export function clearDesignJuryEventSubscribersForTest() {
  subscribers.clear();
}
