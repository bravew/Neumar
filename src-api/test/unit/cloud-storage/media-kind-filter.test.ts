import { describe, expect, it, vi } from 'vitest';

import { filterByMediaKind } from '@/shared/integrations/cloud-storage/media-kind-filter';
import { BoxLocalAdapter } from '@/shared/integrations/cloud-storage/providers/box-local-adapter';
import { DropboxLocalAdapter } from '@/shared/integrations/cloud-storage/providers/dropbox-local-adapter';
import { OneDriveLocalAdapter } from '@/shared/integrations/cloud-storage/providers/onedrive-local-adapter';
import type {
  CloudFile,
  CloudStorageProvider,
} from '@/shared/integrations/cloud-storage/types';

function file(
  name: string,
  overrides: Partial<CloudFile> & { provider?: CloudStorageProvider } = {},
): CloudFile {
  return {
    id: `id:${name}`,
    name,
    mimeType: overrides.mimeType ?? 'application/octet-stream',
    size: 0,
    createdAt: '2026-01-01T00:00:00Z',
    modifiedAt: '2026-01-01T00:00:00Z',
    parentId: null,
    isFolder: false,
    provider: overrides.provider ?? 'box',
    ...overrides,
  } as CloudFile;
}

describe('filterByMediaKind', () => {
  it('keeps folders regardless of kind so users can drill in', () => {
    const items = [
      file('photo.jpg'),
      file('notes', { isFolder: true, mimeType: 'application/x.folder' }),
      file('clip.mp4'),
    ];
    const out = filterByMediaKind(items, 'image');
    expect(out.map((f) => f.name)).toEqual(['photo.jpg', 'notes']);
  });

  it('matches by file extension for image/video/audio/document', () => {
    const items = [
      file('a.jpg'),
      file('b.png'),
      file('c.mp4'),
      file('d.mp3'),
      file('e.pdf'),
      file('f.txt'),
      file('g.unknownext'),
    ];
    expect(filterByMediaKind(items, 'image').map((f) => f.name)).toEqual([
      'a.jpg',
      'b.png',
    ]);
    expect(filterByMediaKind(items, 'video').map((f) => f.name)).toEqual([
      'c.mp4',
    ]);
    expect(filterByMediaKind(items, 'audio').map((f) => f.name)).toEqual([
      'd.mp3',
    ]);
    expect(filterByMediaKind(items, 'document').map((f) => f.name)).toEqual([
      'e.pdf',
      'f.txt',
    ]);
  });

  it('falls back to mime-type prefix when extension is missing or unknown', () => {
    const items = [
      file('weird', { mimeType: 'image/jpeg' }),
      file('clip', { mimeType: 'video/mp4' }),
      file('plain', { mimeType: 'application/octet-stream' }),
    ];
    expect(filterByMediaKind(items, 'image').map((f) => f.name)).toEqual([
      'weird',
    ]);
    expect(filterByMediaKind(items, 'video').map((f) => f.name)).toEqual([
      'clip',
    ]);
  });

  it('returns a copy with no kind so callers can mutate freely', () => {
    const items = [file('a.jpg')];
    const out = filterByMediaKind(items, undefined);
    expect(out).toEqual(items);
    expect(out).not.toBe(items);
  });
});

describe('local adapter search() empty-query fallback', () => {
  function pageOf(...names: string[]) {
    return {
      items: names.map((n) =>
        file(n, { mimeType: n.endsWith('.jpg') ? 'image/jpeg' : 'video/mp4' }),
      ),
      hasMore: false as const,
    };
  }

  it('Box: routes to listChildren and filters by mediaKind when query is empty', async () => {
    const adapter = new BoxLocalAdapter();
    const listSpy = vi
      .spyOn(adapter, 'listChildren')
      .mockResolvedValue(pageOf('a.jpg', 'b.mp4', 'c.jpg'));

    const result = await adapter.search({
      query: '   ',
      mediaKind: 'image',
      parentId: '42',
    });

    expect(listSpy).toHaveBeenCalledWith({
      parentId: '42',
      cursor: undefined,
      limit: undefined,
    });
    expect(result.items.map((f) => f.name)).toEqual(['a.jpg', 'c.jpg']);
  });

  it('Dropbox: routes to listChildren and filters by mediaKind when query is empty', async () => {
    const adapter = new DropboxLocalAdapter();
    const listSpy = vi
      .spyOn(adapter, 'listChildren')
      .mockResolvedValue(pageOf('movie.mp4', 'photo.jpg'));

    const result = await adapter.search({ query: '', mediaKind: 'video' });

    expect(listSpy).toHaveBeenCalled();
    expect(result.items.map((f) => f.name)).toEqual(['movie.mp4']);
  });

  it('OneDrive: routes to listChildren and filters by mediaKind when query is empty', async () => {
    const adapter = new OneDriveLocalAdapter();
    const listSpy = vi
      .spyOn(adapter, 'listChildren')
      .mockResolvedValue(pageOf('a.jpg', 'b.jpg', 'c.mp4'));

    const result = await adapter.search({ query: '', mediaKind: 'image' });

    expect(listSpy).toHaveBeenCalled();
    expect(result.items.map((f) => f.name)).toEqual(['a.jpg', 'b.jpg']);
  });
});
