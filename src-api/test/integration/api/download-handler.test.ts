import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { DownloadActivity } from '@neumar/video-ir';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeDatabase, getDatabase } from '@/shared/db';
import {
  createSession,
  createTask,
  getFilesByTaskId,
  setSetting,
} from '@/shared/db/operations';
import {
  bindDestination,
  destinationPolicy,
} from '@/shared/services/media-download/destination';
import { startDownloadBatch } from '@/shared/services/media-download/downloader';
import { directRuntime } from '@/shared/services/media-download/runtime';

const FAKE_YTDLP = `#!/bin/sh
stage=""
while [ $# -gt 0 ]; do
  case "$1" in
    -P) stage="$2"; shift 2 ;;
    --) shift; url="$1"; shift ;;
    *) shift ;;
  esac
done
name="clip.mp4"
printf '%s\\n' 'NDPROGRESS:{"stream":"137","bytes":1024,"total":4096,"estimate":null,"speed":512,"eta":6}'
printf '%s\\n' 'NDFINISH'
head -c 64 /dev/zero > "$stage/$name"
printf 'NDFILE:"%s"\\n' "$stage/$name"
`;

let binary = '';
let home = '';
let granted = '';
let grantId = '';

vi.mock('@/shared/services/media-download/runtime', async () => {
  const actual = await vi.importActual<
    typeof import('@/shared/services/media-download/runtime')
  >('@/shared/services/media-download/runtime');
  return {
    ...actual,
    managedMediaRuntime: {
      prepare: (
        ...args: Parameters<ReturnType<typeof actual.directRuntime>['prepare']>
      ) =>
        directRuntime(process.env.TEST_FAKE_YTDLP ?? '/bin/false').prepare(
          ...args,
        ),
    },
  };
});

const TASK_ID = 'task-downloader';
const SESSION_ID = 'session-downloader';

describe('registered download handler', () => {
  beforeEach(() => {
    home = realpathSync(mkdtempSync(path.join(tmpdir(), 'neumar-downloader-')));
    vi.stubEnv('HOME', home);
    binary = path.join(home, 'fake-yt-dlp');
    writeFileSync(binary, FAKE_YTDLP);
    chmodSync(binary, 0o755);
    vi.stubEnv('TEST_FAKE_YTDLP', binary);
    closeDatabase();
    createSession({ id: SESSION_ID, prompt: 'test' });
    createTask({
      id: TASK_ID,
      session_id: SESSION_ID,
      task_index: 0,
      prompt: 'test',
      work_dir: home,
    });
    granted = path.join(home, 'output');
    mkdirSync(granted);
    setSetting('allowedFolders', JSON.stringify([]));
    const bound = bindDestination(destinationPolicy(TASK_ID), granted);
    grantId = crypto.randomUUID();
    getDatabase()
      .prepare(
        `INSERT INTO download_destination_grants
           (id, task_id, run_id, tool_call_id, batch_id, question_id,
            directory, device, inode, options_json, input_json, created_at)
         VALUES (?, ?, 'run-1', 'call-1', 'batch-1', NULL, ?, ?, ?, '[]', ?, ?)`,
      )
      .run(
        grantId,
        TASK_ID,
        bound.directory,
        bound.device,
        bound.inode,
        JSON.stringify({ urls: ['https://example.org/video'] }),
        Date.now(),
      );
  });

  afterEach(() => {
    closeDatabase();
    vi.unstubAllEnvs();
    rmSync(home, { recursive: true, force: true });
  });

  it('runs the registered handler, reports progress and registers the file once', async () => {
    const activities: DownloadActivity[] = [];
    const state = await startDownloadBatch(
      {
        version: 1,
        taskId: TASK_ID,
        runId: 'run-2',
        toolCallId: 'call-1',
        batchId: 'batch-1',
        destinationGrantId: grantId,
        input: { urls: ['https://example.org/video'] },
      },
      {
        signal: new AbortController().signal,
        emit: (activity) => activities.push(activity),
      },
    );

    expect(state.items).toEqual([expect.objectContaining({ phase: 'saved' })]);
    expect(
      activities.some((activity) =>
        activity.items.some((item) => item.phase === 'transferring'),
      ),
    ).toBe(true);
    const files = getFilesByTaskId(TASK_ID);
    expect(files).toHaveLength(1);
    expect(files[0]?.path).toBe(path.join(granted, 'clip.mp4'));
  });

  it('refuses a grant whose folder is no longer permitted', async () => {
    // A grant made while the folder was allowed stops authorizing a write once
    // the permission is withdrawn, even though the row still names it.
    const extra = realpathSync(
      mkdtempSync(path.join(tmpdir(), 'neumar-extra-')),
    );
    setSetting(
      'allowedFolders',
      JSON.stringify([
        {
          path: extra,
          permissions: { read: true, write: true, delete: false },
          alwaysAllow: true,
        },
      ]),
    );
    getDatabase()
      .prepare('UPDATE tasks SET additional_work_dirs = ? WHERE id = ?')
      .run(JSON.stringify([extra]), TASK_ID);
    const bound = bindDestination(destinationPolicy(TASK_ID), extra);
    const revokedGrant = crypto.randomUUID();
    getDatabase()
      .prepare(
        `INSERT INTO download_destination_grants
           (id, task_id, run_id, tool_call_id, batch_id, question_id,
            directory, device, inode, options_json, input_json, created_at)
         VALUES (?, ?, 'run-1', 'call-9', 'batch-9', NULL, ?, ?, ?, '[]', ?, ?)`,
      )
      .run(
        revokedGrant,
        TASK_ID,
        bound.directory,
        bound.device,
        bound.inode,
        JSON.stringify({ urls: ['https://example.org/video'] }),
        Date.now(),
      );
    setSetting('allowedFolders', JSON.stringify([]));

    const state = await startDownloadBatch(
      {
        version: 1,
        taskId: TASK_ID,
        runId: 'run-2',
        toolCallId: 'call-9',
        batchId: 'batch-9',
        destinationGrantId: revokedGrant,
        input: { urls: ['https://example.org/video'] },
      },
      {
        signal: new AbortController().signal,
        emit: () => undefined,
      },
    );

    expect(state.items[0]).toMatchObject({ phase: 'failed', reason: 'denied' });
    expect(getFilesByTaskId(TASK_ID)).toHaveLength(0);
    rmSync(extra, { recursive: true, force: true });
  });
});
