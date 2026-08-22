import { StrictMode } from 'react';

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAddLocalFiles } from '@/components/video/assets/useAddLocalFiles';
import { useAddLocalFolder } from '@/components/video/assets/useAddLocalFolder';
import type { VideoProjectEditorActions } from '@/components/video/editorTypes';

const pickLocalFolder = vi.fn();
vi.mock('@/components/video/LinkedSourcesPanel', () => ({
  pickLocalFolder: (title: string) => pickLocalFolder(title),
  lastPathSegment: (value: string) => value.split('/').pop() ?? value,
}));
vi.mock('@/shared/lib/tauri-scope', () => ({
  grantFileReadAccess: vi.fn().mockResolvedValue(undefined),
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

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useAddLocalFolder', () => {
  it('re-enables the picker after a cancelled pick under StrictMode', async () => {
    pickLocalFolder.mockResolvedValue(null);
    const actions = {} as VideoProjectEditorActions;

    const { result } = renderHook(() => useAddLocalFolder(actions, 'Pick'), {
      wrapper: StrictMode,
    });

    await act(async () => {
      await result.current.addLocalFolder();
    });

    // StrictMode's mount → unmount → mount used to leave the internal mounted
    // ref false forever, wedging `addingFolder` on and disabling the menu item.
    expect(result.current.addingFolder).toBe(false);
  });
});

describe('useAddLocalFiles', () => {
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
