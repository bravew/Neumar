// Replays a scenario fixture through the real tick and state functions.
//
// A scenario names its issues once, then each tick selects them by name. A
// tick is either an intake tick or an `op` against the claim state (heartbeat,
// verify, release, disable, resume). The trace is what the tests assert on.

import { resolveConfig } from './config.mjs';
import {
  emptyState,
  followUpNumbers,
  heartbeat,
  InMemoryStore,
  release,
  resume,
  setDisabled,
  verifyClaim,
} from './state.mjs';
import { runTick } from './tick.mjs';

function resolveRead(scenario, tick) {
  const read = tick.read;
  if (!read.ok) return read;
  return {
    trustedActors: scenario.trustedActors,
    startedAt: tick.now,
    ...read,
    issues: read.issues.map((name) => {
      const issue = scenario.issues[name];
      if (!issue) throw new Error(`scenario references unknown issue ${name}`);
      return issue;
    }),
  };
}

async function applyOp(store, tick) {
  const { state, version } = await store.read();
  const ref = { issue: tick.issue, runId: tick.runId, epoch: tick.epoch };
  const config = resolveConfig(tick.config);
  const results = {
    verify: () => verifyClaim(state, ref, tick.now),
    heartbeat: () => heartbeat(state, ref, tick.now, config),
    release: () => release(state, ref),
    disable: () => ({
      ok: true,
      reason: 'ok',
      state: setDisabled(state, true),
    }),
    resume: () => resume(state, tick.now),
  };
  const run = results[tick.op];
  if (!run) throw new Error(`unknown scenario op ${tick.op}`);
  const outcome = run();
  if (outcome.state && outcome.state !== state) {
    const written = await store.compareAndSwap(version, outcome.state);
    if (!written.ok) throw new Error('scenario op lost its swap');
  }
  return {
    op: tick.op,
    ok: outcome.ok,
    reason: outcome.reason,
    ...(outcome.issues && { issues: outcome.issues }),
  };
}

export async function replayScenario(scenario) {
  const config = resolveConfig(scenario.config);
  const store = new InMemoryStore({
    ...emptyState(),
    ...scenario.initialState,
  });
  const trace = [];

  for (const tick of scenario.ticks) {
    if (tick.op) {
      trace.push(await applyOp(store, { config: scenario.config, ...tick }));
      continue;
    }
    const dispatched = [];
    const result = await runTick({
      store,
      config,
      trigger: tick.trigger,
      deliveryId: tick.deliveryId ?? null,
      now: tick.now,
      runId: tick.runId,
      read: resolveRead(scenario, tick),
      dispatch: async (claim) => {
        if (tick.dispatchFails) throw new Error('dispatch failed');
        dispatched.push(claim.issue);
      },
    });
    const forIssues = result.audit.filter((item) => item.issue !== null);
    trace.push({
      outcome: result.outcome,
      claims: result.claims.map((claim) => claim.issue),
      dispatched,
      decisions: Object.fromEntries(
        forIssues.map((item) => [String(item.issue), item.reason]),
      ),
      revoked: forIssues
        .filter((item) => item.decision === 'revoke')
        .map((item) => item.issue),
      attempts: Object.fromEntries(
        result.claims.map((claim) => [String(claim.issue), claim.attempt]),
      ),
      watermarkBefore: result.watermark.before,
      watermarkAfter: result.watermark.after,
      followUps: followUpNumbers(store.snapshot),
      audit: result.audit,
    });
  }

  const finalState = store.snapshot;
  return { trace, finalState, followUps: followUpNumbers(finalState) };
}
