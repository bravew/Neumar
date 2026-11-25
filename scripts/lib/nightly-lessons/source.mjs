/**
 * Git and GitHub readers for the nightly lessons review.
 *
 * Every call uses `execFile` with an argument array and a fixed binary, so no
 * value from a commit, PR, or issue ever reaches a shell. All calls are reads.
 * A non-zero exit, a timeout, or an unparsable response throws, and the
 * collector turns that into an incomplete result.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SHA_RE = /^[0-9a-f]{7,40}$/;
const FIELD = '\u001f';
const RECORD = '\u001e';

function assertSha(sha) {
  if (!SHA_RE.test(sha)) throw new Error(`not a commit sha: ${sha}`);
  return sha;
}

async function run(bin, args, { cwd, input } = {}) {
  const { stdout } = await execFileAsync(bin, args, {
    cwd,
    maxBuffer: 64 * 1024 * 1024,
    timeout: 120_000,
    env: process.env,
  });
  return stdout;
}

/** Parse a unified diff with -U0 into added lines carrying new-file line numbers. */
export function parseAddedLines(diff) {
  const added = [];
  let file = null;
  let line = 0;
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('+++ ')) {
      file = raw.startsWith('+++ b/') ? raw.slice(6) : null;
    } else if (raw.startsWith('@@')) {
      const match = /\+(\d+)(?:,\d+)? @@/.exec(raw);
      line = match ? Number(match[1]) : 0;
    } else if (file && raw.startsWith('+') && !raw.startsWith('+++')) {
      added.push({ file, line, text: raw.slice(1) });
      line += 1;
    }
  }
  return added;
}

export function createSource({ repo, cwd }) {
  if (!REPO_RE.test(repo)) throw new Error(`invalid repository: ${repo}`);
  const git = (args) => run('git', args, { cwd });
  const gh = async (endpoint) => {
    const out = await run('gh', ['api', endpoint, '--paginate', '--slurp'], {
      cwd,
    });
    return JSON.parse(out);
  };

  return {
    async isAncestor(base, head) {
      try {
        await git([
          'merge-base',
          '--is-ancestor',
          assertSha(base),
          assertSha(head),
        ]);
        return true;
      } catch (error) {
        if (error.code === 1) return false;
        throw error;
      }
    },

    async commits(base, head) {
      const out = await git([
        'log',
        '--first-parent',
        '--reverse',
        `--format=%H${FIELD}%s${FIELD}%cI${FIELD}%b${RECORD}`,
        `${assertSha(base)}..${assertSha(head)}`,
      ]);
      return out
        .split(RECORD)
        .map((record) => record.replace(/^\n/, ''))
        .filter((record) => record.length > 0)
        .map((record) => {
          const [sha, subject, committedAt, body = ''] = record.split(FIELD);
          return { sha, subject, committedAt, body };
        });
    },

    async changedFiles(sha) {
      const out = await git([
        'diff',
        '--name-only',
        `${assertSha(sha)}^1`,
        sha,
      ]);
      return out.split('\n').filter(Boolean);
    },

    async fileChange(sha, file) {
      const show = async (rev) => {
        try {
          return await git(['show', `${rev}:${file}`]);
        } catch (error) {
          // Only "path does not exist in that revision" means the file is absent.
          if (
            /exists on disk, but not in|does not exist in|path .* does not exist/.test(
              String(error.stderr),
            )
          ) {
            return null;
          }
          throw error;
        }
      };
      return {
        before: await show(`${assertSha(sha)}^1`),
        after: await show(sha),
      };
    },

    async addedLines(sha, pathspecs) {
      const out = await git([
        'diff',
        '-U0',
        '--no-color',
        `${assertSha(sha)}^1`,
        sha,
        '--',
        ...pathspecs,
      ]);
      return parseAddedLines(out);
    },

    async pulls(sha) {
      const pages = await gh(`repos/${repo}/commits/${assertSha(sha)}/pulls`);
      return pages.flat().map((pr) => ({ number: pr.number }));
    },

    async gate(sha) {
      const pages = await gh(
        `repos/${repo}/commits/${assertSha(sha)}/check-runs?check_name=CI%20Gate&filter=latest&per_page=100`,
      );
      const runs = pages.flatMap((page) => page.check_runs ?? []);
      return {
        total: pages[0]?.total_count ?? 0,
        runs: runs.map((checkRun) => ({
          name: checkRun.name,
          appId: checkRun.app?.id ?? null,
          status: checkRun.status,
          conclusion: checkRun.conclusion,
        })),
      };
    },

    async issueReopens(number) {
      if (!Number.isInteger(number) || number <= 0)
        throw new Error(`bad issue number: ${number}`);
      const pages = await gh(
        `repos/${repo}/issues/${number}/events?per_page=100`,
      );
      return pages
        .flat()
        .filter((event) => event.event === 'reopened')
        .map((event) => ({ createdAt: event.created_at }));
    },
  };
}
