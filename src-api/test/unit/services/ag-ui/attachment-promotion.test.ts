import { mkdtempSync, rmSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeDatabase } from '@/shared/db';
import {
  createMessage,
  createSession,
  createTask,
  getFilesByTaskId,
} from '@/shared/db/operations';
import {
  AttachmentPromotionService,
  isMediaGenerationToolName,
} from '@/shared/services/ag-ui/attachment-promotion';

let tempHome = '';

async function createTaskFixture() {
  const workspaceRoot = path.join(tempHome, '_Neumar');
  const taskId = 'task-attachment-promotion';
  const sessionCwd = path.join(workspaceRoot, 'sessions', `session-${taskId}`);
  const attachmentsDir = path.join(sessionCwd, 'attachments');

  await mkdir(attachmentsDir, { recursive: true });
  createSession({ id: 'session-attachment-promotion', prompt: 'test' });
  createTask({
    id: taskId,
    session_id: 'session-attachment-promotion',
    task_index: 0,
    prompt: 'test',
    work_dir: workspaceRoot,
  });

  return { attachmentsDir, sessionCwd, taskId };
}

describe('AttachmentPromotionService', () => {
  beforeEach(() => {
    tempHome = mkdtempSync(path.join(tmpdir(), 'neuma-attachment-promotion-'));
    vi.stubEnv('HOME', tempHome);
    closeDatabase();
  });

  afterEach(() => {
    closeDatabase();
    vi.unstubAllEnvs();
    rmSync(tempHome, { recursive: true, force: true });
    tempHome = '';
  });

  it('promotes DB attachment references once for media-generation tools', async () => {
    const { attachmentsDir, sessionCwd, taskId } = await createTaskFixture();
    const sourcePath = path.join(attachmentsDir, 'reference.png');
    await writeFile(sourcePath, 'image-bytes');
    createMessage({
      task_id: taskId,
      type: 'user',
      content: 'animate this',
      attachments: JSON.stringify([
        {
          id: 'att-1',
          type: 'image',
          name: 'reference.png',
          path: sourcePath,
          mimeType: 'image/png',
        },
      ]),
    });

    const service = new AttachmentPromotionService({
      taskId,
      runId: 'run-1',
      sessionCwd,
    });

    expect(
      isMediaGenerationToolName('mcp__media-generation__media_generate_image'),
    ).toBe(true);
    expect(
      isMediaGenerationToolName('mcp__media_generation__media_generate_image'),
    ).toBe(true);
    const first = await service.promoteForTool(
      'mcp__media-generation__media_generate_image',
      'tool-1',
    );
    const second = await service.promoteForTool(
      'media_generate_video',
      'tool-2',
    );

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);
    expect(first[0]!.name).toBe('att-1-reference.png');
    expect(first[0]!.path).toContain(path.join('output', 'run-1', 'inputs'));
    expect(await readFile(first[0]!.path, 'utf8')).toBe('image-bytes');
    expect(getFilesByTaskId(taskId)).toHaveLength(1);
  });

  it('falls back to scanning the session attachments folder', async () => {
    const { attachmentsDir, sessionCwd, taskId } = await createTaskFixture();
    const sourcePath = path.join(attachmentsDir, 'loose-reference.jpg');
    await writeFile(sourcePath, 'image-bytes');

    const service = new AttachmentPromotionService({
      taskId,
      runId: 'run-2',
      sessionCwd,
    });

    const promoted = await service.promoteForTool('generate_video', 'tool-1');

    expect(promoted).toHaveLength(1);
    expect(promoted[0]!.name).toMatch(/loose-reference\.jpg$/);
    expect(promoted[0]!.path).toContain(path.join('output', 'run-2', 'inputs'));
    expect(getFilesByTaskId(taskId)).toHaveLength(1);
  });

  it('ignores non-media tools', async () => {
    const { attachmentsDir, sessionCwd, taskId } = await createTaskFixture();
    await writeFile(path.join(attachmentsDir, 'reference.png'), 'image-bytes');

    const service = new AttachmentPromotionService({
      taskId,
      runId: 'run-3',
      sessionCwd,
    });

    expect(await service.promoteForTool('Read', 'tool-1')).toEqual([]);
    expect(getFilesByTaskId(taskId)).toHaveLength(0);
  });
});
