import {
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { DownloadMediaOperation } from '@neumar/video-ir';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { downloadAssetRoutes } from '@/app/api/download-assets';

import { closeDatabase } from '@/shared/db';
import {
  createSession,
  createTask,
  getFilesByTaskId,
} from '@/shared/db/operations';
import { registerDownloadAsset } from '@/shared/services/media-download/assets';

const TASK_ID = 'task-download-assets';
const BYTES = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 256));

let home = '';
let folder = '';

const operation = (): DownloadMediaOperation => ({
  version: 1,
  taskId: TASK_ID,
  runId: 'run-1',
  toolCallId: 'call-1',
  batchId: 'batch-1',
  destinationGrantId: 'a7a51dbe-bdf2-427d-b320-691d6872ef52',
  input: { urls: ['https://example.org/video'] },
});

async function register() {
  return registerDownloadAsset(
    operation(),
    'item-1',
    folder,
    path.join(folder, 'clip.mp4'),
  );
}

function serve(resolve: (scope: unknown) => Promise<string>) {
  const resolver = vi.fn(resolve);
  return { resolver, app: downloadAssetRoutes(resolver) };
}

const url = (assetId: string, taskId = TASK_ID) =>
  `/tasks/${taskId}/downloads/${assetId}`;

describe('task download assets', () => {
  beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), 'neumar-download-assets-'));
    vi.stubEnv('HOME', home);
    closeDatabase();
    createSession({ id: 'session-download-assets', prompt: 'test' });
    createTask({
      id: TASK_ID,
      session_id: 'session-download-assets',
      task_index: 0,
      prompt: 'test',
      work_dir: home,
    });
    folder = path.join(home, 'granted');
    mkdirSync(folder);
    writeFileSync(path.join(folder, 'clip.mp4'), BYTES);
  });

  afterEach(() => {
    closeDatabase();
    vi.unstubAllEnvs();
    rmSync(home, { recursive: true, force: true });
  });

  it('registers a finished file once and reports its authorized asset', async () => {
    const first = await register();
    const again = await register();

    expect(again).toEqual(first);
    expect(first).toMatchObject({
      name: 'clip.mp4',
      mime: 'video/mp4',
      size: BYTES.length,
    });
    const files = getFilesByTaskId(TASK_ID);
    expect(files).toHaveLength(1);
    expect(first.assetId).toBe(String(files[0]!.id));
  });

  it('refuses to register a file outside the granted folder', async () => {
    const elsewhere = path.join(home, 'elsewhere');
    mkdirSync(elsewhere);
    writeFileSync(path.join(elsewhere, 'other.mp4'), BYTES);

    await expect(
      registerDownloadAsset(
        operation(),
        'item-2',
        folder,
        path.join(elsewhere, 'other.mp4'),
      ),
    ).rejects.toThrow(/outside|ENOENT/);
    expect(getFilesByTaskId(TASK_ID)).toHaveLength(0);
  });

  it('serves byte ranges with 206 and exact bytes for the authorized task', async () => {
    const asset = await register();
    const { app, resolver } = serve(async () => folder);

    const range = await app.request(url(asset.assetId), {
      headers: { Range: 'bytes=10-19' },
    });
    expect(range.status).toBe(206);
    expect(range.headers.get('Content-Range')).toBe('bytes 10-19/1000');
    expect(range.headers.get('Accept-Ranges')).toBe('bytes');
    expect(range.headers.get('Content-Type')).toBe('video/mp4');
    expect(Buffer.from(await range.arrayBuffer())).toEqual(
      BYTES.subarray(10, 20),
    );

    const suffix = await app.request(url(asset.assetId), {
      headers: { Range: 'bytes=-5' },
    });
    expect(suffix.status).toBe(206);
    expect(Buffer.from(await suffix.arrayBuffer())).toEqual(
      BYTES.subarray(995),
    );

    const open = await app.request(url(asset.assetId), {
      headers: { Range: 'bytes=990-' },
    });
    expect(open.headers.get('Content-Range')).toBe('bytes 990-999/1000');

    const whole = await app.request(url(asset.assetId));
    expect(whole.status).toBe(200);
    expect(Buffer.from(await whole.arrayBuffer())).toEqual(BYTES);

    expect(resolver).toHaveBeenCalledWith({
      taskId: TASK_ID,
      runId: 'run-1',
      toolCallId: 'call-1',
      batchId: 'batch-1',
      destinationGrantId: 'a7a51dbe-bdf2-427d-b320-691d6872ef52',
    });
  });

  it('rejects ranges it cannot satisfy', async () => {
    const asset = await register();
    const { app } = serve(async () => folder);

    for (const header of [
      'bytes=2000-',
      'bytes=0-1,5-6',
      'bytes=-0',
      'pages=1',
    ]) {
      const res = await app.request(url(asset.assetId), {
        headers: { Range: header },
      });
      expect(res.status, header).toBe(416);
      expect(res.headers.get('Content-Range')).toBe('bytes */1000');
    }
  });

  it('does not stream an unknown asset or another task’s asset', async () => {
    const asset = await register();
    const { app, resolver } = serve(async () => folder);

    expect((await app.request(url('999999'))).status).toBe(404);
    expect((await app.request(url(asset.assetId, 'other-task'))).status).toBe(
      404,
    );
    expect(resolver).not.toHaveBeenCalled();
  });

  it('stops streaming when the grant is revoked or the folder is gone', async () => {
    const asset = await register();

    const revoked = serve(async () => {
      throw new Error('grant revoked');
    });
    expect((await revoked.app.request(url(asset.assetId))).status).toBe(404);

    const moved = serve(async () => path.join(home, 'nowhere'));
    expect((await moved.app.request(url(asset.assetId))).status).toBe(404);
  });

  it('stops streaming when the file is replaced or swapped for a symlink', async () => {
    const asset = await register();
    const { app } = serve(async () => folder);
    const target = path.join(folder, 'clip.mp4');

    // The replacement exists before the original is released, so it has a
    // different inode, which is what the registered identity guards.
    writeFileSync(path.join(folder, 'new.tmp'), BYTES);
    renameSync(path.join(folder, 'new.tmp'), target);
    expect((await app.request(url(asset.assetId))).status).toBe(404);

    const outside = path.join(home, 'outside.mp4');
    writeFileSync(outside, BYTES);
    symlinkSync(outside, path.join(folder, 'link.tmp'));
    renameSync(path.join(folder, 'link.tmp'), target);
    expect((await app.request(url(asset.assetId))).status).toBe(404);
  });
});
