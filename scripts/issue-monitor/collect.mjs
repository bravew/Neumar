// Read-only GitHub collector.
//
// Produces the normalized read the intake tick consumes. It can only issue
// GET `gh api` calls against the repository's collaborators and issues
// endpoints, so it cannot mutate anything even if called with the wrong
// arguments. Titles, bodies, and comments are never copied out: they are
// untrusted data and have no use in a decision or an audit record.
//
// Any failed call, or a result that reaches the item cap, returns
// `{ok: false, complete: false}` with no issues. A partial list is never
// returned as if it were the whole list.

import { DEFAULT_CONFIG } from './config.mjs';

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const ALLOWED_FLAGS = new Set(['--paginate', '--slurp']);
const ALLOWED_ENDPOINT =
  /^repos\/[\w.-]+\/[\w.-]+\/(collaborators|issues)(\/\d+(\/timeline)?)?(\?[^\s]*)?$/;

/** Throws unless the arguments are a plain GET `gh api` read. */
export function assertReadOnlyGhArgs(args) {
  if (args[0] !== 'api') {
    throw new Error('issue-monitor collector only runs `gh api`');
  }
  const endpoint = args.at(-1);
  if (typeof endpoint !== 'string' || !ALLOWED_ENDPOINT.test(endpoint)) {
    throw new Error(`issue-monitor collector refuses endpoint: ${endpoint}`);
  }
  for (const flag of args.slice(1, -1)) {
    if (!ALLOWED_FLAGS.has(flag)) {
      throw new Error(`issue-monitor collector refuses flag: ${flag}`);
    }
  }
}

/** Real runner: `gh` with an argument array, never a shell string. */
export function createGhRunner() {
  return async (args) => {
    assertReadOnlyGhArgs(args);
    const { stdout } = await execFileAsync('gh', args, {
      env: { ...process.env, GH_PROMPT_DISABLED: '1' },
      maxBuffer: 64 * 1024 * 1024,
    });
    return JSON.parse(stdout);
  };
}

const flattenPages = (pages) => (Array.isArray(pages) ? pages.flat() : []);
const canWrite = (collaborator) =>
  collaborator.permissions?.push === true ||
  collaborator.permissions?.maintain === true ||
  collaborator.permissions?.admin === true;

/**
 * @param {object} options
 * @param {(args: string[]) => Promise<unknown>} options.gh
 * @param {{owner: string, name: string}} options.repo
 * @param {string|null} [options.since] cron window start (watermark minus overlap)
 * @param {number[]} [options.numbers] follow-up issues to read by number
 * @param {boolean} [options.window] read the changed-since window (false for event ticks)
 * @param {boolean} [options.approvedOnly] filter the window by the approval label
 */
export async function collectSnapshot({
  gh,
  repo,
  since = null,
  numbers = [],
  window = true,
  approvedOnly = true,
  now = () => new Date(),
  config = DEFAULT_CONFIG,
  maxIssues = 500,
}) {
  // Captured before the first read: this, not any updatedAt, becomes the
  // watermark.
  const startedAt = now().toISOString();
  const base = `repos/${repo.owner}/${repo.name}`;

  try {
    const collaborators = flattenPages(
      await gh([
        'api',
        '--paginate',
        '--slurp',
        `${base}/collaborators?per_page=100`,
      ]),
    );
    const trustedActors = collaborators.filter(canWrite).map((person) => ({
      login: person.login,
      association:
        person.login.toLowerCase() === repo.owner.toLowerCase()
          ? 'OWNER'
          : 'COLLABORATOR',
    }));

    const rows = new Map();
    if (window) {
      const params = new URLSearchParams({
        state: 'open',
        per_page: '100',
        sort: 'updated',
        direction: 'asc',
      });
      if (approvedOnly) params.set('labels', config.labels.approved);
      if (since) params.set('since', since);
      const found = flattenPages(
        await gh([
          'api',
          '--paginate',
          '--slurp',
          `${base}/issues?${params.toString()}`,
        ]),
      );
      if (found.length >= maxIssues) {
        throw new Error(`issue window reached the ${maxIssues} item cap`);
      }
      for (const row of found) rows.set(row.number, row);
    }
    for (const number of numbers) {
      if (!Number.isInteger(number) || number <= 0) {
        throw new TypeError(`invalid follow-up issue number: ${number}`);
      }
      rows.set(number, await gh(['api', `${base}/issues/${number}`]));
    }

    const issues = [];
    for (const row of [...rows.values()].sort((a, b) => a.number - b.number)) {
      const labels = row.labels.map((label) =>
        typeof label === 'string' ? label : label.name,
      );
      const isPullRequest = Boolean(row.pull_request);
      let labelEvents = null;
      let linkedOpenPrs = 0;

      // The history only matters for an issue that carries the approval label.
      if (!isPullRequest && labels.includes(config.labels.approved)) {
        const timeline = flattenPages(
          await gh([
            'api',
            '--paginate',
            '--slurp',
            `${base}/issues/${row.number}/timeline?per_page=100`,
          ]),
        );
        labelEvents = timeline
          .filter(
            (event) =>
              (event.event === 'labeled' || event.event === 'unlabeled') &&
              event.label?.name,
          )
          .map((event) => ({
            event: event.event,
            label: event.label.name,
            actor: event.actor?.login ?? null,
            createdAt: event.created_at,
          }));
        linkedOpenPrs = timeline.filter(
          (event) =>
            event.event === 'cross-referenced' &&
            event.source?.issue?.pull_request &&
            event.source.issue.state === 'open',
        ).length;
      }

      issues.push({
        number: row.number,
        state: row.state,
        isPullRequest,
        labels,
        updatedAt: row.updated_at,
        linkedOpenPrs,
        labelEvents,
      });
    }

    return { ok: true, complete: true, startedAt, trustedActors, issues };
  } catch (error) {
    return {
      ok: false,
      complete: false,
      startedAt,
      error: error instanceof Error ? error.message : 'unknown read error',
      trustedActors: [],
      issues: [],
    };
  }
}
