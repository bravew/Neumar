import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildAgentPrompt,
  notifyAttachmentFailures,
  resolveAttachmentsForSubmit,
} from '@/components/task/taskV2-submit-helpers';
import type { MessageAttachment } from '@/shared/hooks/useAgent';
import {
  type AttachmentStagingFailure,
  resolveFileAttachments,
} from '@/shared/lib/attachments';
import { computeSessionFolder } from '@/shared/lib/session';
import { isTauriRuntime } from '@/shared/utils/tauri';

vi.mock('@/shared/lib/attachments', () => ({
  resolveFileAttachments: vi.fn(),
}));
vi.mock('@/shared/lib/session', () => ({ computeSessionFolder: vi.fn() }));
vi.mock('@/shared/utils/tauri', () => ({ isTauriRuntime: vi.fn() }));
vi.mock('@/shared/db/settings', () => ({
  getSettings: () => ({ attachmentUploadLimitMb: 100 }),
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

const fileAttachment: MessageAttachment = {
  id: 'video',
  type: 'file',
  name: 'clip.mp4',
  data: '',
  mimeType: 'video/mp4',
  file: new File(['clip'], 'clip.mp4', { type: 'video/mp4' }),
};
const tooLarge: AttachmentStagingFailure = {
  id: 'video',
  name: 'clip.mp4',
  reason: 'too_large',
  limitBytes: 50 * 1024 * 1024,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isTauriRuntime).mockReturnValue(false);
  vi.mocked(computeSessionFolder).mockResolvedValue(
    '/workspace/sessions/session-task',
  );
  vi.mocked(resolveFileAttachments).mockResolvedValue([]);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('resolveAttachmentsForSubmit', () => {
  it('returns a reported 413 failure that blocks submission and preserves its configured limit', async () => {
    // The resolver translates the backend HTTP 413 into this typed failure.
    vi.mocked(resolveFileAttachments).mockImplementation(
      async (_attachments, _folder, _workDir, context) => {
        context?.onFailure?.(tooLarge);
        return [];
      },
    );

    const staged = await resolveAttachmentsForSubmit(
      [fileAttachment],
      'task',
      '/workspace',
    );

    expect(staged.failures).toEqual([tooLarge]);
    expect(staged.attachments?.[0].path).toBeUndefined();
    expect(staged.attachments?.[0].file).toBeUndefined();
    const translate = vi.fn(() => 'File exceeds 50 MB');
    expect(notifyAttachmentFailures(staged.failures, translate)).toBe(true);
    expect(translate).toHaveBeenCalledWith('task.attachmentTooLarge', {
      name: 'clip.mp4',
      limit: 50,
    });
    expect(toast.error).toHaveBeenCalledWith('File exceeds 50 MB');
  });

  it('permits an inline image when staging fails because its data still reaches the agent', async () => {
    const image: MessageAttachment = {
      id: 'image',
      type: 'image',
      name: 'image.png',
      mimeType: 'image/png',
      data: 'aW1hZ2U=',
      file: new File(['image'], 'image.png', { type: 'image/png' }),
    };
    vi.mocked(resolveFileAttachments).mockImplementation(
      async (_attachments, _folder, _workDir, context) => {
        context?.onFailure?.({
          id: image.id,
          name: image.name,
          reason: 'too_large',
          limitBytes: 1,
        });
        return [];
      },
    );

    const staged = await resolveAttachmentsForSubmit(
      [image],
      'task',
      '/workspace',
    );

    expect(staged.failures).toEqual([]);
    expect(staged.attachments).toEqual([{ ...image, file: undefined }]);
    expect(
      buildAgentPrompt('Inspect image', staged.attachments).imageBlocks,
    ).toEqual([{ type: 'image', image: 'data:image/png;base64,aW1hZ2U=' }]);
  });

  it('blocks a pathless image without inline data when no reference is saved', async () => {
    const image: MessageAttachment = {
      id: 'image',
      type: 'image',
      name: 'empty.png',
      data: '',
    };

    const staged = await resolveAttachmentsForSubmit(
      [image],
      'task',
      '/workspace',
    );

    expect(staged.failures).toEqual([
      {
        id: image.id,
        name: image.name,
        reason: 'error',
        message: 'Could not save the attachment',
      },
    ]);
  });

  it('passes native desktop paths through without staging or creating a session folder', async () => {
    vi.mocked(isTauriRuntime).mockReturnValue(true);
    const native = { ...fileAttachment, path: '/media/clip.mp4' };

    const staged = await resolveAttachmentsForSubmit(
      [native],
      'task',
      '/workspace',
    );

    expect(staged).toEqual({
      attachments: [{ ...native, file: undefined }],
      failures: [],
    });
    expect(native.file).toBe(fileAttachment.file);
    expect(computeSessionFolder).not.toHaveBeenCalled();
    expect(resolveFileAttachments).not.toHaveBeenCalled();
  });

  it('stages only pathless desktop attachments and keeps their original order', async () => {
    vi.mocked(isTauriRuntime).mockReturnValue(true);
    const native = { ...fileAttachment, path: 'C:\\media\\clip.mp4' };
    const pasted: MessageAttachment = {
      id: 'pasted',
      type: 'file',
      name: 'notes.txt',
      data: 'bm90ZXM=',
    };
    vi.mocked(resolveFileAttachments).mockResolvedValue([
      {
        id: pasted.id,
        type: 'file',
        name: pasted.name,
        path: '/workspace/sessions/session-task/attachments/notes.txt',
        mimeType: 'text/plain',
      },
    ]);

    const staged = await resolveAttachmentsForSubmit(
      [pasted, native],
      'task',
      '/workspace',
    );

    expect(resolveFileAttachments).toHaveBeenCalledWith(
      [pasted],
      '/workspace/sessions/session-task',
      '/workspace',
      {
        taskId: 'task',
        workDir: '/workspace',
        onFailure: expect.any(Function),
      },
    );
    expect(staged.failures).toEqual([]);
    expect(staged.attachments).toEqual([
      {
        ...pasted,
        path: '/workspace/sessions/session-task/attachments/notes.txt',
        mimeType: 'text/plain',
        file: undefined,
      },
      { ...native, file: undefined },
    ]);
  });

  it('stages browser paths through the resolver instead of using the desktop fast path', async () => {
    const browser = { ...fileAttachment, path: '/media/clip.mp4' };
    vi.mocked(resolveFileAttachments).mockResolvedValue([
      {
        id: browser.id,
        type: 'file',
        name: browser.name,
        path: '/workspace/sessions/session-task/attachments/clip.mp4',
      },
    ]);

    const staged = await resolveAttachmentsForSubmit(
      [browser],
      'task',
      '/workspace',
    );

    expect(resolveFileAttachments).toHaveBeenCalledWith(
      [browser],
      '/workspace/sessions/session-task',
      '/workspace',
      expect.objectContaining({ taskId: 'task' }),
    );
    expect(staged.attachments?.[0].path).toBe(
      '/workspace/sessions/session-task/attachments/clip.mp4',
    );
    expect(staged.failures).toEqual([]);
  });
});
