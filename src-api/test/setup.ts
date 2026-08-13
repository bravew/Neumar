import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, vi } from 'vitest';

// Per-worker HOME isolation. globalSetup points HOME at a single shared temp
// dir, which every forked worker inherits — so with `pool: 'forks'` they would
// all open the same `$HOME/.neumar/database.db` (the DB reads process.env.HOME
// directly, runs in WAL mode, and checkpoints for cross-process visibility).
// Parallel tests that write a global setting (notably `setSetting('workDir')`,
// used by 14 video/asset suites) then stomp each other, and an asset path
// resolved against another worker's deleted workDir fails with "Asset file does
// not exist". Giving each worker its own HOME subtree gives it its own DB and
// removes the cross-worker coupling. setupFiles run in the worker before any
// test imports the DB module, so this lands before the first getDatabase().
const workerId =
  process.env.VITEST_POOL_ID ?? process.env.VITEST_WORKER_ID ?? '0';
if (process.env.HOME) {
  const workerHome = join(process.env.HOME, `worker-${workerId}`);
  mkdirSync(workerHome, { recursive: true });
  process.env.HOME = workerHome;
}

afterEach(() => {
  if (vi.isFakeTimers()) vi.useRealTimers();
});
