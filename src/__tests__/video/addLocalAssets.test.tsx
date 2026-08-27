import { StrictMode } from 'react';

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAddLocalFiles } from '@/components/video/assets/useAddLocalFiles';
import { useAddLocalFolder } from '@/components/video/assets/useAddLocalFolder';
import type { VideoProjectEditorActions } from '@/components/video/editorTypes';
import { isAssetMaterializationLeaseActive } from '@/shared/assets/materializationLease';

const pickLocalFolder = vi.fn();
vi.mock('@/components/video/LinkedSourcesPanel', () => ({
  pickLocalFolder: (title: string) => pickLocalFolder(title),
  lastPathSegment: (value: string) => value.split('/').pop() ?? value,
}));
vi.mock('@/shared/lib/tauri-scope', () => ({
  grantFileReadAccess: vi.fn().mockResolvedValue(undefined),
}));
const pickLocalMediaFiles = vi.fn();
vi.mock('@/components/video/assets/pickLocalMediaFiles', () => ({
  pickLocalMediaFiles: () => pickLocalMediaFiles(),
}));
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

const labels = {
  attachQueuedToast: '{count} assets attaching…',
  attachSucceededToast: '{count} assets attached',
  attachPartialToast: '{succeeded} attached · {failed} failed',
  materializeFailed: 'Asset failed: {message}',
};

const folderLabels = {
  ...labels,
  folderIndexing: 'Indexing folder "{name}"…',
  folderAttaching: 'Adding {current}/{total} from "{name}"…',
  folderEmpty: 'No media found in "{name}"',
  folderSkippedUnsupported: 'Skipped {count} unsupported file(s)',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useAddLocalFolder', () => {
  it('re-enables the picker after a cancelled pick under StrictMode', async () => {
    pickLocalFolder.mockResolvedValue(null);
    const actions = {} as VideoProjectEditorActions;

    const { result } = renderHook(
      () => useAddLocalFolder(actions, 'Pick', folderLabels),
      { wrapper: StrictMode },
    );

    await act(async () => {
      await result.current.addLocalFolder();
    });

    // StrictMode's mount → unmount → mount used to leave the internal mounted
    // ref false forever, wedging `addingFolder` on and disabling the menu item.
    expect(result.current.addingFolder).toBe(false);
  });

  it('attaches every file the crawl discovers into project assets', async () => {
    pickLocalFolder.mockResolvedValue('/Users/x/Dali');
    const discovered = [
      { id: 'a1', name: 'a1.mp4', kind: 'video', sizeBytes: 5_000_000 },
      { id: 'a2', name: 'a2.mp4', kind: 'video', sizeBytes: 5_000_000 },
    ];
    const grantLocalFolder = vi
      .fn()
      .mockResolvedValue({ token: 't', rootPath: '/Users/x/Dali' });
    const addLinkedSource = vi
      .fn()
      .mockResolvedValue({ project: {}, source: { id: 'src1' } });
    const syncLinkedSource = vi.fn().mockResolvedValue({
      project: {},
      source: { id: 'src1' },
      job: { id: 'j1', status: 'queued' },
    });
    const listLinkedAssets = vi.fn().mockResolvedValue({ assets: discovered });
    const attachLinkedAsset = vi
      .fn()
      .mockResolvedValue({ project: {}, asset: {} });
    const actions = {
      grantLocalFolder,
      addLinkedSource,
      syncLinkedSource,
      listLinkedAssets,
      attachLinkedAsset,
    } as unknown as VideoProjectEditorActions;

    const { result } = renderHook(() =>
      useAddLocalFolder(actions, 'Pick', folderLabels),
    );

    await act(async () => {
      await result.current.addLocalFolder();
    });

    expect(attachLinkedAsset).toHaveBeenCalledTimes(2);
    expect(attachLinkedAsset).toHaveBeenCalledWith('a1', undefined, undefined);
    expect(attachLinkedAsset).toHaveBeenCalledWith('a2', undefined, undefined);
    const { toast } = await import('sonner');
    expect(toast.success).toHaveBeenCalledWith('2 assets attached');
  }, 10_000);

  it('skips AppleDouble sidecars and other non-media noise instead of attaching them', async () => {
    pickLocalFolder.mockResolvedValue('/Users/x/Dali');
    const discovered = [
      { id: 'real', name: 'Clip.MP4', kind: 'video', sizeBytes: 5_000_000 },
      // AppleDouble resource fork: real media extension, dotfile name.
      { id: 'dot', name: '._Clip.MP4', kind: 'video', sizeBytes: 4096 },
      // Same extension, no dot, but implausibly small for real video.
      { id: 'tiny', name: 'Stray.MP4', kind: 'video', sizeBytes: 4096 },
      { id: 'ds', name: '.DS_Store', kind: 'other', sizeBytes: 4096 },
    ];
    const grantLocalFolder = vi
      .fn()
      .mockResolvedValue({ token: 't', rootPath: '/Users/x/Dali' });
    const addLinkedSource = vi
      .fn()
      .mockResolvedValue({ project: {}, source: { id: 'src1' } });
    const syncLinkedSource = vi.fn().mockResolvedValue({
      project: {},
      source: { id: 'src1' },
      job: { id: 'j1', status: 'queued' },
    });
    const listLinkedAssets = vi.fn().mockResolvedValue({ assets: discovered });
    const attachLinkedAsset = vi
      .fn()
      .mockResolvedValue({ project: {}, asset: {} });
    const actions = {
      grantLocalFolder,
      addLinkedSource,
      syncLinkedSource,
      listLinkedAssets,
      attachLinkedAsset,
    } as unknown as VideoProjectEditorActions;

    const { result } = renderHook(() =>
      useAddLocalFolder(actions, 'Pick', folderLabels),
    );

    await act(async () => {
      await result.current.addLocalFolder();
    });

    expect(attachLinkedAsset).toHaveBeenCalledTimes(1);
    expect(attachLinkedAsset).toHaveBeenCalledWith(
      'real',
      undefined,
      undefined,
    );
    const { toast } = await import('sonner');
    expect(toast.info).toHaveBeenCalledWith('Skipped 3 unsupported file(s)');
  }, 10_000);
});

describe('useAddLocalFiles', () => {
  it('references picked files by path instead of uploading their bytes', async () => {
    pickLocalMediaFiles.mockResolvedValue([
      '/Volumes/Card/a.mp4',
      '/Volumes/Card/b.mp4',
    ]);
    const attachAssetPaths = vi.fn().mockResolvedValue(null);
    const uploadAssets = vi.fn().mockResolvedValue(null);
    const actions = {
      attachAssetPaths,
      uploadAssets,
    } as unknown as VideoProjectEditorActions;

    const { result } = renderHook(() => useAddLocalFiles(actions, labels));
    await act(async () => {
      result.current.openFilePicker();
    });

    expect(attachAssetPaths).toHaveBeenCalledWith(
      ['/Volumes/Card/a.mp4', '/Volumes/Card/b.mp4'],
      'reference',
      undefined,
    );
    expect(uploadAssets).not.toHaveBeenCalled();
    expect(result.current.addingFiles).toBe(false);
  });

  it('falls back to the upload input when no native picker exists', async () => {
    pickLocalMediaFiles.mockResolvedValue(null);
    const attachAssetPaths = vi.fn().mockResolvedValue(null);
    const actions = {
      attachAssetPaths,
      uploadAssets: vi.fn(),
    } as unknown as VideoProjectEditorActions;

    const { result } = renderHook(() => useAddLocalFiles(actions, labels));
    const input = document.createElement('input');
    input.type = 'file';
    const click = vi.spyOn(input, 'click').mockImplementation(() => {});
    result.current.fileInputRef.current = input;

    await act(async () => {
      result.current.openFilePicker();
    });

    expect(click).toHaveBeenCalledTimes(1);
    expect(attachAssetPaths).not.toHaveBeenCalled();
  });

  it('uploads each picked file in its own request', async () => {
    const uploadAssets = vi.fn().mockResolvedValue(null);
    const actions = { uploadAssets } as unknown as VideoProjectEditorActions;
    const files = [
      new File(['a'], 'a.mp4', { type: 'video/mp4' }),
      new File(['b'], 'b.mp4', { type: 'video/mp4' }),
      new File(['c'], 'c.mp4', { type: 'video/mp4' }),
    ];

    const { result } = renderHook(() => useAddLocalFiles(actions, labels));

    await act(async () => {
      await result.current.handleFilesSelected({
        target: { files, value: 'x' },
      } as never);
    });

    expect(uploadAssets).toHaveBeenCalledTimes(3);
    expect(uploadAssets.mock.calls.map(([batch]) => batch[0].name)).toEqual([
      'a.mp4',
      'b.mp4',
      'c.mp4',
    ]);
    expect(result.current.addingFiles).toBe(false);
  });

  it('takes the stream lease after the chooser closes, not while it is open', async () => {
    const leaseSeen: boolean[] = [];
    pickLocalMediaFiles.mockImplementation(async () => {
      // Holding an SSE socket here would compete with the very request that
      // raises the chooser — that is the starvation this fix removes.
      leaseSeen.push(isAssetMaterializationLeaseActive('sess-files'));
      return ['/Volumes/Card/a.mp4'];
    });
    const attachAssetPaths = vi.fn(async () => {
      leaseSeen.push(isAssetMaterializationLeaseActive('sess-files'));
      return null;
    });
    const actions = {
      attachAssetPaths,
      uploadAssets: vi.fn(),
    } as unknown as VideoProjectEditorActions;

    const { result } = renderHook(() =>
      useAddLocalFiles(actions, labels, 'sess-files'),
    );
    await act(async () => {
      result.current.openFilePicker();
    });

    expect(leaseSeen).toEqual([false, true]);
  });

  it('re-enables the control when the picker request fails', async () => {
    const { toast } = await import('sonner');
    pickLocalMediaFiles.mockRejectedValue(
      new Error('File picker did not respond'),
    );
    const actions = {
      attachAssetPaths: vi.fn(),
      uploadAssets: vi.fn(),
    } as unknown as VideoProjectEditorActions;

    const { result } = renderHook(() =>
      useAddLocalFiles(actions, labels, 'sess-picker-error'),
    );
    await act(async () => {
      result.current.openFilePicker();
    });

    expect(result.current.addingFiles).toBe(false);
    expect(toast.error).toHaveBeenCalledWith(
      'Asset failed: File picker did not respond',
    );
    // A failed pick must not leave a stream owning a socket.
    expect(isAssetMaterializationLeaseActive('sess-picker-error')).toBe(false);
  });

  it('keeps going when one file fails and reports the partial result', async () => {
    const { toast } = await import('sonner');
    const uploadAssets = vi
      .fn()
      .mockRejectedValueOnce(new Error('too big'))
      .mockResolvedValue(null);
    const actions = { uploadAssets } as unknown as VideoProjectEditorActions;
    const files = [
      new File(['a'], 'a.mp4', { type: 'video/mp4' }),
      new File(['b'], 'b.mp4', { type: 'video/mp4' }),
    ];

    const { result } = renderHook(() => useAddLocalFiles(actions, labels));

    await act(async () => {
      await result.current.handleFilesSelected({
        target: { files, value: 'x' },
      } as never);
    });

    expect(uploadAssets).toHaveBeenCalledTimes(2);
    expect(toast.warning).toHaveBeenCalledWith('1 attached · 1 failed');
  });
});
