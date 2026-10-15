/**
 * Stop reaches the managed FFmpeg skill (finding S5).
 *
 * The MCP handler never passed a cancellation signal into the runner, so a real
 * Stop could not cancel a running operation. The runner's own abort tests supply
 * their own signal, which is why they passed while the product path was broken:
 * nothing in the product ever aborted the signal the runner was handed.
 *
 * These cases drive the real `ffmpeg_skill_execute` handler with the `extra`
 * argument the MCP transport supplies, and assert measured facts:
 *
 *   - aborting the request terminates the running child and leaves no
 *     deliverable and no file record,
 *   - an abort delivered after the child exits but before handoff publishes
 *     nothing, even though the operation itself completed.
 *
 * Two seams, both outside the behavior under test:
 *
 *   - the contract loader keeps the real 42-tool contract and only points the
 *     `cut` tool's executable at a synthetic script in a temporary skill dir, so
 *     the run does not depend on the vendored Python body,
 *   - the runtime module resolves the interpreter to the test's own Node binary
 *     and passes the environment through, so the child is a real process the
 *     real supervisor starts without requiring ffmpeg on the machine. Installed
 *     interpreter discovery has its own coverage in
 *     `ffmpeg-skill-runner.test.ts`.
 *
 * The handler, the runner, the process supervisor, the argv builder, the path
 * policy, and the publication step are all the production ones.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeDatabase, getDatabase } from '@/shared/db';
import { createSession, createTask } from '@/shared/db/operations';
import { runWithSessionContext } from '@/shared/services/session-context';

/**
 * State the mock factories read at call time. `vi.hoisted` keeps it available
 * before the hoisted `vi.mock` calls run.
 */
const state = vi.hoisted(() => ({
  /** Temporary skill dir the mocked contract loader reports. */
  skillDir: '',
  /** Aborts the run's signal on the first staged-artifact read, then clears. */
  abortOnStagedRead: null as AbortController | null,
}));

vi.mock('@/shared/services/ffmpeg-skill/contract', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('@/shared/services/ffmpeg-skill/contract')
    >();
  return {
    ...actual,
    loadFfmpegContract: async () => {
      const loaded = await actual.loadFfmpegContract();
      const tools = new Map(loaded.tools);
      const cut = tools.get('cut');
      if (!cut) throw new Error('the vendored contract has no cut tool');
      tools.set('cut', { ...cut, executable: 'scripts/cut.js' });
      return { ...loaded, skillDir: state.skillDir, tools };
    },
  };
});

vi.mock('@/shared/services/ffmpeg-skill/runtime', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('@/shared/services/ffmpeg-skill/runtime')
    >();
  return {
    ...actual,
    resolveSkillRuntime: () => ({
      python: {
        command: process.execPath,
        prefixArgs: [],
        version: `test (${process.execPath})`,
      },
      ffmpegPath: process.execPath,
      ffprobePath: process.execPath,
      ffmpegVersion: 'test',
    }),
    skillProcessEnv: () => ({ ...process.env }),
  };
});

/**
 * Delivers the cancel at the publication window.
 *
 * `validatedArtifact` reads the staged output after the supervisor has already
 * resolved, so aborting on that read is exactly "the child has exited and
 * handoff has not run yet". Nothing about the runner or the handoff is replaced.
 */
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    readFile: (async (filePath: unknown, options: unknown) => {
      if (
        state.abortOnStagedRead &&
        typeof filePath === 'string' &&
        filePath.includes('neumar-ffmpeg-skill-')
      ) {
        const controller = state.abortOnStagedRead;
        state.abortOnStagedRead = null;
        controller.abort();
      }
      return actual.readFile(filePath as never, options as never);
    }) as typeof actual.readFile,
  };
});

const { ffmpegSkillTools } = await import('@/shared/mcp/ffmpeg-skill-server');

const execute = ffmpegSkillTools.find(
  (entry) => entry.name === 'ffmpeg_skill_execute',
);

/**
 * The synthetic `cut` body. It reports its pid, optionally sleeps, writes the
 * staged output the host authorized, and prints the JSON the runner validates.
 */
const CUT_SCRIPT = `
const fs = require('node:fs');
const control = JSON.parse(fs.readFileSync(process.env.NEUMAR_TEST_CONTROL, 'utf8'));
fs.writeFileSync(control.pidFile, String(process.pid));
if (control.sleepMs > 0) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, control.sleepMs);
}
const argv = process.argv.slice(2);
let output = null;
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === '-o' || argv[i] === '--output') {
    output = argv[i + 1];
    break;
  }
}
if (output) fs.writeFileSync(output, 'NEW DELIVERABLE BYTES');
process.stdout.write(JSON.stringify({ status: 'completed', verified: true, output }));
`;

let workspace: string;
let skillDir: string;
let controlFile: string;
let pidFile: string;
let taskId: string;
const tempDirs: string[] = [];

function makeDir(prefix: string): string {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), prefix)));
  tempDirs.push(dir);
  return dir;
}

/** Point the synthetic child at a pid file and a sleep, then let it run. */
function armChild(sleepMs: number): void {
  writeFileSync(controlFile, JSON.stringify({ pidFile, sleepMs }));
}

beforeEach(() => {
  closeDatabase();
  state.abortOnStagedRead = null;
  workspace = makeDir('neumar-stop-workspace-');
  skillDir = makeDir('neumar-stop-skill-');
  state.skillDir = skillDir;
  controlFile = path.join(workspace, 'control.json');
  pidFile = path.join(workspace, 'child.pid');
  mkdirSync(path.join(skillDir, 'scripts'), { recursive: true });
  writeFileSync(path.join(skillDir, 'scripts', 'cut.js'), CUT_SCRIPT);
  writeFileSync(path.join(workspace, 'source.mp4'), 'not-really-a-video');

  const sessionId = `session-${Math.random().toString(36).slice(2)}`;
  taskId = `task-${Math.random().toString(36).slice(2)}`;
  createSession({ id: sessionId, prompt: 'cut this clip' });
  createTask({
    id: taskId,
    session_id: sessionId,
    task_index: 0,
    prompt: 'cut this clip',
    work_dir: workspace,
  });
  vi.stubEnv('NEUMAR_TEST_CONTROL', controlFile);
});

afterEach(() => {
  closeDatabase();
  state.abortOnStagedRead = null;
  vi.unstubAllEnvs();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** Invoke the real handler the way the MCP transport does. */
function invoke(extra: unknown) {
  return runWithSessionContext({ workDir: workspace, taskId }, () =>
    execute!.handler(
      {
        tool: 'cut',
        args: {
          input: path.join(workspace, 'source.mp4'),
          start: '0',
          duration: '1',
        },
      } as never,
      extra,
    ),
  );
}

function bodyOf(result: {
  content: Array<{ type: string; text?: string }>;
}): Record<string, unknown> {
  const text = result.content.map((entry) => entry.text ?? '').join('\n');
  return JSON.parse(text) as Record<string, unknown>;
}

function fileRecords(): unknown[] {
  return getDatabase()
    .prepare('SELECT path FROM files WHERE task_id = ?')
    .all(taskId);
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(
  check: () => boolean,
  timeoutMs = 10_000,
  pollMs = 25,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  throw new Error('Timed out waiting for condition');
}

describe('ffmpeg skill Stop cancellation', () => {
  it('terminates the running child and publishes nothing when the request is aborted', async () => {
    armChild(10_000);
    const controller = new AbortController();
    const pending = invoke({ signal: controller.signal });

    // Wait for the real child to exist, so this measures cancellation of a
    // running process rather than a refusal before the spawn.
    await waitFor(() => existsSync(pidFile));
    const childPid = Number(readFileSync(pidFile, 'utf8'));
    expect(processAlive(childPid)).toBe(true);

    controller.abort();
    const result = await pending;

    expect(result.isError).toBe(true);
    const body = bodyOf(result);
    expect(body.status).toBe('cancelled');
    expect(body.artifact).toBeNull();
    expect(body.artifactCreated).toBe(false);

    // The child is gone, not merely abandoned.
    await waitFor(() => !processAlive(childPid));
    expect(processAlive(childPid)).toBe(false);

    // No deliverable reached the workspace and no record describes one.
    expect(fileRecords()).toEqual([]);
    expect(existsSync(path.join(workspace, 'output', 'source-cut.mp4'))).toBe(
      false,
    );
  }, 30_000);

  it('publishes nothing when the abort lands after the child exits', async () => {
    armChild(0);
    const controller = new AbortController();
    // Armed before the run: the signal is aborted on the staged-artifact read,
    // which happens after the supervisor resolved and before handoff.
    state.abortOnStagedRead = controller;
    const result = await invoke({ signal: controller.signal });

    expect(result.isError).toBe(true);
    const body = bodyOf(result);
    // The operation itself finished: this is the window between the child
    // exiting and publication, not a cancelled process.
    expect(body.exitCode).toBe(0);
    expect(body.details).not.toBeNull();
    expect(body.status).toBe('cancelled');
    expect(body.artifact).toBeNull();
    expect(body.error).toMatchObject({ kind: 'aborted' });

    expect(fileRecords()).toEqual([]);
    expect(existsSync(path.join(workspace, 'output', 'source-cut.mp4'))).toBe(
      false,
    );
  }, 30_000);

  it('completes and publishes when the transport supplies no signal', async () => {
    armChild(0);
    const result = await invoke({});

    // `textResult` omits `isError` entirely on success.
    expect(result.isError ?? false).toBe(false);
    const body = bodyOf(result);
    expect(body.status).toBe('completed');
    const published = path.join(workspace, 'output', 'source-cut.mp4');
    expect(existsSync(published)).toBe(true);
    expect(readFileSync(published, 'utf8')).toBe('NEW DELIVERABLE BYTES');
    expect(fileRecords()).toHaveLength(1);
  }, 30_000);
});
