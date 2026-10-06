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
import { requestAttachByPath } from '@/shared/lib/local-path';
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
    const translate = vi.fn((key: string) =>
      key === 'task.attachByPath' ? 'Attach by path' : 'File exceeds 50 MB',
    );
    expect(notifyAttachmentFailures(staged.failures, translate)).toBe(true);
    // The page is served from localhost, so the API can read a typed path.
    expect(translate).toHaveBeenCalledWith('task.attachmentTooLargeLocal', {
      name: 'clip.mp4',
      limit: 50,
    });
    expect(toast.error).toHaveBeenCalledWith('File exceeds 50 MB', {
      action: { label: 'Attach by path', onClick: requestAttachByPath },
    });
  });

  it('keeps the plain over-limit message when the page is not on the API machine', () => {
    vi.spyOn(window, 'location', 'get').mockReturnValue({
      hostname: 'workstation.lan',
    } as Location);
    const translate = vi.fn(() => 'File exceeds 50 MB');

    notifyAttachmentFailures([tooLarge], translate);

    expect(translate).toHaveBeenCalledWith('task.attachmentTooLarge', {
      name: 'clip.mp4',
      limit: 50,
    });
    expect(toast.error).toHaveBeenCalledWith('File exceeds 50 MB', undefined);
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

  it('reads a browser attachment that carries a verified path in place instead of copying it', async () => {
    // Attached by path: the file is multi-gigabyte, so it must not be copied
    // into the session folder or counted against the upload limit.
    const byPath = {
      ...fileAttachment,
      file: undefined,
      path: '/Users/me/Movies/clip.mp4',
    };

    const staged = await resolveAttachmentsForSubmit(
      [byPath],
      'task',
      '/workspace',
    );

    expect(resolveFileAttachments).not.toHaveBeenCalled();
    expect(staged.attachments).toEqual([byPath]);
    expect(staged.failures).toEqual([]);
  });

  it('still stages an in-memory browser file while passing an in-place path through', async () => {
    const byPath = { ...fileAttachment, id: 'big', path: '/Users/me/big.mov' };
    const pasted = { ...fileAttachment, id: 'pasted' };
    vi.mocked(resolveFileAttachments).mockResolvedValue([
      {
        id: 'pasted',
        type: 'file',
        name: 'clip.mp4',
        path: '/workspace/sessions/session-task/attachments/clip.mp4',
      },
    ]);

    const staged = await resolveAttachmentsForSubmit(
      [byPath, pasted],
      'task',
      '/workspace',
    );

    expect(resolveFileAttachments).toHaveBeenCalledWith(
      [pasted],
      '/workspace/sessions/session-task',
      '/workspace',
      expect.objectContaining({ taskId: 'task' }),
    );
    expect(staged.attachments?.map((a) => a.path)).toEqual([
      '/Users/me/big.mov',
      '/workspace/sessions/session-task/attachments/clip.mp4',
    ]);
  });
});
