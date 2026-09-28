import { randomUUID } from 'node:crypto';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentMessage } from '@/core/agent/types';

import { closeDatabase, DATABASE_MIGRATIONS, getDatabase } from '@/shared/db';
import { getLatestBranchSdkSession } from '@/shared/db/branch-sdk-sessions';
import { migration as branchSdkSessionsMigration } from '@/shared/db/migrations/057_branch_sdk_sessions';
import { runMigrations } from '@/shared/db/migrations/runner';
import {
  createBranch,
  createBranchWithEditedMessage,
  createSession,
  createTask,
  deleteTask,
} from '@/shared/db/operations';
import {
  invalidateBranchSdkSession,
  resolveBranchContextPlan,
  restoreFilesToForkPoint,
  withBranchSdkSessionRecording,
  type BranchContextPlan,
} from '@/shared/services/branch-sdk-session';

let taskId: string;
let sessionId: string;

function createTaskRow() {
  sessionId = `session-${randomUUID()}`;
  taskId = `task-${randomUUID()}`;
  createSession({ id: sessionId, prompt: 'Branch SDK sessions' });
  createTask({ id: taskId, session_id: sessionId, task_index: 1, prompt: 'p' });
}

function cleanup() {
  deleteTask(taskId);
  getDatabase().prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
  closeDatabase();
}

function insertMessage(row: {
  type: string;
  content?: string;
  runId?: string;
  messageId?: string;
  subtype?: string;
  branchId?: string;
  toolName?: string;
}): number {
  const result = getDatabase()
    .prepare(
      `INSERT INTO messages (task_id, type, content, message_id, run_id, subtype, branch_id, tool_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      taskId,
      row.type,
      row.content ?? row.type,
      row.messageId ?? null,
      row.runId ?? null,
      row.subtype ?? null,
      row.branchId ?? 'main',
      row.toolName ?? null,
    );
  return Number(result.lastInsertRowid);
}

async function drain(
  stream: AsyncGenerator<AgentMessage>,
): Promise<AgentMessage[]> {
  const out: AgentMessage[] = [];
  for await (const message of stream) out.push(message);
  return out;
}

async function* agentRun(
  messages: AgentMessage[],
): AsyncGenerator<AgentMessage> {
  yield* messages;
}

/** Run a stream through the recorder, as ag-ui does for every run. */
async function recordRun(input: {
  branchId: string;
  runId: string;
  plan: BranchContextPlan;
  sdkSessionId: string;
  provider?: 'claude' | 'codex';
  promptUuid?: string;
  failed?: boolean;
}) {
  await drain(
    withBranchSdkSessionRecording(
      agentRun([
        { type: 'session', sessionId: 'adapter', cwd: '/work/session-1' },
        {
          type: 'system',
          subtype: 'user_checkpoint',
          id: input.promptUuid ?? `prompt-${input.runId}`,
        },
        {
          type: 'system',
          subtype: 'user_checkpoint',
          id: `tool-result-${input.runId}`,
        },
        input.failed
          ? { type: 'error', message: 'boom' }
          : { type: 'result', content: 'done' },
      ] as AgentMessage[]),
      {
        taskId,
        branchId: input.branchId,
        runId: input.runId,
        provider: input.provider ?? 'claude',
        plan: input.plan,
        sdkSessionId: input.sdkSessionId,
      },
    ),
  );
}

/**
 * Main: U1 → run-1 (tool call + reply), U2 → run-2 (reply). Each main run
 * wrote its own SDK session, recorded through the same path as production.
 */
async function seedMainConversation() {
  const u1 = insertMessage({ type: 'user', runId: 'run-1', messageId: 'u1' });
  insertMessage({ type: 'tool_use', runId: 'run-1' });
  insertMessage({ type: 'tool_result', runId: 'run-1' });
  const a1 = insertMessage({ type: 'text', runId: 'run-1' });
  insertMessage({ type: 'result', runId: 'run-1', subtype: 'success' });
  await recordRun({
    branchId: 'main',
    runId: 'run-1',
    plan: { path: 'main' },
    sdkSessionId: 'sdk-main-1',
  });
  const u2 = insertMessage({ type: 'user', runId: 'run-2', messageId: 'u2' });
  const a2 = insertMessage({ type: 'text', runId: 'run-2' });
  await recordRun({
    branchId: 'main',
    runId: 'run-2',
    plan: { path: 'main' },
    sdkSessionId: 'sdk-main-2',
  });
  return { u1, a1, u2, a2 };
}

const allSessionsExist = () => true;

describe('branch SDK session migration', () => {
  it('creates the mapping table and rejects unknown modes', () => {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE tasks (id TEXT PRIMARY KEY)`);
    db.exec(`INSERT INTO tasks (id) VALUES ('t')`);
    runMigrations(db, [branchSdkSessionsMigration]);

    const columns = (
      db.prepare('PRAGMA table_info(branch_sdk_sessions)').all() as Array<{
        name: string;
      }>
    ).map((column) => column.name);
    expect(columns).toEqual(
      expect.arrayContaining([
        'task_id',
        'branch_id',
        'run_id',
        'mode',
        'sdk_session_id',
        'forked_from_session_id',
        'prompt_sdk_uuid',
        'cwd',
      ]),
    );
    expect(() =>
      db
        .prepare(
          `INSERT INTO branch_sdk_sessions (task_id, provider, mode) VALUES ('t', 'claude', 'bogus')`,
        )
        .run(),
    ).toThrow(/CHECK constraint/);
    // Idempotent: re-running the DDL leaves the table in place.
    expect(() => branchSdkSessionsMigration.up(db)).not.toThrow();
    db.close();
  });

  it('is registered as the next migration version', () => {
    const versions = DATABASE_MIGRATIONS.map((m) => m.version);
    expect(versions).toContain(109);
    expect(Math.max(...versions)).toBe(109);
  });
});

describe('branch SDK session resolution', () => {
  beforeEach(createTaskRow);
  afterEach(cleanup);

  it('keeps main on its existing per-run text history path', () => {
    expect(
      resolveBranchContextPlan({
        taskId,
        branchId: 'main',
        provider: 'claude',
        sessionExists: allSessionsExist,
      }),
    ).toEqual({ path: 'main' });
  });

  it('forks the recorded session of the run before an edited message, then resumes the fork', async () => {
    const { u2 } = await seedMainConversation();
    const { branchId } = createBranchWithEditedMessage(taskId, u2, 'edited');

    const first = resolveBranchContextPlan({
      taskId,
      branchId,
      provider: 'claude',
      sessionExists: allSessionsExist,
    });
    expect(first).toEqual({
      path: 'sdk',
      mode: 'fork',
      branchSession: { kind: 'fork', parentSessionId: 'sdk-main-1' },
    });

    // The first branch run writes the fork under its own session id.
    await recordRun({
      branchId,
      runId: 'branch-run-1',
      plan: first,
      sdkSessionId: 'sdk-branch',
    });
    expect(getLatestBranchSdkSession(taskId, branchId)).toMatchObject({
      mode: 'fork',
      sdkSessionId: 'sdk-branch',
      forkedFromSessionId: 'sdk-main-1',
      promptSdkUuid: 'prompt-branch-run-1',
      cwd: '/work/session-1',
    });

    const second = resolveBranchContextPlan({
      taskId,
      branchId,
      provider: 'claude',
      sessionExists: allSessionsExist,
    });
    expect(second).toEqual({
      path: 'sdk',
      mode: 'resume',
      branchSession: { kind: 'resume', sessionId: 'sdk-branch' },
    });
    await recordRun({
      branchId,
      runId: 'branch-run-2',
      plan: second,
      sdkSessionId: 'unused-live-session',
    });
    expect(getLatestBranchSdkSession(taskId, branchId)).toMatchObject({
      mode: 'resume',
      sdkSessionId: 'sdk-branch',
    });

    // Main is untouched: its latest session is still its own last run.
    expect(getLatestBranchSdkSession(taskId, 'main')).toMatchObject({
      runId: 'run-2',
      sdkSessionId: 'sdk-main-2',
    });
  });

  it('forks the session that ends at a "fork from here" reply', async () => {
    const { a2 } = await seedMainConversation();
    const branchId = createBranch(taskId, a2);

    expect(
      resolveBranchContextPlan({
        taskId,
        branchId,
        provider: 'claude',
        sessionExists: allSessionsExist,
      }),
    ).toMatchObject({
      mode: 'fork',
      branchSession: { parentSessionId: 'sdk-main-2' },
    });
  });

  it('never seeds a main edit from another branch run', async () => {
    const { a1 } = await seedMainConversation();
    // A branch run whose output rows landed after main's rows.
    const other = createBranch(taskId, a1);
    insertMessage({ type: 'text', runId: 'other-run' });
    await recordRun({
      branchId: other,
      runId: 'other-run',
      plan: {
        path: 'sdk',
        mode: 'fork',
        branchSession: { kind: 'fork', parentSessionId: 'sdk-main-1' },
      },
      sdkSessionId: 'sdk-other',
    });
    const u3 = insertMessage({ type: 'user', runId: 'run-3', messageId: 'u3' });
    const { branchId } = createBranchWithEditedMessage(taskId, u3, 'edited');

    expect(
      resolveBranchContextPlan({
        taskId,
        branchId,
        provider: 'claude',
        sessionExists: allSessionsExist,
      }),
    ).toMatchObject({ branchSession: { parentSessionId: 'sdk-main-2' } });
  });

  it('does not fork main when the fork point is another branch reply stored on main', async () => {
    // Main: u1 a1 u2 a2 (run-2 recorded). Branch B edits u2; its reply is
    // persisted with branch_id 'main' (issue #94) and B's run is recorded.
    const { u2 } = await seedMainConversation();
    const { branchId: branchB } = createBranchWithEditedMessage(
      taskId,
      u2,
      'edited u2',
    );
    const bReply = insertMessage({ type: 'text', runId: 'branch-b-run' });
    await recordRun({
      branchId: branchB,
      runId: 'branch-b-run',
      plan: {
        path: 'sdk',
        mode: 'fork',
        branchSession: { kind: 'fork', parentSessionId: 'sdk-main-1' },
      },
      sdkSessionId: 'sdk-branch-b',
    });

    // Forking from B's reply must not seed branch C from main's u2/a2.
    const branchC = createBranch(taskId, bReply);
    expect(
      resolveBranchContextPlan({
        taskId,
        branchId: branchC,
        provider: 'claude',
        sessionExists: allSessionsExist,
      }),
    ).toEqual({ path: 'text', reason: 'fork-point-after-branch-output' });
  });

  it('falls back to text history for a fork point inside a run', async () => {
    insertMessage({ type: 'user', runId: 'run-1' });
    const mid = insertMessage({ type: 'text', runId: 'run-1' });
    insertMessage({ type: 'tool_use', runId: 'run-1' });
    insertMessage({ type: 'text', runId: 'run-1' });
    await recordRun({
      branchId: 'main',
      runId: 'run-1',
      plan: { path: 'main' },
      sdkSessionId: 'sdk-main-1',
    });
    const branchId = createBranch(taskId, mid);

    expect(
      resolveBranchContextPlan({
        taskId,
        branchId,
        provider: 'claude',
        sessionExists: allSessionsExist,
      }),
    ).toEqual({ path: 'text', reason: 'fork-point-mid-run' });
  });

  it('falls back to text history when the parent run has no recorded session', async () => {
    insertMessage({ type: 'user', runId: 'codex-run' });
    const reply = insertMessage({ type: 'text', runId: 'codex-run' });
    // A Codex main run records nothing to fork.
    await recordRun({
      branchId: 'main',
      runId: 'codex-run',
      plan: { path: 'main' },
      sdkSessionId: 'unused',
      provider: 'codex',
    });
    const branchId = createBranch(taskId, reply);

    expect(
      resolveBranchContextPlan({
        taskId,
        branchId,
        provider: 'claude',
        sessionExists: allSessionsExist,
      }),
    ).toEqual({ path: 'text', reason: 'no-recorded-session' });
  });

  it('falls back to text history when the SDK transcript is gone', async () => {
    const { a2 } = await seedMainConversation();
    const branchId = createBranch(taskId, a2);

    expect(
      resolveBranchContextPlan({
        taskId,
        branchId,
        provider: 'claude',
        sessionExists: () => false,
      }),
    ).toEqual({ path: 'text', reason: 'parent-session-missing' });
  });

  it('keeps runtimes without a fork API on text history, and the branch stays there', async () => {
    const { a2 } = await seedMainConversation();
    const branchId = createBranch(taskId, a2);

    const plan = resolveBranchContextPlan({
      taskId,
      branchId,
      provider: 'codex',
      sessionExists: allSessionsExist,
    });
    expect(plan).toEqual({ path: 'text', reason: 'runtime-without-fork' });
    await recordRun({
      branchId,
      runId: 'codex-branch-run',
      plan,
      sdkSessionId: 'unused',
      provider: 'codex',
    });

    // Switching the branch to Claude must not fork past the Codex turns.
    expect(
      resolveBranchContextPlan({
        taskId,
        branchId,
        provider: 'claude',
        sessionExists: allSessionsExist,
      }),
    ).toEqual({ path: 'text', reason: 'branch-on-text-history' });
  });

  it('does not record a failed run', async () => {
    const { a2 } = await seedMainConversation();
    const branchId = createBranch(taskId, a2);
    const plan = resolveBranchContextPlan({
      taskId,
      branchId,
      provider: 'claude',
      sessionExists: allSessionsExist,
    });
    await recordRun({
      branchId,
      runId: 'failed-run',
      plan,
      sdkSessionId: 'sdk-failed',
      failed: true,
    });

    expect(getLatestBranchSdkSession(taskId, branchId)).toBeNull();
  });

  it('pins a branch to text history after regenerate', async () => {
    const { a2 } = await seedMainConversation();
    const branchId = createBranch(taskId, a2);
    const plan = resolveBranchContextPlan({
      taskId,
      branchId,
      provider: 'claude',
      sessionExists: allSessionsExist,
    });
    await recordRun({
      branchId,
      runId: 'branch-run',
      plan,
      sdkSessionId: 'sdk-branch',
    });

    invalidateBranchSdkSession(taskId, branchId);

    expect(
      resolveBranchContextPlan({
        taskId,
        branchId,
        provider: 'claude',
        sessionExists: allSessionsExist,
      }),
    ).toEqual({ path: 'text', reason: 'branch-on-text-history' });
  });
});

describe('restore files to a fork point', () => {
  beforeEach(createTaskRow);
  afterEach(cleanup);

  type Rewind = Parameters<typeof restoreFilesToForkPoint>[2];

  /** Main runs 2 and 3 edited files after a1; run 1 ends at a1. */
  async function seedEdits() {
    const seeded = await seedMainConversation();
    insertMessage({ type: 'tool_use', runId: 'run-2', toolName: 'Edit' });
    insertMessage({ type: 'user', runId: 'run-3', messageId: 'u3' });
    insertMessage({ type: 'tool_use', runId: 'run-3', toolName: 'Write' });
    insertMessage({ type: 'tool_use', runId: 'run-3', toolName: 'Bash' });
    await recordRun({
      branchId: 'main',
      runId: 'run-3',
      plan: { path: 'main' },
      sdkSessionId: 'sdk-main-3',
    });
    return seeded;
  }

  function recordingRewind(
    impl: (
      session: string | null,
      dryRun: boolean,
    ) => {
      canRewind: boolean;
      error?: string;
    } = () => ({ canRewind: true }),
  ) {
    const calls: string[] = [];
    const rewind: Rewind = vi.fn(async (run, { dryRun }) => {
      calls.push(`${dryRun ? 'dry' : 'real'}:${run.sdkSessionId}`);
      return {
        ...impl(run.sdkSessionId, dryRun),
        filesChanged: [`${run.sdkSessionId}.txt`],
      };
    });
    return { rewind, calls };
  }

  it('checks every run first, then rewinds newest first', async () => {
    const { a1 } = await seedEdits();
    const { rewind, calls } = recordingRewind();

    const result = await restoreFilesToForkPoint(taskId, a1, rewind);

    expect(calls).toEqual([
      'dry:sdk-main-3',
      'dry:sdk-main-2',
      'real:sdk-main-3',
      'real:sdk-main-2',
    ]);
    expect(vi.mocked(rewind).mock.calls[0]?.[0]).toMatchObject({
      promptSdkUuid: 'prompt-run-3',
      cwd: '/work/session-1',
    });
    expect(result).toEqual({
      rewoundRuns: 2,
      filesChanged: ['sdk-main-3.txt', 'sdk-main-2.txt'],
    });
  });

  it('changes no files when any run fails the dry run', async () => {
    const { a1 } = await seedEdits();
    const { rewind, calls } = recordingRewind((session, dryRun) =>
      dryRun && session === 'sdk-main-2'
        ? { canRewind: false, error: 'checkpoint missing' }
        : { canRewind: true },
    );

    await expect(
      restoreFilesToForkPoint(taskId, a1, rewind),
    ).rejects.toMatchObject({
      message: 'checkpoint missing',
      filesChanged: [],
    });
    expect(calls.filter((call) => call.startsWith('real'))).toEqual([]);
  });

  it('reports the files already restored when a rewind fails partway', async () => {
    const { a1 } = await seedEdits();
    const { rewind } = recordingRewind((session, dryRun) =>
      !dryRun && session === 'sdk-main-2'
        ? { canRewind: false, error: 'timed out' }
        : { canRewind: true },
    );

    await expect(
      restoreFilesToForkPoint(taskId, a1, rewind),
    ).rejects.toMatchObject({
      message: 'timed out',
      filesChanged: ['sdk-main-3.txt'],
    });
  });

  it('refuses when an edit after the fork point has no recorded checkpoint', async () => {
    const { a1 } = await seedEdits();
    // A failed run is never recorded, but its edits still changed files.
    insertMessage({ type: 'tool_use', runId: 'failed-run', toolName: 'Edit' });
    const { rewind, calls } = recordingRewind();

    await expect(restoreFilesToForkPoint(taskId, a1, rewind)).rejects.toThrow(
      /no Claude file checkpoint/,
    );
    expect(calls).toEqual([]);
  });

  it('refuses when there is nothing to restore', async () => {
    const { a2 } = await seedMainConversation();
    const { rewind } = recordingRewind();

    await expect(restoreFilesToForkPoint(taskId, a2, rewind)).rejects.toThrow(
      /No file edits/,
    );
  });

  it('rewinds the edited message run itself when restoring before a user message', async () => {
    const { u2 } = await seedEdits();
    const { rewind, calls } = recordingRewind();

    await restoreFilesToForkPoint(taskId, u2, rewind);

    expect(calls.filter((call) => call.startsWith('real'))).toEqual([
      'real:sdk-main-3',
      'real:sdk-main-2',
    ]);
  });
});
