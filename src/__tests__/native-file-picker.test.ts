import { open } from '@tauri-apps/plugin-dialog';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AUDIO_EXTS,
  IMAGE_EXTS,
  VIDEO_EXTS,
} from '@/components/shared/ChatInput.types';
import {
  acceptToExtensions,
  pickLocalFilePaths,
} from '@/components/shared/native-file-picker';

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));

const openDialog = vi.mocked(open);

beforeEach(() => {
  openDialog.mockReset();
});

describe('acceptToExtensions', () => {
  it('maps MIME types and extensions without duplicates, ignoring casing and whitespace', () => {
    expect(
      acceptToExtensions(' .PDF, application/pdf, IMAGE/JPEG, .jpg, , .MP4 '),
    ).toEqual(['pdf', 'jpg', 'jpeg', 'mp4']);
  });

  it.each([
    ['image/*', IMAGE_EXTS],
    ['video/*', VIDEO_EXTS],
    ['audio/*', AUDIO_EXTS],
  ])('expands %s to supported extensions', (accept, extensions) => {
    expect(acceptToExtensions(accept)).toEqual(extensions);
  });

  it.each(['', '*/*', '.pdf,application/x-unknown', 'image/*,text/plain'])(
    'leaves the dialog unfiltered for %s',
    (accept) => {
      expect(acceptToExtensions(accept)).toEqual([]);
    },
  );
});

describe('pickLocalFilePaths', () => {
  it('returns multiple native paths and forwards mapped filters to the dialog', async () => {
    const paths = ['/media/clip.mp4', 'C:\\media\\movie.mov'];
    openDialog.mockResolvedValue(paths);

    await expect(
      pickLocalFilePaths('.mp4,video/quicktime', 'Attach media'),
    ).resolves.toEqual(paths);
    expect(openDialog).toHaveBeenCalledWith({
      multiple: true,
      directory: false,
      title: 'Attach media',
      filters: [{ name: 'Attach media', extensions: ['mp4', 'mov'] }],
    });
  });

  it('normalizes a single path into a list', async () => {
    openDialog.mockResolvedValue('/media/clip.mp4');

    await expect(pickLocalFilePaths('.mp4', 'Attach')).resolves.toEqual([
      '/media/clip.mp4',
    ]);
  });

  it('returns an empty list when the dialog is cancelled', async () => {
    openDialog.mockResolvedValue(null);

    await expect(pickLocalFilePaths('', 'Attach')).resolves.toEqual([]);
    expect(openDialog).toHaveBeenCalledWith({
      multiple: true,
      directory: false,
      title: 'Attach',
    });
  });

  it('filters empty paths from the dialog result', async () => {
    openDialog.mockResolvedValue(['', '/media/clip.mp4', '']);

    await expect(pickLocalFilePaths('.mp4', 'Attach')).resolves.toEqual([
      '/media/clip.mp4',
    ]);
  });

  it('omits filters when an accept token cannot be mapped', async () => {
    openDialog.mockResolvedValue([]);

    await pickLocalFilePaths('.pdf,application/x-unknown', 'Attach');

    expect(openDialog).toHaveBeenCalledWith({
      multiple: true,
      directory: false,
      title: 'Attach',
    });
  });
});
