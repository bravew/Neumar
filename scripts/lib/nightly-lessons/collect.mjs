/**
 * Range collector and detectors for the nightly lessons review.
 *
 * `collectRange` reads the first-parent commits after the last completed review
 * and correlates them against the evidence sources the review process names:
 * the `CI Gate` check, reverts, fix-forward commits, reopened issues, size
 * allowlist growth, lint baseline growth, and new suppression directives.
 *
 * It is fail closed. Any read that errors, comes back truncated, or cannot be
 * tied to the range makes the whole result `complete: false` with no findings.
 * A failed read means "unknown", never "no problems", so the caller must not
 * advance the cursor or act on a partial result.
 *
 * Commit subjects and bodies are untrusted data. They are only ever matched
 * against fixed patterns and carried as strings; nothing here executes them.
 */

/** The GitHub Actions app that produces the required `CI Gate` check. */
export const CI_GATE_APP_ID = 15368;
export const CI_GATE_NAME = 'CI Gate';
export const ALLOWLIST_PATH = 'scripts/component-size-allowlist.json';
export const BASELINE_PATH = 'scripts/lint-warning-baseline.json';
/** A range larger than this needs a catch-up run first, not an API sweep. */
export const MAX_RANGE_COMMITS = 300;

const SUPPRESSION_RE =
  /(?:eslint|oxlint)-disable|@ts-ignore|@ts-expect-error|@ts-nocheck/;
const SUPPRESSION_PATHSPECS = ['src', 'src-api/src', 'packages'];
const TEST_PATH_RE = /(^|\/)(__tests__|test|tests)\/|\.test\.[cm]?[jt]sx?$/;

/** Lesson title prefixes (normalized) that detectors may increment on their own. */
export const LESSON_PREFIX = {
  skippedCheck: 'a check that skips your change is not validation',
  ceiling: 'never raise a threshold or allowlist ceiling',
};

export class IncompleteReadError extends Error {
  constructor(label, cause) {
    super(
      `${label}: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    this.name = 'IncompleteReadError';
    this.label = label;
  }
}

async function read(label, fn) {
  try {
    return await fn();
  } catch (error) {
    throw new IncompleteReadError(label, error);
  }
}

function short(sha) {
  return sha.slice(0, 8);
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new IncompleteReadError(label, error);
  }
}

function lineOf(text, needle) {
  const index = text.split('\n').findIndex((line) => line.includes(needle));
  return index === -1 ? 1 : index + 1;
}

function ownPrNumber(subject) {
  const match = /\(#(\d+)\)\s*$/.exec(subject);
  return match ? Number(match[1]) : null;
}

function finding(detector, commit, fields) {
  return {
    detector,
    commit: commit.sha,
    lessonPrefix: null,
    ...fields,
  };
}

function detectAllowlistGrowth(commit, change) {
  // A commit that creates the file introduces the gate. That is not growth.
  if (change.before === null || change.after === null) return [];
  const before = parseJson(change.before, `${ALLOWLIST_PATH}@parent`);
  const after = parseJson(
    change.after,
    `${ALLOWLIST_PATH}@${short(commit.sha)}`,
  );
  const grown = [];
  for (const [file, entry] of Object.entries(after)) {
    const prior = before[file];
    if (!prior) grown.push(`${file} added at ${entry.current}`);
    else if (entry.current > prior.current) {
      grown.push(`${file} raised ${prior.current} to ${entry.current}`);
    }
  }
  if (grown.length === 0) return [];
  const anchor = Object.keys(after).find((file) => grown[0].startsWith(file));
  return [
    finding('allowlist-growth', commit, {
      lessonPrefix: LESSON_PREFIX.ceiling,
      refs: [
        short(commit.sha),
        `${ALLOWLIST_PATH}:${lineOf(change.after, `"${anchor}"`)}`,
      ],
      summary: `Size allowlist grew in ${short(commit.sha)}: ${grown.join('; ')}.`,
      ran: `Nightly collector diffed ${ALLOWLIST_PATH} between the parent and ${short(commit.sha)}.`,
      missed:
        'A ceiling went up or a new entry was added instead of extracting the responsibility.',
      guard:
        'scripts/check-component-size.mjs compares the allowlist against BASE_REF; confirm BASE_REF was the PR base.',
    }),
  ];
}

function countGrowth(beforeMap = {}, afterMap = {}) {
  const grown = [];
  for (const [file, rules] of Object.entries(afterMap)) {
    for (const [rule, count] of Object.entries(rules)) {
      const prior = beforeMap[file]?.[rule] ?? 0;
      if (count > prior) grown.push(`${file} ${rule} ${prior} to ${count}`);
    }
  }
  return grown;
}

function detectBaselineGrowth(commit, change) {
  if (change.before === null || change.after === null) return [];
  const before = parseJson(change.before, `${BASELINE_PATH}@parent`);
  const after = parseJson(
    change.after,
    `${BASELINE_PATH}@${short(commit.sha)}`,
  );
  const grown = [
    ...countGrowth(before.warnings, after.warnings),
    ...countGrowth(before.suppressions, after.suppressions),
  ];
  const addedExceptions =
    (after.exceptions?.length ?? 0) - (before.exceptions?.length ?? 0);
  if (addedExceptions > 0)
    grown.push(`${addedExceptions} baseline exception(s) added`);
  if (grown.length === 0) return [];
  return [
    finding('baseline-growth', commit, {
      lessonPrefix: LESSON_PREFIX.ceiling,
      refs: [
        short(commit.sha),
        `${BASELINE_PATH}:${lineOf(change.after, grown[0].split(' ')[0])}`,
      ],
      summary: `Lint warning baseline grew in ${short(commit.sha)}: ${grown.slice(0, 3).join('; ')}.`,
      ran: `Nightly collector diffed ${BASELINE_PATH} between the parent and ${short(commit.sha)}.`,
      missed:
        'Warning or suppression debt was recorded as the new baseline instead of being fixed.',
      guard:
        'pnpm check:warning-baseline compares against the base ref; confirm it ran on the PR head.',
    }),
  ];
}

function detectSuppressions(commit, added) {
  const hits = added.filter(
    (line) => SUPPRESSION_RE.test(line.text) && !TEST_PATH_RE.test(line.file),
  );
  if (hits.length === 0) return [];
  return [
    finding('new-suppression', commit, {
      lessonPrefix: LESSON_PREFIX.ceiling,
      refs: [short(commit.sha), `${hits[0].file}:${hits[0].line}`],
      summary: `${hits.length} new lint or type suppression directive(s) outside tests in ${short(commit.sha)}.`,
      ran: `Nightly collector scanned added lines under ${SUPPRESSION_PATHSPECS.join(', ')} in ${short(commit.sha)}.`,
      missed:
        'A suppression was added instead of fixing the cause or recording a reviewed exception.',
      guard:
        'pnpm check:warning-baseline rejects new eslint/oxlint-disable comments in the frontend.',
    }),
  ];
}

function detectGate(commit, gate) {
  if (gate.total !== gate.runs.length) {
    throw new IncompleteReadError(
      `check-runs for ${short(commit.sha)}`,
      new Error(`truncated: ${gate.runs.length} of ${gate.total} returned`),
    );
  }
  const runs = gate.runs.filter(
    (run) => run.name === CI_GATE_NAME && run.appId === CI_GATE_APP_ID,
  );
  const passed = runs.some(
    (run) => run.status === 'completed' && run.conclusion === 'success',
  );
  if (passed) return { state: 'success', findings: [] };
  const state =
    runs.length === 0
      ? 'missing'
      : (runs[0].conclusion ?? runs[0].status ?? 'unknown');
  return {
    state,
    findings: [
      finding('ci-gate', commit, {
        lessonPrefix: LESSON_PREFIX.skippedCheck,
        refs: [short(commit.sha)],
        summary: `${CI_GATE_NAME} from app ${CI_GATE_APP_ID} is ${state} on merged commit ${short(commit.sha)}.`,
        ran: `Nightly collector read the ${CI_GATE_NAME} check run for ${short(commit.sha)}.`,
        missed:
          'The commit reached main without a successful aggregate gate on its own head.',
        guard: `Require ${CI_GATE_NAME} (integration ${CI_GATE_APP_ID}) in the main ruleset.`,
      }),
    ],
  };
}

function detectRevert(commit) {
  if (!/^revert\b/i.test(commit.subject)) return [];
  const reverted = /This reverts commit ([0-9a-f]{7,40})/.exec(
    commit.body,
  )?.[1];
  return [
    finding('revert', commit, {
      refs: [short(commit.sha), ...(reverted ? [short(reverted)] : [])],
      summary: `Revert commit ${short(commit.sha)} landed on main.`,
      ran: 'Nightly collector matched the commit subject against the revert pattern.',
      missed:
        'Whatever the reverted change got wrong was not caught before merge. A person must name the pattern.',
    }),
  ];
}

function detectFixForward(commit, prCommits) {
  if (!/^fix(\(|:|!)/i.test(commit.subject)) return [];
  const own = ownPrNumber(commit.subject);
  const mentioned = new Set(
    [...`${commit.subject}\n${commit.body}`.matchAll(/#(\d+)/g)].map((m) =>
      Number(m[1]),
    ),
  );
  const earlier = [...mentioned].filter((n) => {
    if (n === own) return false;
    const target = prCommits.get(n);
    return (
      target !== undefined &&
      target.sha !== commit.sha &&
      target.index < commit.index
    );
  });
  if (earlier.length === 0) return [];
  return [
    finding('fix-forward', commit, {
      refs: [
        ...(own ? [`#${own}`] : [short(commit.sha)]),
        ...earlier.map((n) => `#${n}`),
      ],
      summary: `Fix ${short(commit.sha)} references earlier merged PR(s) ${earlier.map((n) => `#${n}`).join(', ')} in the same range.`,
      ran: 'Nightly collector matched fix commits against PR numbers merged earlier in the range.',
      missed:
        'The earlier change needed a follow-up fix after merge. A person must name the pattern.',
    }),
  ];
}

/**
 * Collect and correlate one range. `source` is the injected reader (see
 * source.mjs for the git and gh implementation).
 */
export async function collectRange(source, { cursor, head }) {
  try {
    const ancestor = await read('cursor ancestry', () =>
      source.isAncestor(cursor, head),
    );
    if (!ancestor) {
      throw new IncompleteReadError(
        'cursor ancestry',
        new Error(
          `${short(cursor)} is not an ancestor of ${short(head)}; the cursor is unknown`,
        ),
      );
    }

    const commits = await read('first-parent commit list', () =>
      source.commits(cursor, head),
    );
    if (commits.length > MAX_RANGE_COMMITS) {
      throw new IncompleteReadError(
        'first-parent commit list',
        new Error(
          `${commits.length} commits exceeds ${MAX_RANGE_COMMITS}; run a catch-up first`,
        ),
      );
    }

    const indexed = commits.map((commit, index) => ({ ...commit, index }));
    const prCommits = new Map();
    for (const commit of indexed) {
      const pr = ownPrNumber(commit.subject);
      if (pr !== null) prCommits.set(pr, commit);
    }

    const findings = [];
    const gates = {};
    const pulls = {};
    const reopenChecks = new Map();

    for (const commit of indexed) {
      const label = short(commit.sha);
      pulls[commit.sha] = (
        await read(`pull requests for ${label}`, () => source.pulls(commit.sha))
      ).map((pr) => pr.number);

      const gate = await read(`check runs for ${label}`, () =>
        source.gate(commit.sha),
      );
      const gateResult = detectGate(commit, gate);
      gates[commit.sha] = gateResult.state;
      findings.push(...gateResult.findings);

      const files = await read(`changed files for ${label}`, () =>
        source.changedFiles(commit.sha),
      );
      if (files.includes(ALLOWLIST_PATH)) {
        const change = await read(`${ALLOWLIST_PATH} for ${label}`, () =>
          source.fileChange(commit.sha, ALLOWLIST_PATH),
        );
        findings.push(...detectAllowlistGrowth(commit, change));
      }
      if (files.includes(BASELINE_PATH)) {
        const change = await read(`${BASELINE_PATH} for ${label}`, () =>
          source.fileChange(commit.sha, BASELINE_PATH),
        );
        findings.push(...detectBaselineGrowth(commit, change));
      }
      if (
        files.some((file) =>
          SUPPRESSION_PATHSPECS.some((p) => file.startsWith(`${p}/`)),
        )
      ) {
        const added = await read(`added lines for ${label}`, () =>
          source.addedLines(commit.sha, SUPPRESSION_PATHSPECS),
        );
        findings.push(...detectSuppressions(commit, added));
      }

      findings.push(...detectRevert(commit));
      findings.push(...detectFixForward(commit, prCommits));

      for (const match of commit.body.matchAll(
        /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/gi,
      )) {
        const number = Number(match[1]);
        if (!reopenChecks.has(number)) reopenChecks.set(number, []);
        reopenChecks.get(number).push(commit);
      }
    }

    for (const [number, closers] of reopenChecks) {
      const events = await read(`events for #${number}`, () =>
        source.issueReopens(number),
      );
      for (const commit of closers) {
        const reopened = events.find(
          (event) =>
            Date.parse(event.createdAt) > Date.parse(commit.committedAt),
        );
        if (reopened) {
          findings.push(
            finding('reopened-issue', commit, {
              refs: [`#${number}`, short(commit.sha)],
              summary: `Issue #${number} was reopened after ${short(commit.sha)} closed it.`,
              ran: `Nightly collector read the event list of #${number}.`,
              missed: 'The fix did not hold. A person must name the pattern.',
            }),
          );
        }
      }
    }

    return {
      complete: true,
      reasons: [],
      range: { base: cursor, head, commits: indexed.length },
      commits: indexed.map((commit) => ({
        sha: commit.sha,
        subject: commit.subject,
        pulls: pulls[commit.sha],
        gate: gates[commit.sha],
      })),
      findings,
    };
  } catch (error) {
    if (!(error instanceof IncompleteReadError)) throw error;
    return {
      complete: false,
      reasons: [error.message],
      range: { base: cursor, head, commits: 0 },
      commits: [],
      findings: [],
    };
  }
}
