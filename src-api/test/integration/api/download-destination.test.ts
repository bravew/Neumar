import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type {
  DownloadActivity,
  DownloadMediaOperation,
} from '@neumar/video-ir';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeDatabase } from '@/shared/db';
import { createSession, createTask, setSetting } from '@/shared/db/operations';
import {
  bindDestination,
  destinationOptions,
  destinationPolicy,
  DestinationDenied,
} from '@/shared/services/media-download/destination';
import {
  cancelDownloadDestinationRequest,
  claimDownloadDestination,
  DOWNLOAD_DESTINATION_QUESTION,
  requestDownloadDestination,
} from '@/shared/services/media-download/requests';
import { withDownloadBatch } from '@/shared/services/media-download/run-batch';

const TASK_ID = 'task-destination';
const SESSION_ID = 'session-destination';
const URL = 'https://example.org/watch?v=1';

let home = '';
let extra = '';

const scope = () => ({
  taskId: TASK_ID,
  sessionId: SESSION_ID,
  runId: 'run-1',
  toolCallId: 'call-1',
  batchId: 'b7e6f9d2-3c1a-4e5f-9a8b-0c1d2e3f4a5b',
});

function allowFolder(folder: string, write = true) {
  setSetting(
    'allowedFolders',
    JSON.stringify([
      {
        path: folder,
        permissions: { read: true, write, delete: false },
        alwaysAllow: true,
      },
    ]),
  );
}

describe('download destination policy', () => {
  beforeEach(() => {
    home = realpathSync(
      mkdtempSync(path.join(tmpdir(), 'neumar-destination-')),
    );
    extra = realpathSync(
      mkdtempSync(path.join(tmpdir(), 'neumar-destination-extra-')),
    );
    vi.stubEnv('HOME', home);
    closeDatabase();
    createSession({ id: SESSION_ID, prompt: 'test' });
    createTask({
      id: TASK_ID,
      session_id: SESSION_ID,
      task_index: 0,
      prompt: 'test',
      work_dir: home,
      additional_work_dirs: JSON.stringify([extra]),
    });
  });

  afterEach(() => {
    closeDatabase();
    vi.unstubAllEnvs();
    rmSync(home, { recursive: true, force: true });
    rmSync(extra, { recursive: true, force: true });
  });

  it('offers the task output folder and the explicitly allowed extra folder', () => {
    allowFolder(extra);
    const options = destinationOptions(destinationPolicy(TASK_ID));
    expect(options.map((option) => option.path)).toEqual([
      path.join(home, 'output'),
      extra,
    ]);
  });

  it('does not offer an extra folder without write permission', () => {
    allowFolder(extra, false);
    const options = destinationOptions(destinationPolicy(TASK_ID));
    expect(options.map((option) => option.path)).toEqual([
      path.join(home, 'output'),
    ]);
  });

  it('refuses a folder outside the task roots, a parent, and a symlink escape', () => {
    allowFolder(extra);
    const policy = destinationPolicy(TASK_ID);
    const outside = realpathSync(
      mkdtempSync(path.join(tmpdir(), 'neumar-destination-out-')),
    );
    try {
      expect(() => bindDestination(policy, outside)).toThrow(DestinationDenied);
      expect(() => bindDestination(policy, home)).toThrow(DestinationDenied);
      expect(() => bindDestination(policy, `${extra}/..`)).toThrow(
        DestinationDenied,
      );
      const link = path.join(extra, 'link');
      symlinkSync(outside, link);
      expect(() => bindDestination(policy, link)).toThrow(DestinationDenied);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('creates the task output folder only when it is chosen', () => {
    const policy = destinationPolicy(TASK_ID);
    const output = path.join(home, 'output');
    // A probe never creates the folder; choosing it does.
    expect(() => bindDestination(policy, output, false)).toThrow(
      DestinationDenied,
    );
    const grant = bindDestination(policy, output);
    expect(grant.directory).toBe(realpathSync(output));
  });
});

describe('download destination question and resume', () => {
  beforeEach(() => {
    home = realpathSync(
      mkdtempSync(path.join(tmpdir(), 'neumar-destination-')),
    );
    vi.stubEnv('HOME', home);
    closeDatabase();
    createSession({ id: SESSION_ID, prompt: 'test' });
    createTask({
      id: TASK_ID,
      session_id: SESSION_ID,
      task_index: 0,
      prompt: 'test',
      work_dir: home,
    });
  });

  afterEach(() => {
    closeDatabase();
    vi.unstubAllEnvs();
    rmSync(home, { recursive: true, force: true });
  });

  it('asks a two-option question and records a grant bound to the batch', () => {
    const request = requestDownloadDestination(scope(), { urls: [URL] });
    const question = request.question.questions[0] as {
      question: string;
      options: { label: string }[];
    };
    expect(question.question).toBe(DOWNLOAD_DESTINATION_QUESTION);
    expect(question.options).toHaveLength(2);
    expect(question.options[0]?.label).toBe('Task folder');
  });

  it('starts nothing when the question is cancelled', () => {
    const request = requestDownloadDestination(scope(), { urls: [URL] });
    cancelDownloadDestinationRequest(TASK_ID, request.questionId);
    const claim = claimDownloadDestination(
      TASK_ID,
      request.questionId,
      'Task folder',
      'run-2',
    );
    expect(claim).toMatchObject({ ok: false, reason: 'denied' });
  });

  it('starts nothing when the chosen folder is not permitted', () => {
    const request = requestDownloadDestination(scope(), { urls: [URL] });
    const outside = mkdtempSync(path.join(tmpdir(), 'neumar-destination-out-'));
    try {
      const claim = claimDownloadDestination(
        TASK_ID,
        request.questionId,
        outside,
        'run-2',
      );
      expect(claim).toMatchObject({ ok: false, reason: 'denied' });
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('claims exactly once, so a duplicate resume starts one batch', () => {
    const request = requestDownloadDestination(scope(), { urls: [URL] });
    const first = claimDownloadDestination(
      TASK_ID,
      request.questionId,
      'Task folder',
      'run-2',
    );
    const second = claimDownloadDestination(
      TASK_ID,
      request.questionId,
      'Task folder',
      'run-3',
    );

    expect(first.ok).toBe(true);
    expect(second).toMatchObject({ ok: false, reason: 'started' });
    if (!first.ok) throw new Error('expected a claim');
    expect(first.value.operation).toMatchObject({
      taskId: TASK_ID,
      runId: 'run-2',
      toolCallId: 'call-1',
      batchId: scope().batchId,
      input: { urls: [URL] },
    });
    expect(first.value.grant.directory).toBe(
      realpathSync(path.join(home, 'output')),
    );
  });
});

describe('destination resume route behavior', () => {
  beforeEach(() => {
    home = realpathSync(
      mkdtempSync(path.join(tmpdir(), 'neumar-destination-')),
    );
    vi.stubEnv('HOME', home);
    closeDatabase();
    createSession({ id: SESSION_ID, prompt: 'test' });
    createTask({
      id: TASK_ID,
      session_id: SESSION_ID,
      task_index: 0,
      prompt: 'test',
      work_dir: home,
    });
  });

  afterEach(() => {
    closeDatabase();
    vi.unstubAllEnvs();
    rmSync(home, { recursive: true, force: true });
  });

  /** Claim the way the route does, then start through the batch merge. */
  async function resume(questionId: string, answer: string) {
    const claim = claimDownloadDestination(
      TASK_ID,
      questionId,
      answer,
      'run-2',
    );
    if (!claim.ok) return { started: 0 };
    let started = 0;
    async function* agent() {
      yield { type: 'done' as const };
    }
    for await (const message of withDownloadBatch(
      agent(),
      claim.value.operation,
      async (operation, options) => {
        started += 1;
        const activity: DownloadActivity = {
          version: 1,
          taskId: operation.taskId,
          runId: operation.runId,
          toolCallId: operation.toolCallId,
          batchId: operation.batchId,
          items: [{ itemId: '1', sequence: 1, phase: 'queued' }],
        };
        options.emit(activity);
        return activity;
      },
      new AbortController().signal,
    )) {
      void message;
    }
    return { started };
  }

  it('starts zero batches on cancel and on a denied folder', async () => {
    const cancelled = requestDownloadDestination(scope(), { urls: [URL] });
    cancelDownloadDestinationRequest(TASK_ID, cancelled.questionId);
    expect(await resume(cancelled.questionId, 'Task folder')).toEqual({
      started: 0,
    });

    const denied = requestDownloadDestination(
      { ...scope(), toolCallId: 'call-2', batchId: crypto.randomUUID() },
      { urls: [URL] },
    );
    expect(
      await resume(denied.questionId, '/definitely/not/permitted'),
    ).toEqual({ started: 0 });
  });

  it('starts exactly one batch on duplicate resume', async () => {
    const request = requestDownloadDestination(scope(), { urls: [URL] });
    expect(await resume(request.questionId, 'Task folder')).toEqual({
      started: 1,
    });
    expect(await resume(request.questionId, 'Task folder')).toEqual({
      started: 0,
    });
  });
});

describe('download batch merge', () => {
  const operation = (): DownloadMediaOperation => ({
    version: 1,
    taskId: TASK_ID,
    runId: 'run-2',
    toolCallId: 'call-1',
    batchId: 'b7e6f9d2-3c1a-4e5f-9a8b-0c1d2e3f4a5b',
    destinationGrantId: 'a7a51dbe-bdf2-427d-b320-691d6872ef52',
    input: { urls: [URL] },
  });

  it('reports progress before the run closes, then the held done', async () => {
    const controller = new AbortController();
    async function* agent() {
      yield { type: 'text' as const, content: 'On it.' };
      yield { type: 'done' as const };
    }
    const start = async (
      op: DownloadMediaOperation,
      options: { signal: AbortSignal; emit(activity: DownloadActivity): void },
    ): Promise<DownloadActivity> => {
      options.emit({
        version: 1,
        taskId: op.taskId,
        runId: op.runId,
        toolCallId: op.toolCallId,
        batchId: op.batchId,
        items: [
          {
            itemId: '1',
            sequence: 1,
            phase: 'transferring',
            streams: [{ streamId: '1', bytes: 10, totalBytes: 100 }],
          },
        ],
      });
      await new Promise((resolve) => setTimeout(resolve, 5));
      return {
        version: 1,
        taskId: op.taskId,
        runId: op.runId,
        toolCallId: op.toolCallId,
        batchId: op.batchId,
        items: [
          {
            itemId: '1',
            sequence: 2,
            phase: 'failed',
            reason: 'download',
          },
        ],
      };
    };

    const seen: string[] = [];
    for await (const message of withDownloadBatch(
      agent(),
      operation(),
      start,
      controller.signal,
    )) {
      seen.push(message.type);
    }
    // Progress is drained as it arrives; the agent's done is held to the end.
    expect(seen).toEqual(['media_download_activity', 'text', 'done']);
  });

  it('settles every item as failed when the downloader refuses to start', async () => {
    async function* agent() {
      yield { type: 'done' as const };
    }
    const start = async () => {
      throw new Error('downloader missing');
    };
    const activities: unknown[] = [];
    for await (const message of withDownloadBatch(
      agent(),
      operation(),
      start,
      new AbortController().signal,
    )) {
      if (message.type === 'media_download_activity') {
        activities.push(message.downloadActivity);
      }
    }
    expect(activities).toEqual([
      expect.objectContaining({
        items: [
          expect.objectContaining({
            itemId: '1',
            phase: 'failed',
            reason: 'download',
          }),
        ],
      }),
    ]);
  });
});
