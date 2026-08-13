import type { RunMode } from '@/core/agent/runtime-state';

import type { ReattachRunContext } from './reattach';

export interface ActiveAGUIRun {
  mode: RunMode;
  ownerKey: string;
  runId: string;
  busKey: string;
  controller: AbortController;
  reattach?: ReattachRunContext;
}

const activeRuns = new Map<string, ActiveAGUIRun>();

function runKey(mode: RunMode, ownerKey: string, runId: string): string {
  return `${mode}:${ownerKey}:${runId}`;
}

export function registerActiveAGUIRun(run: ActiveAGUIRun): () => void {
  const key = runKey(run.mode, run.ownerKey, run.runId);
  activeRuns.set(key, run);
  return () => {
    if (activeRuns.get(key) === run) activeRuns.delete(key);
  };
}

export function getActiveAGUIRun(
  mode: RunMode,
  ownerKey: string,
  runId: string,
): ActiveAGUIRun | undefined {
  return activeRuns.get(runKey(mode, ownerKey, runId));
}

export function cancelActiveAGUIRun(
  mode: RunMode,
  ownerKey: string,
  runId: string,
): boolean {
  const run = getActiveAGUIRun(mode, ownerKey, runId);
  if (!run) return false;
  run.controller.abort();
  activeRuns.delete(runKey(mode, ownerKey, runId));
  return true;
}

export function findActiveAGUIRun(
  mode: RunMode,
  ownerKey: string,
): ActiveAGUIRun | undefined {
  for (const run of activeRuns.values()) {
    if (run.mode === mode && run.ownerKey === ownerKey) return run;
  }
  return undefined;
}
