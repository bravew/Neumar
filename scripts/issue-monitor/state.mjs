// Durable-state contract: shape, pure transitions, and the compare-and-swap
// store interface.
//
// Production keeps this document on a dedicated state branch and swaps it with
// the Contents API using the blob sha as the version (see the runbook). The
// in-memory store below has the same semantics and backs the replay tests.

import { DEFAULT_CONFIG } from './config.mjs';

export const STATE_VERSION = 1;

export function emptyState() {
  return {
    version: STATE_VERSION,
    // Kill switch. While true no tick claims and no heartbeat succeeds.
    disabled: false,
    // Cron reconciliation read-start time. Event ticks never move it.
    watermark: null,
    // Monotonic fencing counter. Each claim gets a fresh epoch.
    epoch: 0,
    claims: {},
    attempts: {},
    // Eligible issues skipped for budget. Re-read even when GitHub shows no
    // update, otherwise the watermark would pass them by.
    deferred: [],
    budget: { day: null, claims: 0 },
    seenDeliveries: [],
  };
}

export function parseTime(value, name) {
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) {
    throw new TypeError(`issue-monitor ${name} is not a valid timestamp`);
  }
  return ms;
}

/** Lower bound for the next cron window, or null before the first run. */
export function pollSince(state, config = DEFAULT_CONFIG) {
  if (!state.watermark) return null;
  const since =
    parseTime(state.watermark.updatedSince, 'watermark') - config.overlapMs;
  return new Date(since).toISOString();
}

/**
 * Issues a read must include regardless of their update time: held leases
 * (so a crashed worker's expired lease is noticed) and deferred work.
 */
export function followUpNumbers(state) {
  return [
    ...new Set([...Object.keys(state.claims).map(Number), ...state.deferred]),
  ].sort((a, b) => a - b);
}

export function isLeaseActive(claim, nowMs) {
  return Date.parse(claim.expiresAt) > nowMs;
}

/** What #362's publisher must call immediately before every push. */
export function verifyClaim(state, { issue, runId, epoch }, now) {
  if (state.disabled) return { ok: false, reason: 'disabled' };
  const claim = state.claims[String(issue)];
  if (!claim) return { ok: false, reason: 'no-claim' };
  if (claim.runId !== runId || claim.epoch !== epoch) {
    return { ok: false, reason: 'claim-superseded' };
  }
  if (!isLeaseActive(claim, parseTime(now, 'now'))) {
    return { ok: false, reason: 'lease-expired' };
  }
  return { ok: true, reason: 'ok', claim };
}

export function heartbeat(state, ref, now, config = DEFAULT_CONFIG) {
  const verdict = verifyClaim(state, ref, now);
  if (!verdict.ok) return { ok: false, reason: verdict.reason, state };
  const next = structuredClone(state);
  const at = parseTime(now, 'now');
  const claim = next.claims[String(ref.issue)];
  claim.heartbeatAt = new Date(at).toISOString();
  claim.expiresAt = new Date(at + config.leaseTtlMs).toISOString();
  return { ok: true, reason: 'ok', state: next };
}

/** The owner gives a claim back. Works while disabled so workers can stand down. */
export function release(state, { issue, runId, epoch }) {
  const claim = state.claims[String(issue)];
  if (!claim || claim.runId !== runId || claim.epoch !== epoch) {
    return { ok: false, reason: 'not-owner', state };
  }
  const next = structuredClone(state);
  delete next.claims[String(issue)];
  return { ok: true, reason: 'ok', state: next };
}

export function setDisabled(state, disabled) {
  return { ...structuredClone(state), disabled };
}

/** Resuming is refused while any lease is still live: reconcile first. */
export function resume(state, now) {
  const nowMs = parseTime(now, 'now');
  const active = Object.entries(state.claims)
    .filter(([, claim]) => isLeaseActive(claim, nowMs))
    .map(([issue]) => Number(issue))
    .sort((a, b) => a - b);
  if (active.length > 0) {
    return { ok: false, reason: 'active-claims', issues: active, state };
  }
  return {
    ok: true,
    reason: 'ok',
    issues: [],
    state: setDisabled(state, false),
  };
}

/** Compare-and-swap store with the semantics the GitHub binding must keep. */
export class InMemoryStore {
  #state;
  #version = 0;

  constructor(initial = emptyState()) {
    this.#state = structuredClone(initial);
  }

  async read() {
    await Promise.resolve();
    return { state: structuredClone(this.#state), version: this.#version };
  }

  async compareAndSwap(expectedVersion, next) {
    await Promise.resolve();
    if (expectedVersion !== this.#version) return { ok: false };
    this.#state = structuredClone(next);
    this.#version += 1;
    return { ok: true, version: this.#version };
  }

  get snapshot() {
    return structuredClone(this.#state);
  }
}
