/**
 * Lightweight shared cache of detected local agent runtimes for model
 * pickers. Unlike `useAgentRuntimes` (Settings-grade: rescan, install/update
 * operations, per-runtime polling), this hook only needs the detection
 * snapshot, so all pickers share one module-level cache and one in-flight
 * request instead of each mounting a fresh polling loop.
 */

import { useEffect, useSyncExternalStore } from 'react';

import {
  listAgentRuntimes,
  type AgentRuntimeStatus,
} from '@/shared/lib/api/agent-runtimes';

const CACHE_TTL_MS = 60_000;

let cachedRuntimes: AgentRuntimeStatus[] = [];
let fetchedAt = 0;
let inflight: Promise<void> | null = null;
let inflightController: AbortController | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      inflightController?.abort();
    }
  };
}

function getSnapshot(): AgentRuntimeStatus[] {
  return cachedRuntimes;
}

function getServerSnapshot(): AgentRuntimeStatus[] {
  return cachedRuntimes;
}

function revalidate(): Promise<void> {
  if (inflight && !inflightController?.signal.aborted) return inflight;

  const controller = new AbortController();
  inflightController = controller;
  const request = listAgentRuntimes(controller.signal)
    .then((data) => {
      if (controller.signal.aborted) return;
      // Defensive: tolerate mocked/older backends that omit `runtimes`.
      cachedRuntimes = Array.isArray(data.runtimes) ? data.runtimes : [];
      fetchedAt = Date.now();
      for (const listener of listeners) listener();
    })
    .catch((error) => {
      if (
        controller.signal.aborted ||
        (error instanceof Error && error.name === 'AbortError')
      )
        return;
      // Detection unavailable (API starting up, offline dev) — keep the last
      // snapshot; pickers degrade to provider-backed options only.
    })
    .finally(() => {
      if (inflight === request) {
        inflight = null;
        inflightController = null;
      }
    });
  inflight = request;
  return request;
}

/** Test-only: reset the module cache between tests. */
export function resetDetectedRuntimesCacheForTest(): void {
  inflightController?.abort();
  cachedRuntimes = [];
  fetchedAt = 0;
  inflight = null;
  inflightController = null;
  listeners.clear();
}

/**
 * Detected agent runtimes, refreshed at most once per minute across all
 * consumers. Returns the last known snapshot immediately (empty on first
 * load) and re-renders when a fresh snapshot lands.
 */
export function useDetectedRuntimes(): AgentRuntimeStatus[] {
  const runtimes = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  useEffect(() => {
    if (Date.now() - fetchedAt > CACHE_TTL_MS) void revalidate();
  }, []);

  return runtimes;
}
