/**
 * usePermissionRequests — Subscribe to permission_request events from the task event bus.
 *
 * When the agent's canUseTool callback emits a permission_request, this hook
 * captures it via the shared SSE subscription and provides state + respond callback
 * for the PermissionDialog component.
 *
 * Only connects when isRunning is true to avoid idle SSE connections.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { API_BASE_URL } from '@/config';

import type { PermissionRequest } from './agent-types';
import { useTaskEventSource } from './useTaskEventSource';

export interface PermissionRequestState extends PermissionRequest {
  resolved?: boolean;
  decision?: 'allow' | 'deny' | 'always_allow';
}

export function usePermissionRequests(
  taskId: string | undefined,
  isRunning: boolean,
) {
  const [permissionRequests, setPermissionRequests] = useState<
    PermissionRequestState[]
  >([]);
  const permissionsRef = useRef(permissionRequests);
  permissionsRef.current = permissionRequests;
  const wasRunningRef = useRef(false);

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

  // When run ends, deny any unresolved permissions on the backend and update UI
  useEffect(() => {
    if (isRunning) {
      wasRunningRef.current = true;
      return;
    }
    if (!wasRunningRef.current) return;
    wasRunningRef.current = false;

    const unresolved = permissionsRef.current.filter((p) => !p.resolved);
    for (const perm of unresolved) {
      fetch(`${API_BASE_URL}/agent/permission`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          permissionId: perm.id,
          approved: false,
        }),
      }).catch(() => {
        // Backend TTL will clean up if POST fails
      });
    }
    if (unresolved.length > 0) {
      setPermissionRequests((prev) =>
        prev.map((p) =>
          p.resolved ? p : { ...p, resolved: true, decision: 'deny' as const },
        ),
      );
    }
  }, [isRunning]);

  const respond = useCallback(
    async (
      permissionId: string,
      decision: 'allow' | 'deny' | 'always_allow',
    ) => {
      try {
        await fetch(`${API_BASE_URL}/agent/permission`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            permissionId,
            approved: decision !== 'deny',
            alwaysAllow: decision === 'always_allow',
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
    [],
  );

  return { permissionRequests, respond };
}
