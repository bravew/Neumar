// One intake tick: read result in, claims and audit out.
//
// `planTick` is pure. `runTick` persists the plan with compare-and-swap and
// only then hands claims to `dispatch`, so a model-backed worker can never
// start before its lease is durable, and a tick that claims nothing never
// calls `dispatch` at all. That is the zero-spend-on-empty-ticks guarantee.

import { DEFAULT_CONFIG } from './config.mjs';
import { decideIssue } from './decide.mjs';
import { isLeaseActive, parseTime } from './state.mjs';

const MAX_CAS_ATTEMPTS = 3;

/**
 * @param {object} prev state before the tick
 * @param {{trigger: 'event'|'cron', deliveryId?: string|null, now: string, runId: string, read: object}} input
 */
export function planTick(prev, input, config = DEFAULT_CONFIG) {
  const nowMs = parseTime(input.now, 'now');
  const nowIso = new Date(nowMs).toISOString();
  const before = prev.watermark?.updatedSince ?? null;
  const audit = [];

  const entry = (extra) => ({
    ts: nowIso,
    trigger: input.trigger,
    deliveryId: input.deliveryId ?? null,
    runId: input.runId,
    issue: null,
    actorAssociation: null,
    decision: 'skip',
    reason: '',
    watermarkBefore: before,
    watermarkAfter: before,
    ...extra,
  });
  const abort = (outcome, detail) => {
    audit.push(
      entry({ decision: 'abort', reason: outcome, ...(detail && { detail }) }),
    );
    return {
      outcome,
      state: prev,
      changed: false,
      claims: [],
      audit,
      watermark: { before, after: before },
    };
  };

  if (prev.disabled) return abort('disabled');
  if (input.deliveryId && prev.seenDeliveries.includes(input.deliveryId)) {
    return abort('duplicate-delivery');
  }

  // A failed or partial read is "unknown", never "empty". Nothing below runs,
  // the delivery id is not recorded (so a redelivery is processed), and the
  // watermark stays where it was.
  const read = input.read;
  if (!read || read.ok !== true || read.complete !== true) {
    return abort(
      'read-failed',
      String(read?.error ?? 'incomplete read').slice(0, 200),
    );
  }
  if (!Array.isArray(read.trustedActors)) {
    return abort('read-failed', 'trusted actors unknown');
  }
  if (input.trigger === 'cron' && Number.isNaN(Date.parse(read.startedAt))) {
    return abort('read-failed', 'read start time missing');
  }

  const next = structuredClone(prev);
  const day = nowIso.slice(0, 10);
  if (next.budget.day !== day) next.budget = { day, claims: 0 };
  if (input.deliveryId) {
    next.seenDeliveries = [...next.seenDeliveries, input.deliveryId].slice(
      -config.deliveryMemory,
    );
  }

  const trusted = new Map(
    read.trustedActors.map((actor) => [
      actor.login.toLowerCase(),
      actor.association,
    ]),
  );
  const deferred = new Set(next.deferred);
  const claims = [];

  for (const issue of [...read.issues].sort((a, b) => a.number - b.number)) {
    const key = String(issue.number);
    const decision = decideIssue(issue, trusted, config);
    const actorAssociation = decision.approval?.association ?? null;
    const record = (kind, reason) =>
      audit.push(
        entry({
          issue: issue.number,
          actorAssociation,
          decision: kind,
          reason,
        }),
      );
    const existing = next.claims[key];

    if (!decision.eligible) {
      deferred.delete(issue.number);
      // Hold, withdrawn approval, reclassification, or close revokes a live
      // claim so the publisher's pre-push verifyClaim fails. A linked PR does
      // not: it is usually the claim holder's own PR.
      if (existing && decision.reason !== 'linked-pr-exists') {
        delete next.claims[key];
        record('revoke', decision.reason);
      } else {
        record('skip', decision.reason);
      }
      continue;
    }

    if (existing && isLeaseActive(existing, nowMs)) {
      deferred.delete(issue.number);
      record('skip', 'already-claimed');
      continue;
    }

    const attempts = next.attempts[key] ?? 0;
    if (attempts >= config.maxAttemptsPerIssue) {
      delete next.claims[key];
      deferred.delete(issue.number);
      record('skip', 'attempts-exhausted');
      continue;
    }

    if (next.budget.claims >= config.maxClaimsPerDay) {
      delete next.claims[key];
      deferred.add(issue.number);
      record('skip', 'daily-budget-exhausted');
      continue;
    }

    next.epoch += 1;
    next.budget.claims += 1;
    next.attempts[key] = attempts + 1;
    const claim = {
      runId: input.runId,
      epoch: next.epoch,
      acquiredAt: nowIso,
      heartbeatAt: nowIso,
      expiresAt: new Date(nowMs + config.leaseTtlMs).toISOString(),
      attempt: attempts + 1,
      approval: { actor: decision.approval.actor, at: decision.approval.at },
    };
    next.claims[key] = claim;
    deferred.delete(issue.number);
    claims.push({ issue: issue.number, ...claim });
    record('claim', existing ? 'lease-expired-reclaimed' : 'eligible');
  }

  next.deferred = [...deferred].sort((a, b) => a - b);

  // Only a complete cron read moves the watermark, and it moves to the time
  // the read began, never to the newest updatedAt it saw. It never moves back.
  let after = before;
  if (input.trigger === 'cron') {
    const started = new Date(read.startedAt).toISOString();
    after = before !== null && before > started ? before : started;
    next.watermark = { updatedSince: after, tickAt: nowIso };
  }
  if (audit.length === 0) audit.push(entry({ reason: 'no-candidates' }));
  for (const item of audit) item.watermarkAfter = after;

  return {
    outcome: 'ok',
    state: next,
    changed: JSON.stringify(next) !== JSON.stringify(prev),
    claims,
    audit,
    watermark: { before, after },
  };
}

/**
 * Read state, plan, persist with compare-and-swap, then dispatch. A lost swap
 * means another tick changed the state after this tick's issue read, so that
 * read can no longer vouch for it: an approval it shows may have been withdrawn
 * by the winning tick. A retry therefore needs `refreshRead`, a callback that
 * returns a new issue read, taken after the state was re-read. Without one, or
 * when the fresh read is unusable, the tick fails closed with no claim; the
 * delivery id is not recorded, so a redelivery or the next cron tick retries.
 * Contention that outlasts the retries also fails closed with no claim.
 */
export async function runTick({
  store,
  dispatch,
  config = DEFAULT_CONFIG,
  refreshRead,
  ...input
}) {
  let before = null;
  let current = input;
  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
    const { state, version } = await store.read();
    before = state.watermark?.updatedSince ?? null;

    if (attempt > 0) {
      // Read the state first, then the issues: the issue read is then at least
      // as new as the state it is planned against.
      let fresh = null;
      if (typeof refreshRead === 'function') {
        try {
          fresh = await refreshRead();
        } catch (error) {
          fresh = { ok: false, complete: false, error: error?.message };
        }
      }
      if (!fresh) return failClosed('stale-read', attempt, before, input);
      current = { ...input, read: fresh };
    }

    const plan = planTick(state, current, config);

    if (plan.changed) {
      const written = await store.compareAndSwap(version, plan.state);
      if (!written.ok) continue;
    }

    const dispatched = [];
    for (const claim of plan.claims) {
      try {
        await dispatch?.(claim);
        dispatched.push(claim.issue);
      } catch {
        // The lease stays and expires on its own: fail closed, count the attempt.
        const claimed = plan.audit.find((item) => item.issue === claim.issue);
        plan.audit.push({
          ...claimed,
          decision: 'abort',
          reason: 'dispatch-failed',
        });
      }
    }
    return { ...plan, dispatched, casRetries: attempt };
  }

  return failClosed('store-contention', MAX_CAS_ATTEMPTS, before, input);
}

function failClosed(outcome, casRetries, before, input) {
  return {
    outcome,
    changed: false,
    claims: [],
    dispatched: [],
    casRetries,
    watermark: { before, after: before },
    audit: [
      {
        ts: new Date(parseTime(input.now, 'now')).toISOString(),
        trigger: input.trigger,
        deliveryId: input.deliveryId ?? null,
        runId: input.runId,
        issue: null,
        actorAssociation: null,
        decision: 'abort',
        reason: outcome,
        watermarkBefore: before,
        watermarkAfter: before,
      },
    ],
  };
}
