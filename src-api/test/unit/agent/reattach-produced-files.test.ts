import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeDatabase, getDatabase } from '@/shared/db';
import {
  createFile,
  createMessage,
  createSession,
  createTask,
  getMessagesByTaskId,
} from '@/shared/db/operations';
import { listTraceEventsForRun } from '@/shared/observability/trace';
import { dbMessagesToFullAGUI } from '@/shared/services/ag-ui/history';
import { AGUIEventPersister } from '@/shared/services/ag-ui/persistence';
import {
  canReconcilePendingDelivery,
  restoreReattachFiles,
} from '@/shared/services/ag-ui/reattach';

let tempHome = '';

function createTaskFixture() {
  const workspaceRoot = path.join(tempHome, '_Neumar');
  const sessionCwd = path.join(workspaceRoot, 'sessions', 'session-reattach');
  const taskId = 'task-reattach-produced-files';
  const sessionId = 'session-reattach-produced-files';

  createSession({ id: sessionId, prompt: 'make an artifact' });
  createTask({
    id: taskId,
    session_id: sessionId,
    task_index: 0,
    prompt: 'make an artifact',
    work_dir: workspaceRoot,
  });

  return { sessionCwd, taskId, workspaceRoot };
}

describe('AG-UI reattach produced files', () => {
  it('reattaches delivery only while a server deadline is pending', () => {
    const now = Date.parse('2026-08-08T00:00:00.000Z');
    expect(
      canReconcilePendingDelivery(
        {
          delivery: 'pending',
          delivery_reconciliation_deadline: '2026-08-08T00:01:00.000Z',
        },
        now,
      ),
    ).toBe(true);
    expect(
      canReconcilePendingDelivery(
        { delivery: 'pending', delivery_reconciliation_deadline: null },
        now,
      ),
    ).toBe(false);
    expect(
      canReconcilePendingDelivery(
        {
          delivery: 'pending',
          delivery_reconciliation_deadline: '2026-08-07T23:59:00.000Z',
        },
        now,
      ),
    ).toBe(false);
    expect(
      canReconcilePendingDelivery(
        {
          delivery: 'delivered',
          delivery_reconciliation_deadline: '2026-08-08T00:01:00.000Z',
        },
        now,
      ),
    ).toBe(false);
  });

  beforeEach(async () => {
    tempHome = await mkdtemp(path.join(tmpdir(), 'neuma-reattach-'));
    vi.stubEnv('HOME', tempHome);
    closeDatabase();
  });

  afterEach(async () => {
    closeDatabase();
    vi.unstubAllEnvs();
    await rm(tempHome, { recursive: true, force: true });
    tempHome = '';
  });

  it('rebuilds active-run files from DB rows and a fresh output-dir scan', async () => {
    const { sessionCwd, taskId, workspaceRoot } = createTaskFixture();
    const outputDir = path.join(sessionCwd, 'output');
    await mkdir(outputDir, { recursive: true });

    const oldFile = createFile({
      task_id: taskId,
      name: 'old.png',
      type: 'image',
      path: path.join(outputDir, 'old.png'),
      preview: 'old output',
    });
    getDatabase()
      .prepare('UPDATE files SET created_at = ? WHERE id = ?')
      .run('2000-01-01 00:00:00', oldFile.id);

    const runId = 'run-reattach';
    const persister = new AGUIEventPersister(
      taskId,
      runId,
      workspaceRoot,
      sessionCwd,
    );

    const explicitFile = createFile({
      task_id: taskId,
      name: 'explicit.html',
      type: 'website',
      path: path.join(sessionCwd, 'explicit.html'),
      preview: '<main>done</main>',
    });
    const scannedPath = path.join(outputDir, 'scanned.png');
    await writeFile(scannedPath, 'png');
    const scannedDbPath = await realpath(scannedPath);

    const { files, restoredFiles } = await restoreReattachFiles(taskId, {
      runId,
      startedAtMs: persister.runStartedAtMs,
      scanOutputArtifacts: () => persister.scanOutputArtifacts(),
      recordRestoredArtifact: (filePath) =>
        persister.recordReattachedArtifact(filePath),
    });

    expect(files.map((file) => file.path).sort()).toEqual(
      [oldFile.path, explicitFile.path, scannedDbPath].sort(),
    );
    expect(
      files
        .filter((file) => file.runId === runId && file.role === 'output')
        .map((file) => file.path)
        .sort(),
    ).toEqual([explicitFile.path, scannedDbPath].sort());
    expect(files.find((file) => file.path === oldFile.path)?.runId).toBe(
      undefined,
    );
    expect(restoredFiles).toBe(2);
    expect(
      listTraceEventsForRun(taskId, runId).filter(
        (event) => event.kind === 'artifact_write',
      ),
    ).toHaveLength(2);
  });

  it('rehydrates only persisted assistant text and thinking', () => {
    const { taskId } = createTaskFixture();
    createMessage({
      task_id: taskId,
      type: 'user',
      content: 'Build it',
      message_id: 'user-1',
    });
    createMessage({
      task_id: taskId,
      type: 'text',
      content: 'Here is the artifact.',
      message_id: 'assistant-1',
    });
    createMessage({
      task_id: taskId,
      type: 'text',
      subtype: 'thinking',
      content: 'Checking the output path.',
      message_id: 'thinking-1',
    });

    expect(dbMessagesToFullAGUI(getMessagesByTaskId(taskId))).toEqual([
      {
        id: 'user-1',
        role: 'user',
        content: 'Build it',
        attachments: undefined,
      },
      {
        id: 'assistant-1',
        role: 'assistant',
        content: 'Here is the artifact.',
      },
      {
        id: 'thinking-1',
        role: 'reasoning',
        content: 'Checking the output path.',
        subtype: 'thinking',
      },
    ]);
  });
});
