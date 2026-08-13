export type DesignJuryRunStatus =
  | 'running'
  | 'interrupted'
  | 'complete'
  | 'failed';

export interface DesignJuryRunHandle {
  projectId: string;
  runId: string;
  controller: AbortController;
  status: DesignJuryRunStatus;
  startedAt: string;
  lastEventAt: string;
}

const handles = new Map<string, DesignJuryRunHandle>();

function keyFor(projectId: string, runId: string) {
  return `${projectId}|${runId}`;
}

export function registerDesignJuryRun(
  projectId: string,
  runId: string,
  controller = new AbortController(),
): DesignJuryRunHandle {
  const now = new Date().toISOString();
  const handle: DesignJuryRunHandle = {
    projectId,
    runId,
    controller,
    status: 'running',
    startedAt: now,
    lastEventAt: now,
  };
  handles.set(keyFor(projectId, runId), handle);
  return handle;
}

export function getDesignJuryRunHandle(projectId: string, runId: string) {
  return handles.get(keyFor(projectId, runId)) ?? null;
}

export function findDesignJuryRunHandle(runId: string) {
  return [...handles.values()].find((handle) => handle.runId === runId) ?? null;
}

export function markDesignJuryRunHandle(
  projectId: string,
  runId: string,
  status: Exclude<DesignJuryRunStatus, 'running'>,
) {
  const handle = getDesignJuryRunHandle(projectId, runId);
  if (!handle) return null;
  handle.status = status;
  handle.lastEventAt = new Date().toISOString();
  handles.delete(keyFor(projectId, runId));
  return handle;
}

export function interruptDesignJuryRunHandle(projectId: string, runId: string) {
  const handle = getDesignJuryRunHandle(projectId, runId);
  if (!handle) return null;
  if (handle.status === 'running') {
    handle.controller.abort();
    handle.status = 'interrupted';
    handle.lastEventAt = new Date().toISOString();
    handles.delete(keyFor(projectId, runId));
  }
  return handle;
}

export function clearDesignJuryRunRegistryForTest() {
  handles.clear();
}
