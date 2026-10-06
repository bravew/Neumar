import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useChatInputFiles } from '@/components/shared/useChatInputFiles';

vi.mock('@/config', () => ({ API_BASE_URL: 'http://localhost:5126' }));
vi.mock('@/shared/utils/tauri', () => ({ isTauriRuntime: () => false }));
vi.mock('@/shared/providers/language-provider', () => ({
  useLanguage: () => ({ t: { home: { addFilesOrPhotos: 'Attach' } } }),
}));
vi.mock('@/shared/db/settings', () => ({
  getSettings: () => ({ allowedFolders: [] }),
  saveSettings: vi.fn(),
}));
vi.mock('@/shared/lib/tauri-scope', () => ({
  grantFileReadAccess: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/shared/lib/folder-permissions', () => ({
  addOrUpdateFolder: vi.fn(),
  extractFolderName: (p: string) => p,
  isDirectory: vi.fn().mockResolvedValue(false),
  isFolderAlwaysAllowed: vi.fn().mockReturnValue(false),
}));
vi.mock('@/components/shared/native-file-picker', () => ({
  pickLocalFilePaths: vi.fn(),
}));

const BIG = '/Users/me/Movies/2025排球俱乐部颁奖典礼.mp4';

function stubStat(files: Record<string, object>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((_url: string, init: RequestInit) => {
      const { path } = JSON.parse(String(init.body)) as { path: string };
      const body = files[path] ?? { exists: false };
      return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
    }),
  );
}

const readable = (path: string) => ({
  exists: true,
  isFile: true,
  resolvedPath: path,
  size: 4_000_000_000,
});

function mountHook(acceptsFile?: (file: File) => boolean) {
  return renderHook(() =>
    useChatInputFiles({
      disabled: false,
      effectiveWorkDirsRef: { current: [] },
      handleWorkDirsChange: vi.fn(),
      acceptsFile,
    }),
  );
}

function pasteEvent(textarea: HTMLTextAreaElement, text: string) {
  const preventDefault = vi.fn();
  return {
    preventDefault,
    currentTarget: textarea,
    clipboardData: {
      items: [],
      getData: (type: string) => (type === 'text/plain' ? text : ''),
    },
  } as unknown as React.ClipboardEvent;
}

function mountTextarea(value = '') {
  const textarea = document.createElement('textarea');
  textarea.value = value;
  document.body.appendChild(textarea);
  return textarea;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('attachLocalPaths', () => {
  it('attaches a readable file by its resolved path with no bytes', async () => {
    stubStat({ [BIG]: readable(BIG) });
    const { result } = mountHook();

    let outcome: Awaited<ReturnType<typeof result.current.attachLocalPaths>> =
      [];
    await act(async () => {
      outcome = await result.current.attachLocalPaths([BIG]);
    });

    expect(outcome).toEqual([{ path: BIG, reason: undefined }]);
    expect(result.current.attachments).toHaveLength(1);
    expect(result.current.attachments[0]).toMatchObject({
      localPath: BIG,
      type: 'video',
    });
    expect(result.current.attachments[0].file.size).toBe(0);
  });

  it('reports missing paths without attaching them', async () => {
    stubStat({});
    const { result } = mountHook();

    let outcome: Awaited<ReturnType<typeof result.current.attachLocalPaths>> =
      [];
    await act(async () => {
      outcome = await result.current.attachLocalPaths(['/Users/me/gone.mp4']);
    });

    expect(outcome).toEqual([
      { path: '/Users/me/gone.mp4', reason: 'not_found' },
    ]);
    expect(result.current.attachments).toEqual([]);
  });

  it('replaces a same-named upload chip with the in-place file', async () => {
    stubStat({ [BIG]: readable(BIG) });
    const { result } = mountHook();
    const uploaded = new File(['x'], '2025排球俱乐部颁奖典礼.mp4', {
      type: 'video/mp4',
    });
    const other = new File(['y'], 'notes.txt', { type: 'text/plain' });
    await act(async () => {
      await result.current.addFiles([uploaded, other]);
    });
    expect(result.current.attachments).toHaveLength(2);

    await act(async () => {
      await result.current.attachLocalPaths([BIG]);
    });

    expect(
      result.current.attachments.map((a) => a.localPath ?? a.file.name),
    ).toEqual(['notes.txt', BIG]);
  });

  it('reports a file the composer filters out instead of silently dropping it', async () => {
    stubStat({ [BIG]: readable(BIG) });
    const { result } = mountHook((file) => file.type.startsWith('image/'));

    let outcome: Awaited<ReturnType<typeof result.current.attachLocalPaths>> =
      [];
    await act(async () => {
      outcome = await result.current.attachLocalPaths([BIG]);
    });

    expect(outcome).toEqual([{ path: BIG, reason: 'not_accepted' }]);
    expect(result.current.attachments).toEqual([]);
  });
});

describe('pasting file paths', () => {
  it('attaches a pasted path instead of inserting text', async () => {
    stubStat({ [BIG]: readable(BIG) });
    const { result } = mountHook();
    const textarea = mountTextarea();
    const event = pasteEvent(textarea, `"${BIG}"`);

    await act(async () => {
      await result.current.handlePaste(event);
    });

    expect(event.preventDefault).toHaveBeenCalled();
    expect(result.current.attachments[0]?.localPath).toBe(BIG);
    expect(textarea.value).toBe('');
  });

  it('pastes the text back when the path is not a readable file', async () => {
    stubStat({});
    const { result } = mountHook();
    const textarea = mountTextarea('see ');
    textarea.setSelectionRange(4, 4);
    const onInput = vi.fn();
    textarea.addEventListener('input', onInput);
    const event = pasteEvent(textarea, '/Users/me/gone.mp4');

    await act(async () => {
      await result.current.handlePaste(event);
    });

    expect(textarea.value).toBe('see /Users/me/gone.mp4');
    expect(onInput).toHaveBeenCalledTimes(1);
    expect(result.current.attachments).toEqual([]);
  });

  it.each([false, true])(
    'preserves edits made while a pasted path is checked (readable: %s)',
    async (exists) => {
      let finishCheck!: (response: object) => void;
      vi.stubGlobal(
        'fetch',
        vi.fn(
          () =>
            new Promise((resolve) => {
              finishCheck = resolve;
            }),
        ),
      );
      const { result } = mountHook();
      const textarea = mountTextarea('Original draft');
      textarea.setSelectionRange(0, textarea.value.length);
      const event = pasteEvent(textarea, BIG);

      await act(async () => {
        const pending = result.current.handlePaste(event);
        // The normal paste is visible before the API responds.
        expect(textarea.value).toBe(BIG);
        textarea.value = 'New draft typed while checking';
        textarea.setSelectionRange(3, 3);
        finishCheck({
          ok: true,
          json: async () => (exists ? readable(BIG) : { exists: false }),
        });
        await pending;
      });

      expect(textarea.value).toBe('New draft typed while checking');
      expect(textarea.selectionStart).toBe(3);
      expect(result.current.attachments).toHaveLength(exists ? 1 : 0);
    },
  );

  it('does not intercept ordinary prose or a slash command', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { result } = mountHook();

    for (const text of ['convert /Users/me/a.mp4 to mov', '/help']) {
      const event = pasteEvent(mountTextarea(), text);
      await act(async () => {
        await result.current.handlePaste(event);
      });
      expect(event.preventDefault).not.toHaveBeenCalled();
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps only the unreadable lines as text when some paths attach', async () => {
    stubStat({ [BIG]: readable(BIG) });
    const { result } = mountHook();
    const textarea = mountTextarea();
    const event = pasteEvent(textarea, `${BIG}\n/Users/me/gone.mp4`);

    await act(async () => {
      await result.current.handlePaste(event);
    });

    await waitFor(() =>
      expect(result.current.attachments.map((a) => a.localPath)).toEqual([BIG]),
    );
    expect(textarea.value).toBe('/Users/me/gone.mp4');
  });
});
