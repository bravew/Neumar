/**
 * Graphify Runner — runs `graphify update <workspace>` debounced so a flurry
 * of file saves coalesces into a single rebuild.
 *
 * The PyPI package is `graphifyy` (two y's); the CLI binary is `graphify`.
 * We try a chain of invocations in order of preference:
 *   1. `graphify update .`                  (already on PATH via `uv tool install` / pipx)
 *   2. `uv tool run --from graphifyy graphify update .`  (ephemeral, picks Python ≥3.10)
 *   3. `pipx run --spec graphifyy graphify update .`     (ephemeral pipx fallback)
 *
 * Surfaces a `disabled` state when none of those work so the UI can render
 * a setup hint instead of a generic error.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { getSetting } from '@/shared/db/operations';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('Graphify');

interface Invocation {
  cmd: string;
  args: (root: string) => string[];
  label: string;
}

const INVOCATIONS: Invocation[] = [
  {
    cmd: 'graphify',
    args: (root) => ['update', root],
    label: 'graphify',
  },
  {
    cmd: 'uv',
    args: (root) => [
      'tool',
      'run',
      '--from',
      'graphifyy',
      'graphify',
      'update',
      root,
    ],
    label: 'uv tool run --from graphifyy',
  },
  {
    cmd: 'pipx',
    args: (root) => ['run', '--spec', 'graphifyy', 'graphify', 'update', root],
    label: 'pipx run --spec graphifyy',
  },
];

const INSTALL_HINT =
  'graphify CLI not available. Install with one of: ' +
  '`uv tool install graphifyy`, `pipx install graphifyy`, or `pip install graphifyy`. ' +
  'Note the PyPI name is graphifyy (two y’s); the CLI binary is `graphify`.';

/** Cache the first invocation that succeeded so we don't re-probe every rebuild. */
let chosenInvocation: Invocation | null = null;

export type GraphifyState =
  | 'idle'
  | 'pending'
  | 'running'
  | 'error'
  | 'disabled';

export interface GraphifyStatus {
  state: GraphifyState;
  lastRunAt: string | null;
  lastDurationMs: number | null;
  lastError: string | null;
  manifestUpdatedAt: string | null;
  graphHtmlPath: string | null;
  graphJsonPath: string | null;
  reportPath: string | null;
  workDir: string;
}

const status: GraphifyStatus = {
  state: 'idle',
  lastRunAt: null,
  lastDurationMs: null,
  lastError: null,
  manifestUpdatedAt: null,
  graphHtmlPath: null,
  graphJsonPath: null,
  reportPath: null,
  workDir: '',
};

let debounceTimer: NodeJS.Timeout | null = null;
let pendingResolvers: Array<() => void> = [];
let runningPromise: Promise<void> | null = null;
const DEBOUNCE_MS = 5_000;

function workspaceRoot(): string {
  const workDir = getSetting('workDir');
  if (!workDir) throw new Error('workDir not configured');
  return resolve(workDir);
}

async function manifestStat(root: string): Promise<string | null> {
  try {
    const s = await stat(join(root, 'graphify-out', 'manifest.json'));
    return new Date(s.mtimeMs).toISOString();
  } catch {
    return null;
  }
}

function existsOrNull(p: string): string | null {
  return existsSync(p) ? p : null;
}

export function isWrongGraphifyCli(stderr: string): boolean {
  return /unknown command ['"]?update['"]?/i.test(stderr);
}

async function refreshPaths(): Promise<void> {
  const root = workspaceRoot();
  status.workDir = root;
  status.graphHtmlPath = existsOrNull(join(root, 'graphify-out', 'graph.html'));
  status.graphJsonPath = existsOrNull(join(root, 'graphify-out', 'graph.json'));
  status.reportPath = existsOrNull(
    join(root, 'graphify-out', 'GRAPH_REPORT.md'),
  );
  status.manifestUpdatedAt = await manifestStat(root);
}

/** Spawn one invocation and resolve `{ ok, stderr, spawnError }`. */
function spawnInvocation(
  inv: Invocation,
  root: string,
): Promise<{
  ok: boolean;
  stderr: string;
  spawnError: NodeJS.ErrnoException | null;
}> {
  return new Promise((resolvePromise) => {
    const child = spawn(inv.cmd, inv.args(root), { cwd: root });
    let stderr = '';
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    child.on('error', (err) => {
      resolvePromise({ ok: false, stderr, spawnError: err });
    });
    child.on('close', (code) => {
      resolvePromise({ ok: code === 0, stderr, spawnError: null });
    });
  });
}

async function runOnce(): Promise<void> {
  const root = workspaceRoot();
  const start = Date.now();
  status.state = 'running';

  // If we've already discovered which invocation works, use it directly.
  // Otherwise probe each in order, caching the first that succeeds.
  const candidates = chosenInvocation ? [chosenInvocation] : INVOCATIONS;
  let lastStderr = '';
  let allMissing = true;

  for (const inv of candidates) {
    const result = await spawnInvocation(inv, root);
    if (result.ok) {
      chosenInvocation = inv;
      status.state = 'idle';
      status.lastError = null;
      status.lastDurationMs = Date.now() - start;
      status.lastRunAt = new Date().toISOString();
      await refreshPaths();
      return;
    }
    lastStderr = result.stderr.trim();
    // ENOENT means the binary isn't on PATH — keep probing the next candidate.
    // Any other failure means the binary ran but errored out — surface it.
    if (
      result.spawnError &&
      (result.spawnError as NodeJS.ErrnoException).code === 'ENOENT'
    ) {
      continue;
    }
    if (isWrongGraphifyCli(lastStderr)) {
      continue;
    }
    allMissing = false;
    // Module-not-found via a stale `python3 -c "from graphify..."` path no
    // longer applies, but legacy stderr shapes can still surface — treat as
    // "not installed" so the UI shows the install hint.
    if (/No module named ['"]?graphify/i.test(lastStderr)) {
      break;
    }
    // Real error from a working CLI — stop probing and surface it.
    status.state = 'error';
    status.lastError = lastStderr || `${inv.label} exited non-zero`;
    status.lastDurationMs = Date.now() - start;
    status.lastRunAt = new Date().toISOString();
    logger.warn(`Graphify rebuild failed: ${status.lastError}`);
    return;
  }

  status.state = 'disabled';
  status.lastError = allMissing ? INSTALL_HINT : lastStderr || INSTALL_HINT;
  status.lastDurationMs = Date.now() - start;
  status.lastRunAt = new Date().toISOString();
  logger.info(`Graphify disabled — ${INSTALL_HINT} (workspace: ${root})`);
}

export function getGraphifyStatus(): GraphifyStatus {
  return { ...status };
}

/**
 * Trigger a rebuild. When called multiple times within the debounce window,
 * only one rebuild runs after the window settles. Returns when the active
 * rebuild finishes.
 */
export function rebuildGraph(
  options: { immediate?: boolean } = {},
): Promise<void> {
  // `immediate` re-probes invocations even from a `disabled` state so the user
  // can recover (e.g. after installing graphify) without restarting the server.
  if (status.state === 'disabled' && !options.immediate) {
    return Promise.resolve();
  }
  if (options.immediate) {
    chosenInvocation = null;
  }
  if (runningPromise) return runningPromise;

  if (options.immediate) {
    runningPromise = runOnce().finally(() => {
      runningPromise = null;
    });
    return runningPromise;
  }

  status.state = 'pending';
  return new Promise<void>((res) => {
    pendingResolvers.push(res);
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      debounceTimer = null;
      const resolvers = pendingResolvers;
      pendingResolvers = [];
      runningPromise = runOnce().finally(() => {
        runningPromise = null;
      });
      try {
        await runningPromise;
      } finally {
        for (const r of resolvers) r();
      }
    }, DEBOUNCE_MS);
  });
}

export async function readGraphReport(): Promise<string | null> {
  await refreshPaths();
  if (!status.reportPath) return null;
  const { readFile } = await import('node:fs/promises');
  try {
    return await readFile(status.reportPath, 'utf8');
  } catch {
    return null;
  }
}

export async function readGraphJson(): Promise<unknown | null> {
  await refreshPaths();
  if (!status.graphJsonPath) return null;
  const { readFile } = await import('node:fs/promises');
  try {
    return JSON.parse(await readFile(status.graphJsonPath, 'utf8'));
  } catch {
    return null;
  }
}

// Initialize paths on import so /graphify/status returns useful data
// without requiring a rebuild first.
refreshPaths().catch(() => undefined);
