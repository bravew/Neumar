/**
 * usePermissionRequests — Subscribe to permission_request events from the task event bus.
 *
 * When the agent's canUseTool callback emits a permission_request, this hook
 * captures it via the shared SSE subscription and provides state + respond callback
 * for the PermissionDialog component.
 *
 * Only connects when isRunning is true to avoid idle SSE connections.
 *
 * A run that reaches a prompt ends with a `tool_permission` interrupt while the
 * agent keeps waiting. Once the run is idle, the backend's open interrupts are
 * the record of which prompts are still waiting. Those are answered by
 * resuming the run, so the continuation streams back to this client; the live
 * endpoint would continue the agent without anyone watching.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import type { Interrupt, ResumeEntry } from '@ag-ui/core';

import { API_BASE_URL } from '@/config';

import type { PermissionRequest } from './agent-types';
import { useTaskEventSource } from './useTaskEventSource';

export interface PermissionRequestState extends PermissionRequest {
  resolved?: boolean;
  decision?: 'allow' | 'deny' | 'always_allow';
  /** The run ended at this prompt; it is answered by resuming the run. */
  paused?: boolean;
}

/** The part of the AG-UI agent this hook needs to resume a paused run. */
interface PermissionAgent {
  runAgent: (opts: {
    forwardedProps?: Record<string, unknown>;
    resume?: ResumeEntry[];
  }) => Promise<unknown> | void;
}

const PERMISSION_INTERRUPT_REASON = 'tool_permission';

function isPermissionRequest(value: unknown): value is PermissionRequest {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as PermissionRequest).id === 'string' &&
    typeof (value as PermissionRequest).tool === 'string'
  );
}

function permissionFromInterrupt(interrupt: Interrupt): PermissionRequest[] {
  if (interrupt.reason !== PERMISSION_INTERRUPT_REASON) return [];
  const decision = (
    interrupt.metadata as
      | { decision?: { kind?: string; permission?: unknown } }
      | undefined
  )?.decision;
  return decision?.kind === 'permission' &&
    isPermissionRequest(decision.permission)
    ? [decision.permission]
    : [];
}

/** Prompts the backend says an agent is still waiting on for this task. */
async function fetchOpenPermissions(
  taskId: string,
  signal: AbortSignal,
): Promise<PermissionRequest[]> {
  const res = await fetch(`${API_BASE_URL}/ag-ui/interrupts/${taskId}`, {
    signal,
  });
  if (!res.ok) throw new Error(`Open interrupts request failed: ${res.status}`);
  const data = (await res.json()) as { interrupts?: Interrupt[] };
  return (data.interrupts ?? []).flatMap(permissionFromInterrupt);
}

export function usePermissionRequests(
  taskId: string | undefined,
  isRunning: boolean,
  agent?: PermissionAgent,
) {
  const [permissionRequests, setPermissionRequests] = useState<
    PermissionRequestState[]
  >([]);
  const permissionsRef = useRef(permissionRequests);
  permissionsRef.current = permissionRequests;
  const agentRef = useRef(agent);
  useEffect(() => {
    agentRef.current = agent;
  });
  // Answers resume one run at a time: a second would start while the first is
  // still streaming its continuation.
  const resumeQueueRef = useRef<Promise<unknown>>(Promise.resolve());

  // Reset when task changes
  useEffect(() => {
    setPermissionRequests([]);
  }, [taskId]);

  // Subscribe to task event bus via shared SSE connection
  useTaskEventSource(taskId, isRunning, (msg) => {
    if (msg.type === 'permission_request' && msg.permission) {
      const permission = msg.permission as PermissionRequest;
      setPermissionRequests((prev) => {
        if (prev.some((p) => p.id === permission.id)) return prev;
        return [...prev, permission];
      });
    }
  });

  // The backend's open prompts are the record of what the agent still waits
  // on: those become answerable by resuming the run; the rest are gone.
  const reconcileOpen = useCallback((open: PermissionRequest[]) => {
    const openIds = new Set(open.map((p) => p.id));
    setPermissionRequests((prev) => {
      const known = new Set(prev.map((p) => p.id));
      const current = prev.map((p) => {
        if (p.resolved) return p;
        return openIds.has(p.id)
          ? { ...p, paused: true }
          : { ...p, resolved: true, decision: 'deny' as const };
      });
      const added = open
        .filter((p) => !known.has(p.id))
        .map((p) => ({ ...p, paused: true }));
      return [...current, ...added];
    });
  }, []);

  // An idle task has no live run to answer a prompt in place, so whatever the
  // backend still holds open was left by a run that ended at it. This covers
  // a run ending, a reload, and switching to a task that is waiting.
  useEffect(() => {
    if (isRunning || !taskId) return;
    const ac = new AbortController();
    fetchOpenPermissions(taskId, ac.signal)
      .then((open) => {
        if (!ac.signal.aborted) reconcileOpen(open);
      })
      .catch(() => {
        // A failed read does not mean nothing is waiting: leave the prompts
        // as they are rather than closing one the agent still needs answered.
      });
    return () => ac.abort();
  }, [isRunning, taskId, reconcileOpen]);

  const respond = useCallback(
    async (
      permissionId: string,
      decision: 'allow' | 'deny' | 'always_allow',
    ) => {
      // The agent may forbid a persistent rule for this ask; never send one.
      const request = permissionsRef.current.find((p) => p.id === permissionId);
      const alwaysAllow =
        decision === 'always_allow' &&
        request?.suppress_always_allow_rule !== true;

      const resumable = agentRef.current;
      if (request?.paused && resumable) {
        const mark = (resolved: boolean) =>
          setPermissionRequests((prev) =>
            prev.map((p) =>
              p.id === permissionId
                ? { ...p, resolved, decision: resolved ? decision : undefined }
                : p,
            ),
          );
        // The card closes now: the request below stays open for the whole
        // continuation, which can be as long as the rest of the run.
        mark(true);
        const resumed = resumeQueueRef.current.then(() =>
          resumable.runAgent({
            resume: [
              {
                interruptId: `permission:${permissionId}`,
                status: 'resolved',
                payload: {
                  approved: decision !== 'deny',
                  ...(alwaysAllow ? { alwaysAllow: true } : {}),
                },
              },
            ],
            forwardedProps: { taskId },
          }),
        );
        resumeQueueRef.current = resumed.catch(() => undefined);
        try {
          await resumed;
        } catch {
          // Lost a race (answered elsewhere, expired, or the app restarted).
          // Reopen the card, then let the backend's record settle which it is.
          mark(false);
          if (taskId) {
            try {
              reconcileOpen(
                await fetchOpenPermissions(
                  taskId,
                  new AbortController().signal,
                ),
              );
            } catch {
              // Unknown stays open; the card can be answered again.
            }
          }
        }
        return;
      }

      try {
        await fetch(`${API_BASE_URL}/agent/permission`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            permissionId,
            approved: decision !== 'deny',
            alwaysAllow,
          }),
        });
        setPermissionRequests((prev) =>
          prev.map((p) =>
            p.id === permissionId ? { ...p, resolved: true, decision } : p,
          ),
        );
      } catch {
        // Auto-deny on the backend will handle timeout
      }
    },
    [taskId, reconcileOpen],
  );

  return { permissionRequests, respond };
}
