#!/usr/bin/env node
// Managed dev lifecycle for the API server — inspired by open-design's
// `tools-dev` control plane (_sample/open-design/tools/dev).
//
// Why this exists: `pnpm dev:api` runs `node --watch`, which restarts the
// whole process on every save. When a handle (channel WebSocket, MCP stdio
// child, lingering timer) refuses to drain, the old process keeps port 5126
// bound and the respawn wedges. This wrapper gives an explicit, scriptable
// lifecycle that reaps the *entire process tree* and frees the port — so an
// AI agent or e2e harness can drive it deterministically:
//
//   node scripts/dev.mjs start      # background-spawn, PID + log to .dev/
//   node scripts/dev.mjs status     # pid alive? port healthy? (--json)
//   node scripts/dev.mjs logs -f    # tail the log
//   node scripts/dev.mjs restart    # tree-kill + free port + respawn
//   node scripts/dev.mjs stop       # tree-kill + free port
//
// Flags: --port <n> (default 5126), --channels (start channel runtimes),
//        --json (machine-readable status), -n <lines> / -f (logs).

import { spawn, spawnSync } from 'node:child_process';
import {
  createReadStream,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEV_DIR = path.join(ROOT, '.dev');
const PID_FILE = path.join(DEV_DIR, 'api.pid');
const LOG_FILE = path.join(DEV_DIR, 'api.log');
const IS_WIN = process.platform === 'win32';

const argv = process.argv.slice(2);
const command = argv[0] ?? 'status';
const flag = (name) => argv.includes(name);
const opt = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const PORT = Number(opt('--port', process.env.PORT ?? '5126'));

function ensureDevDir() {
  if (!existsSync(DEV_DIR)) mkdirSync(DEV_DIR, { recursive: true });
}

function readPid() {
  if (!existsSync(PID_FILE)) return null;
  const pid = Number(readFileSync(PID_FILE, 'utf8').trim());
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

function isAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM'; // exists but not ours
  }
}

async function portHealthy() {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/health`, {
      signal: AbortSignal.timeout(1000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// Find any PIDs still bound to the port (handles orphans the PID file lost).
function pidsOnPort() {
  if (IS_WIN) {
    const out =
      spawnSync('netstat', ['-ano'], { encoding: 'utf8' }).stdout ?? '';
    return [
      ...new Set(
        out
          .split('\n')
          .filter((l) => l.includes(`:${PORT}`) && l.includes('LISTENING'))
          .map((l) => Number(l.trim().split(/\s+/).pop()))
          .filter((n) => Number.isInteger(n) && n > 0),
      ),
    ];
  }
  const out =
    spawnSync('lsof', ['-ti', `tcp:${PORT}`, '-sTCP:LISTEN'], {
      encoding: 'utf8',
    }).stdout ?? '';
  return [
    ...new Set(
      out
        .split('\n')
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isInteger(n) && n > 0),
    ),
  ];
}

// PIDs descended from `ancestor` (POSIX only) — `node --watch` runs a worker
// child that binds the port, so it must not be mistaken for an orphan.
function descendantsOf(ancestor) {
  if (IS_WIN || !ancestor) return new Set();
  const out =
    spawnSync('ps', ['-eo', 'pid=,ppid='], { encoding: 'utf8' }).stdout ?? '';
  const children = new Map();
  for (const line of out.split('\n')) {
    const [pid, ppid] = line.trim().split(/\s+/).map(Number);
    if (!pid) continue;
    if (!children.has(ppid)) children.set(ppid, []);
    children.get(ppid).push(pid);
  }
  const seen = new Set();
  const stack = [ancestor];
  while (stack.length) {
    for (const child of children.get(stack.pop()) ?? []) {
      if (!seen.has(child)) {
        seen.add(child);
        stack.push(child);
      }
    }
  }
  return seen;
}

function killTree(pid, signal = 'SIGTERM') {
  if (!pid) return;
  if (IS_WIN) {
    spawnSync('taskkill', ['/pid', String(pid), '/T', '/F']);
    return;
  }
  // Spawned detached, the child is a process-group leader: negative pid
  // signals the whole group (node --watch + tsx + spawned children).
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      /* already gone */
    }
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function start() {
  ensureDevDir();
  const existing = readPid();
  if (isAlive(existing)) {
    console.log(`API already running (pid ${existing}) on :${PORT}`);
    return;
  }
  const env = { ...process.env, PORT: String(PORT) };
  // Channels stay off in watch dev unless explicitly asked (matches index.ts).
  if (flag('--channels')) env.NEUMA_DEV_CHANNELS = '1';

  const out = openSync(LOG_FILE, 'a');
  const child = spawn('pnpm', ['dev:api'], {
    cwd: ROOT,
    env,
    detached: true, // own process group → killTree reaps the whole subtree
    stdio: ['ignore', out, out],
  });
  child.unref();
  writeFileSync(PID_FILE, String(child.pid));
  console.log(`Started API (pid ${child.pid}) → http://localhost:${PORT}`);
  console.log(
    `Logs: ${path.relative(ROOT, LOG_FILE)}  (node scripts/dev.mjs logs -f)`,
  );

  // Wait for health so callers (and AI/e2e harnesses) can proceed safely.
  for (let i = 0; i < 60; i++) {
    if (await portHealthy()) {
      console.log(`Healthy on :${PORT} after ~${i}s`);
      return;
    }
    if (!isAlive(child.pid)) {
      console.error('API exited during startup — see logs above.');
      process.exitCode = 1;
      return;
    }
    await sleep(1000);
  }
  console.error(`API did not become healthy on :${PORT} within 60s.`);
  process.exitCode = 1;
}

async function stop({ quiet = false } = {}) {
  const pid = readPid();
  const targets = new Set();
  if (pid) targets.add(pid);
  for (const p of pidsOnPort()) targets.add(p);

  if (targets.size === 0) {
    if (!quiet) console.log('API not running.');
    rmSync(PID_FILE, { force: true });
    return;
  }
  for (const p of targets) killTree(p, 'SIGTERM');

  // Give graceful shutdown (drain + watchdog in index.ts) a moment.
  for (let i = 0; i < 30; i++) {
    if (![...targets].some(isAlive) && pidsOnPort().length === 0) break;
    await sleep(100);
  }
  // Anything still holding the port gets SIGKILL.
  for (const p of new Set([...targets, ...pidsOnPort()])) {
    if (isAlive(p) || pidsOnPort().includes(p)) killTree(p, 'SIGKILL');
  }
  rmSync(PID_FILE, { force: true });
  if (!quiet) console.log(`Stopped API (freed :${PORT}).`);
}

async function restart() {
  await stop({ quiet: true });
  await sleep(300);
  await start();
}

async function status() {
  const pid = readPid();
  const alive = isAlive(pid);
  const healthy = await portHealthy();
  const ours = descendantsOf(pid);
  const orphans = pidsOnPort().filter((p) => p !== pid && !ours.has(p));
  const state = healthy
    ? 'healthy'
    : alive
      ? 'running (not healthy)'
      : 'stopped';
  if (flag('--json')) {
    console.log(
      JSON.stringify({
        state,
        pid: alive ? pid : null,
        port: PORT,
        healthy,
        orphans,
      }),
    );
    return;
  }
  console.log(`API: ${state}`);
  console.log(`  pid:     ${alive ? pid : '—'}`);
  console.log(
    `  port:    ${PORT} ${healthy ? '(responding)' : '(no /health)'}`,
  );
  if (orphans.length)
    console.log(`  orphans: ${orphans.join(', ')} (run "stop" to reap)`);
}

async function logs() {
  if (!existsSync(LOG_FILE)) {
    console.log('No log file yet — start the API first.');
    return;
  }
  const n = Number(opt('-n', '120'));
  const lines = readFileSync(LOG_FILE, 'utf8').split('\n');
  process.stdout.write(lines.slice(-n).join('\n') + '\n');
  if (!flag('-f')) return;
  // Follow: poll the file for appended bytes.
  let size = readFileSync(LOG_FILE).length;
  for (;;) {
    await sleep(500);
    const cur = readFileSync(LOG_FILE).length;
    if (cur > size) {
      await new Promise((resolve) => {
        createReadStream(LOG_FILE, { start: size, end: cur })
          .on('data', (b) => process.stdout.write(b))
          .on('end', resolve);
      });
      size = cur;
    }
  }
}

const commands = { start, stop, restart, status, logs };
const handler = commands[command];
if (!handler) {
  console.error(`Unknown command "${command}".`);
  console.error(
    'Usage: node scripts/dev.mjs <start|stop|restart|status|logs> [--port N] [--channels] [--json] [-n N] [-f]',
  );
  process.exit(2);
}
await handler();
