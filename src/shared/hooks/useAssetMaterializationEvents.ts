import { useEffect, useMemo, useState } from 'react';

import { API_BASE_URL } from '@/config';
import type {
  AssetMaterializationState,
  AssetMaterializeEvent,
} from '@/shared/assets';
import { ASSET_MATERIALIZATION_NOTICE_TTL_MS } from '@/shared/assets/materializationLease';
import { useAssetMaterializationLeaseActive } from '@/shared/hooks/useAssetMaterializationLease';
import { subscribeSharedEventSource } from '@/shared/lib/shared-event-source';

export { ASSET_MATERIALIZATION_NOTICE_TTL_MS };

export type MaterializationStateMap = Record<string, AssetMaterializationState>;
type TrackedMaterializeEvent = Extract<
  AssetMaterializeEvent,
  {
    type:
      | 'materialize.started'
      | 'materialize.progress'
      | 'materialize.complete'
      | 'materialize.error'
      | 'materialize.cancelled';
  }
>;
type TrackedDerivativeEvent = Extract<
  AssetMaterializeEvent,
  {
    type:
      | 'proxy.complete'
      | 'proxy.error'
      | 'artifact.complete'
      | 'artifact.error';
  }
>;
type TrackedAssetEvent = TrackedMaterializeEvent | TrackedDerivativeEvent;

const STATE_PRUNE_INTERVAL_MS = 10_000;

const EVENT_NAMES: TrackedAssetEvent['type'][] = [
  'materialize.started',
  'materialize.progress',
  'materialize.complete',
  'materialize.error',
  'materialize.cancelled',
  'proxy.complete',
  'proxy.error',
  'artifact.complete',
  'artifact.error',
];

/**
 * Live materialization state for `sessionId`.
 *
 * The underlying SSE connection is demand-driven: it exists only while the
 * session holds a lease (see `shared/assets/materializationLease`), so an idle
 * editor tab owns none of the browser's ~6 per-host sockets. Pass `enabled`
 * to override the lease in either direction.
 */
export function useAssetMaterializationEvents(
  sessionId: string | undefined,
  options: { enabled?: boolean } = {},
) {
  const [states, setStates] = useState<MaterializationStateMap>({});
  const leaseActive = useAssetMaterializationLeaseActive(sessionId);
  const enabled = options.enabled ?? leaseActive;

  useEffect(() => {
    if (!enabled || !sessionId || typeof EventSource === 'undefined') return;
    const url = new URL(`${API_BASE_URL}/assets/events`);
    url.searchParams.set('session_id', sessionId);
    // Share one connection across every consumer of this session id (the assets
    // panel and the timeline both subscribe). The pool refcounts and closes the
    // socket once the last consumer unmounts.
    return subscribeSharedEventSource(
      url.toString(),
      EVENT_NAMES,
      (eventName, message) => {
        const parsed = parseMaterializeEvent(
          message.data,
          eventName as TrackedAssetEvent['type'],
        );
        if (!parsed) return;
        setStates((prev) => ({
          ...prev,
          [parsed.assetId]: stateFromEvent(parsed, prev[parsed.assetId]),
        }));
      },
    );
  }, [enabled, sessionId]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const cutoff = Date.now() - ASSET_MATERIALIZATION_NOTICE_TTL_MS;
      setStates((prev) => {
        let changed = false;
        const next: MaterializationStateMap = {};
        for (const [assetId, state] of Object.entries(prev)) {
          if (state.updatedAt >= cutoff) {
            next[assetId] = state;
          } else {
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, STATE_PRUNE_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, []);

  return states;
}

export function useLatestMaterializationState(
  states: MaterializationStateMap,
  assetIds: string[],
): AssetMaterializationState | null {
  return useMemo(() => {
    let latest: AssetMaterializationState | null = null;
    for (const assetId of assetIds) {
      const state = states[assetId];
      if (!state) continue;
      if (!latest || state.updatedAt > latest.updatedAt) latest = state;
    }
    return latest;
  }, [assetIds, states]);
}

function parseMaterializeEvent(
  raw: string,
  expectedType: TrackedAssetEvent['type'],
): TrackedAssetEvent | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isMaterializeEvent(parsed, expectedType) ? parsed : null;
  } catch {
    return null;
  }
}

function isMaterializeEvent(
  value: unknown,
  expectedType: TrackedAssetEvent['type'],
): value is TrackedAssetEvent {
  if (!isRecord(value) || value.type !== expectedType) return false;
  if (
    typeof value.assetId !== 'string' ||
    typeof value.scope !== 'string' ||
    typeof value.scopeId !== 'string'
  ) {
    return false;
  }
  if (value.sessionId !== undefined && typeof value.sessionId !== 'string') {
    return false;
  }
  if (expectedType === 'materialize.progress') {
    return (
      typeof value.bytes === 'number' &&
      (value.total === null || typeof value.total === 'number') &&
      (value.percent === null || typeof value.percent === 'number')
    );
  }
  if (expectedType === 'materialize.complete') {
    return (
      typeof value.materializationId === 'string' &&
      typeof value.cacheHit === 'boolean' &&
      typeof value.bytes === 'number'
    );
  }
  if (expectedType === 'materialize.error') {
    return (
      typeof value.code === 'string' &&
      typeof value.message === 'string' &&
      typeof value.retryable === 'boolean'
    );
  }
  if (expectedType === 'proxy.complete') {
    return typeof value.preset === 'string' && typeof value.url === 'string';
  }
  if (expectedType === 'proxy.error') {
    return (
      typeof value.preset === 'string' &&
      typeof value.message === 'string' &&
      typeof value.retryable === 'boolean'
    );
  }
  if (expectedType === 'artifact.complete') {
    return typeof value.kind === 'string' && typeof value.url === 'string';
  }
  if (expectedType === 'artifact.error') {
    return (
      typeof value.kind === 'string' &&
      typeof value.message === 'string' &&
      typeof value.retryable === 'boolean'
    );
  }
  // `materialize.started` and `materialize.cancelled` carry no
  // type-specific fields beyond the shared base (`assetId` / `scope` /
  // `scopeId` / `sessionId`) validated above, so once we've checked the
  // discriminator the payload is complete.
  return (
    expectedType === 'materialize.started' ||
    expectedType === 'materialize.cancelled'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function stateFromEvent(
  event: TrackedAssetEvent,
  previous: AssetMaterializationState | undefined,
): AssetMaterializationState {
  const base = {
    assetId: event.assetId,
    updatedAt: Date.now(),
  };
  if (event.type === 'materialize.started') {
    return {
      ...base,
      status: 'started',
      bytes: 0,
      total: null,
      percent: null,
      message: null,
      derivative: undefined,
    };
  }
  if (event.type === 'materialize.progress') {
    return {
      ...base,
      status: 'progress',
      bytes: event.bytes,
      total: event.total,
      percent: event.percent,
      message: null,
      derivative: previous?.derivative,
    };
  }
  if (event.type === 'materialize.complete') {
    return {
      ...base,
      status: 'complete',
      bytes: event.bytes,
      total: event.bytes,
      percent: 100,
      message: null,
      derivative: previous?.derivative,
    };
  }
  if (event.type === 'materialize.error') {
    return {
      ...base,
      status: 'error',
      bytes: previous?.bytes ?? 0,
      total: previous?.total ?? null,
      percent: previous?.percent ?? null,
      message: event.message,
      derivative: previous?.derivative,
    };
  }
  if (event.type === 'materialize.cancelled') {
    return {
      ...base,
      status: 'cancelled',
      bytes: previous?.bytes ?? 0,
      total: previous?.total ?? null,
      percent: previous?.percent ?? null,
      message: null,
      derivative: previous?.derivative,
    };
  }

  if (event.type === 'proxy.complete') {
    return derivativeState(base, previous, {
      kind: 'proxy',
      message: null,
      name: event.preset,
      status: 'ready',
    });
  }
  if (event.type === 'proxy.error') {
    return derivativeState(base, previous, {
      kind: 'proxy',
      message: event.message,
      name: event.preset,
      status: 'error',
    });
  }
  if (event.type === 'artifact.complete') {
    return derivativeState(base, previous, {
      kind: 'artifact',
      message: null,
      name: event.kind,
      status: 'ready',
    });
  }
  return derivativeState(base, previous, {
    kind: 'artifact',
    message: event.message,
    name: event.kind,
    status: 'error',
  });
}

function derivativeState(
  base: Pick<AssetMaterializationState, 'assetId' | 'updatedAt'>,
  previous: AssetMaterializationState | undefined,
  derivative: NonNullable<AssetMaterializationState['derivative']>,
): AssetMaterializationState {
  return {
    ...base,
    status: previous?.status ?? 'complete',
    bytes: previous?.bytes ?? 0,
    total: previous?.total ?? null,
    percent: previous?.percent ?? (derivative.status === 'error' ? null : 100),
    message:
      derivative.status === 'error'
        ? derivative.message
        : (previous?.message ?? null),
    derivative,
  };
}
