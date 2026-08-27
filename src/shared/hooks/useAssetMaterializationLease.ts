import { useCallback, useEffect, useSyncExternalStore } from 'react';

import {
  acquireAssetMaterializationLease,
  isAssetMaterializationLeaseActive,
  subscribeAssetMaterializationLeases,
} from '@/shared/assets/materializationLease';

/** True while any holder has an open lease on `sessionId`. */
export function useAssetMaterializationLeaseActive(
  sessionId: string | undefined,
): boolean {
  const getSnapshot = useCallback(
    () => isAssetMaterializationLeaseActive(sessionId),
    [sessionId],
  );
  return useSyncExternalStore(
    subscribeAssetMaterializationLeases,
    getSnapshot,
    getSnapshot,
  );
}

/**
 * Holds a lease for as long as `active` is true. Use this for state the
 * component can already see — a project asset stuck in `hydrating` after a
 * reload, say. Operations that start and finish inside one async handler
 * should call `acquireAssetMaterializationLease` directly instead.
 */
export function useAssetMaterializationLease(
  sessionId: string | undefined,
  active: boolean,
): void {
  useEffect(() => {
    if (!active) return;
    return acquireAssetMaterializationLease(sessionId);
  }, [active, sessionId]);
}
