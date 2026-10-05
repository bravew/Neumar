import { mkdir, writeFile } from '@tauri-apps/plugin-fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { API_BASE_URL } from '@/config';
import type { MessageAttachment } from '@/shared/hooks/useAgent';
import { resolveFileAttachments } from '@/shared/lib/attachments';
import { isTauriRuntime } from '@/shared/utils/tauri';

vi.mock('@/shared/utils/tauri', () => ({ isTauriRuntime: vi.fn() }));
vi.mock('@tauri-apps/plugin-fs', () => ({
  mkdir: vi.fn(),
  writeFile: vi.fn(),
}));

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockReset();
  vi.mocked(isTauriRuntime).mockReturnValue(true);
  vi.mocked(mkdir).mockResolvedValue(undefined);
  vi.mocked(writeFile).mockResolvedValue(undefined);
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function makeFileAttachment() {
  const file = new File(['video bytes'], 'original.mp4', { type: 'video/mp4' });
  // jsdom does not implement Blob.arrayBuffer; make any fallback observable.
  const arrayBuffer = vi.fn().mockResolvedValue(new ArrayBuffer(11));
  Object.defineProperty(file, 'arrayBuffer', { value: arrayBuffer });
  const attachment: MessageAttachment = {
    id: 'video',
    type: 'file',
    name: 'clip & final.mp4',
    data: '',
    mimeType: 'video/mp4',
    file,
  };
  return { attachment, file, arrayBuffer };
}

describe('resolveFileAttachments HTTP uploads', () => {
  it('uploads the original File as the raw body with encoded task/name/workDir and retains the successful path', async () => {
    const { attachment, file, arrayBuffer } = makeFileAttachment();
    const path = '/workspace/sessions/session-task/attachments/saved.mp4';
    fetchMock.mockResolvedValue(Response.json({ path }));
    const onFailure = vi.fn();

    const refs = await resolveFileAttachments(
      [attachment],
      '/workspace/sessions/session-task',
      '/original-workspace',
      { taskId: 'task / 1', workDir: '/workspace with spaces', onFailure },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [input, request] = fetchMock.mock.calls[0];
    const url = new URL(String(input));
    expect(url.origin + url.pathname).toBe(
      `${API_BASE_URL}/files/attachment-save`,
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      taskId: 'task / 1',
      name: attachment.name,
      workDir: '/workspace with spaces',
    });
    expect(request?.method).toBe('POST');
    expect(request?.headers).toEqual({
      'Content-Type': 'application/octet-stream',
    });
    expect(request?.body).toBe(file);
    expect(request?.signal).toBeInstanceOf(AbortSignal);
    expect(refs).toEqual([
      {
        id: attachment.id,
        type: attachment.type,
        name: attachment.name,
        path,
        mimeType: attachment.mimeType,
        sourceContext: undefined,
      },
    ]);
    expect(onFailure).not.toHaveBeenCalled();
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(mkdir).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
  });

  it.each(['file', 'inline data'] as const)(
    'reports HTTP 413 with the server limit and prevents Tauri fallback for %s',
    async (source) => {
      const { attachment, arrayBuffer } = makeFileAttachment();
      const input: MessageAttachment =
        source === 'file'
          ? attachment
          : {
              ...attachment,
              file: undefined,
              data: 'data:video/mp4;base64,dmlkZW8=',
            };
      const limitBytes = 5 * 1024 * 1024;
      fetchMock.mockResolvedValue(
        Response.json(
          { error: 'Attachment exceeds the upload limit', limitBytes },
          { status: 413 },
        ),
      );
      const onFailure = vi.fn();

      const refs = await resolveFileAttachments(
        [input],
        '/workspace/sessions/session-task',
        '/workspace',
        { taskId: 'task', onFailure },
      );

      expect(refs).toEqual([]);
      expect(onFailure).toHaveBeenCalledExactlyOnceWith({
        id: attachment.id,
        name: attachment.name,
        reason: 'too_large',
        limitBytes,
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(arrayBuffer).not.toHaveBeenCalled();
      expect(mkdir).not.toHaveBeenCalled();
      expect(writeFile).not.toHaveBeenCalled();
    },
  );
});
