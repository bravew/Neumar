import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { filesRoutes } from '@/app/api/files';

import { closeDatabase, getDatabase } from '@/shared/db';
import { setSetting } from '@/shared/db/operations';
import {
  ATTACHMENT_UPLOAD_LIMIT_SETTING,
  requestBodyLimit,
  resolveRequestBodyLimit,
} from '@/shared/http/body-limit';

const MB = 1024 * 1024;
const TASK_ID = 'attachment-save-task';

function clearUploadLimitSetting() {
  getDatabase()
    .prepare('DELETE FROM settings WHERE key = ?')
    .run(ATTACHMENT_UPLOAD_LIMIT_SETTING);
}

function attachmentApp() {
  const app = new Hono();
  app.use('*', requestBodyLimit);
  app.route('/files', filesRoutes);
  return app;
}

function upload(
  bytes: number,
  workDir: string,
  headers: Record<string, string> = {},
) {
  const query = new URLSearchParams({
    taskId: TASK_ID,
    workDir,
    name: 'clip.mp4',
  });
  return attachmentApp().request(`/files/attachment-save?${query}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', ...headers },
    body: new Uint8Array(bytes),
  });
}

describe('POST /files/attachment-save (streamed upload)', () => {
  let workDir: string;
  let attachmentsDir: string;

  beforeEach(async () => {
    closeDatabase();
    clearUploadLimitSetting();
    workDir = await fs.mkdtemp(path.join('/tmp', 'files-attachment-save-'));
    attachmentsDir = path.join(
      workDir,
      'sessions',
      `session-${TASK_ID}`,
      'attachments',
    );
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    clearUploadLimitSetting();
    closeDatabase();
    await fs.rm(workDir, { recursive: true, force: true });
  });

  it('streams an upload larger than the old 10 MB global cap into the session folder', async () => {
    // A 146 MB video was rejected by the 10 MB global body limit before the
    // handler ran, and the agent then never saw the attachment.
    const res = await upload(12 * MB, workDir);

    expect(res.status).toBe(200);
    const { path: saved } = (await res.json()) as { path: string };
    expect(path.dirname(saved)).toBe(attachmentsDir);
    expect(saved).toMatch(/_clip\.mp4$/);
    expect((await fs.stat(saved)).size).toBe(12 * MB);
  });

  it('rejects uploads over the configured limit and leaves no partial file', async () => {
    setSetting(ATTACHMENT_UPLOAD_LIMIT_SETTING, '1');

    const res = await upload(MB + 1, workDir);

    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({
      error: 'File too large',
      limitBytes: MB,
    });
    await expect(fs.readdir(attachmentsDir)).resolves.toEqual([]);
  });

  it.each([false, true])(
    'starts the mounted upload before EOF (transfer-encoding: %s)',
    async (chunked) => {
      let reachedEof = false;
      let startedBeforeEof = false;
      let emitted = false;
      const app = new Hono();
      app.use('*', requestBodyLimit);
      app.use('/files/attachment-save', async (_c, next) => {
        startedBeforeEof = !reachedEof;
        await next();
      });
      app.route('/files', filesRoutes);
      const query = new URLSearchParams({
        taskId: TASK_ID,
        workDir,
        name: 'clip.mp4',
      });
      const headers = new Headers({
        'Content-Type': 'application/octet-stream',
      });
      if (chunked) headers.set('Transfer-Encoding', 'chunked');
      const init: RequestInit & { duplex: 'half' } = {
        method: 'POST',
        headers,
        body: new ReadableStream<Uint8Array>({
          pull(controller) {
            if (!emitted) {
              emitted = true;
              controller.enqueue(new Uint8Array(MB));
            } else {
              reachedEof = true;
              controller.close();
            }
          },
        }),
        duplex: 'half',
      };
      const request = new Request(
        `http://localhost/files/attachment-save?${query}`,
        init,
      );

      const res = await app.request(request);

      expect(res.status).toBe(200);
      expect(startedBeforeEof).toBe(true);
      expect(reachedEof).toBe(true);
      const { path: saved } = (await res.json()) as { path: string };
      expect((await fs.stat(saved)).size).toBe(MB);
    },
  );

  it('rejects an oversized Content-Length before creating an attachment directory', async () => {
    setSetting(ATTACHMENT_UPLOAD_LIMIT_SETTING, '1');

    const res = await upload(4, workDir, {
      'Content-Length': String(MB + 1),
    });

    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({
      error: 'File too large',
      limitBytes: MB,
    });
    await expect(fs.stat(attachmentsDir)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it.each([false, true])(
    'keeps JSON copy metadata capped at 10 MB (content-length: %s)',
    async (withLength) => {
      const body = JSON.stringify({
        taskId: TASK_ID,
        workDir,
        sourcePath: path.join(workDir, 'source.mp4'),
        name: 'x'.repeat(10 * MB),
      });
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (withLength) {
        headers['Content-Length'] = String(Buffer.byteLength(body));
      }

      const res = await attachmentApp().request('/files/attachment-save', {
        method: 'POST',
        headers,
        body,
      });

      expect(res.status).toBe(413);
      expect(await res.json()).toEqual({
        error: 'Payload Too Large',
        limitBytes: 10 * MB,
      });
      await expect(fs.stat(attachmentsDir)).rejects.toMatchObject({
        code: 'ENOENT',
      });
    },
  );

  it('does not apply the raw upload limit to JSON copy metadata', async () => {
    setSetting(ATTACHMENT_UPLOAD_LIMIT_SETTING, '1');
    const sourcePath = path.join(workDir, 'source.mp4');
    await fs.writeFile(sourcePath, 'source bytes');

    const res = await attachmentApp().request('/files/attachment-save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        taskId: TASK_ID,
        workDir,
        sourcePath,
        name: 'x'.repeat(MB + 1),
      }),
    });

    expect(res.status).toBe(200);
    const { path: saved } = (await res.json()) as { path: string };
    expect(await fs.readFile(saved, 'utf8')).toBe('source bytes');
  });

  it('preserves an existing attachment when exclusive creation collides', async () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(
      '12345678-1234-1234-1234-123456789abc',
    );
    const existingPath = path.join(attachmentsDir, '12345678_clip.mp4');
    await fs.mkdir(attachmentsDir, { recursive: true });
    await fs.writeFile(existingPath, 'existing attachment');

    const res = await upload(4, workDir);

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: expect.stringContaining('EEXIST'),
    });
    expect(await fs.readFile(existingPath, 'utf8')).toBe('existing attachment');
    expect(await fs.readdir(attachmentsDir)).toEqual(['12345678_clip.mp4']);
  });

  it('requires a file name for streamed uploads', async () => {
    const query = new URLSearchParams({ taskId: TASK_ID, workDir });
    const res = await filesRoutes.request(`/attachment-save?${query}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: new Uint8Array(4),
    });

    expect(res.status).toBe(400);
  });
});

describe('resolveRequestBodyLimit', () => {
  beforeEach(() => {
    closeDatabase();
    clearUploadLimitSetting();
  });
  afterEach(() => {
    clearUploadLimitSetting();
    closeDatabase();
  });

  it('applies the attachment setting (default 1 GB) only to the upload route', () => {
    expect(resolveRequestBodyLimit('/files/attachment-save')).toBe(1024 * MB);
    expect(resolveRequestBodyLimit('/files/read')).toBe(10 * MB);
    expect(resolveRequestBodyLimit('/agent/run')).toBe(100 * MB);
    expect(resolveRequestBodyLimit('/video/upload')).toBe(500 * MB);
  });

  it('follows the configured limit and clamps out-of-range values', () => {
    setSetting(ATTACHMENT_UPLOAD_LIMIT_SETTING, '2048');
    expect(resolveRequestBodyLimit('/files/attachment-save')).toBe(2048 * MB);

    setSetting(ATTACHMENT_UPLOAD_LIMIT_SETTING, '999999');
    expect(resolveRequestBodyLimit('/files/attachment-save')).toBe(4096 * MB);

    setSetting(ATTACHMENT_UPLOAD_LIMIT_SETTING, 'not-a-number');
    expect(resolveRequestBodyLimit('/files/attachment-save')).toBe(1024 * MB);
  });
});
