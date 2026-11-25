// Operator entry point for the read-only rehearsal.
//
//   node scripts/issue-monitor/cli.mjs collect --repo owner/name [--since ISO]
//        [--follow 12,14] [--all] > snapshot.json
//   node scripts/issue-monitor/cli.mjs rehearse --snapshot a.json [--snapshot b.json]
//
// `collect` runs GET-only `gh api` calls (it needs `gh` authenticated with a
// read-only token) and prints one snapshot to stdout. `rehearse` is offline:
// it reads snapshot files, runs the real intake tick against an empty
// in-memory state, and prints what it would decide. It writes no file, no
// state, and nothing to GitHub, and it never starts a worker.

import { collectSnapshot, createGhRunner } from './collect.mjs';
import { emptyState } from './state.mjs';
import { planTick } from './tick.mjs';

import { readFileSync } from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

function usage() {
  return [
    'Usage:',
    '  cli.mjs collect --repo owner/name [--since ISO] [--follow 1,2] [--all]',
    '  cli.mjs rehearse --snapshot FILE [--snapshot FILE ...] [--json]',
  ].join('\n');
}

/** Run the intake tick over snapshots in order, carrying state in memory. */
export function rehearse(snapshots) {
  let state = emptyState();
  return snapshots.map((snapshot, index) => {
    const plan = planTick(state, {
      trigger: 'cron',
      deliveryId: null,
      now: snapshot.startedAt,
      runId: `rehearsal-${index + 1}`,
      read: snapshot,
    });
    state = plan.state;
    return {
      tick: index + 1,
      outcome: plan.outcome,
      watermark: plan.watermark,
      wouldClaim: plan.claims.map((claim) => claim.issue),
      audit: plan.audit,
    };
  });
}

export function formatRehearsal(ticks) {
  const lines = [];
  for (const tick of ticks) {
    lines.push(
      `tick ${tick.tick}: ${tick.outcome}, watermark ${tick.watermark.before ?? 'none'} -> ${tick.watermark.after ?? 'none'}`,
    );
    for (const item of tick.audit) {
      const subject = item.issue === null ? '(tick)' : `#${item.issue}`;
      lines.push(`  ${subject}  ${item.decision}  ${item.reason}`);
    }
    lines.push(
      tick.wouldClaim.length > 0
        ? `  would claim: ${tick.wouldClaim.map((n) => `#${n}`).join(', ')} (simulated, nothing is claimed anywhere)`
        : '  would claim: none',
    );
  }
  lines.push('model calls: 0');
  lines.push('mutations: none (offline, no GitHub, file, or state writes)');
  return lines.join('\n');
}

async function main(argv) {
  const [command, ...rest] = argv;

  if (command === 'collect') {
    const { values } = parseArgs({
      args: rest,
      options: {
        repo: { type: 'string' },
        since: { type: 'string' },
        follow: { type: 'string' },
        all: { type: 'boolean', default: false },
      },
    });
    const [owner, name, extra] = (values.repo ?? '').split('/');
    if (!owner || !name || extra !== undefined) {
      console.error(usage());
      return 1;
    }
    const snapshot = await collectSnapshot({
      gh: createGhRunner(),
      repo: { owner, name },
      since: values.since ?? null,
      numbers: values.follow ? values.follow.split(',').map(Number) : [],
      approvedOnly: !values.all,
    });
    console.log(JSON.stringify(snapshot, null, 2));
    return snapshot.ok ? 0 : 1;
  }

  if (command === 'rehearse') {
    const { values } = parseArgs({
      args: rest,
      options: {
        snapshot: { type: 'string', multiple: true },
        json: { type: 'boolean', default: false },
      },
    });
    if (!values.snapshot?.length) {
      console.error(usage());
      return 1;
    }
    const snapshots = values.snapshot.map((file) =>
      JSON.parse(readFileSync(file, 'utf-8')),
    );
    const ticks = rehearse(snapshots);
    console.log(
      values.json ? JSON.stringify(ticks, null, 2) : formatRehearsal(ticks),
    );
    // A failed read is reported, not hidden, and fails the command.
    return ticks.every((tick) => tick.outcome === 'ok') ? 0 : 1;
  }

  console.error(usage());
  return 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    },
  );
}
