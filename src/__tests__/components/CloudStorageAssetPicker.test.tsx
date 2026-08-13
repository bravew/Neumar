import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CloudStorageAssetPicker } from '@/components/shared/CloudStorageAssetPicker';

import { renderWithProviders } from '../helpers/render-with-providers';

describe('CloudStorageAssetPicker', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('applies media filters and attaches selected cloud media items', async () => {
    const onSelect = vi.fn();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/cloud-storage/connections')) {
        return jsonResponse({
          items: [
            {
              id: 'conn-openverse',
              provider: 'openverse',
              displayName: 'OpenVerse',
              status: 'active',
              capabilities: { preferredView: 'media-grid' },
            },
          ],
        });
      }
      if (url.includes('/cloud-storage/connections/conn-openverse/search')) {
        expect(url).toContain('media_kind=video');
        return jsonResponse({
          items: [
            {
              id: 'clip-1',
              name: 'clip.mp4',
              mimeType: 'video/mp4',
              isFolder: false,
              thumbnailUrl: 'https://example.test/clip.jpg',
              licenseInfo: {
                provider: 'OpenVerse',
                license: 'CC0',
                creatorName: 'Avery',
              },
            },
          ],
        });
      }
      if (url.includes('/cloud-storage/connections/conn-openverse/items')) {
        return jsonResponse({ items: [] });
      }
      return jsonResponse({}, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(
      <CloudStorageAssetPicker
        open={true}
        onOpenChange={vi.fn()}
        onSelect={onSelect}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Videos' }));
    fireEvent.click(await screen.findByRole('button', { name: 'clip.mp4' }));
    fireEvent.click(
      await screen.findByRole('button', { name: 'Attach selected' }),
    );

    await waitFor(() =>
      expect(onSelect).toHaveBeenCalledWith([
        {
          connectionId: 'conn-openverse',
          connectionLabel: 'OpenVerse',
          connectionProvider: 'openverse',
          item: expect.objectContaining({
            id: 'clip-1',
            name: 'clip.mp4',
            mimeType: 'video/mp4',
          }),
        },
      ]),
    );
  });

  it('renders Immich thumbnails through the desktop proxy', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/cloud-storage/connections')) {
        return jsonResponse({
          items: [
            {
              id: 'conn-immich',
              provider: 'immich',
              displayName: 'Home Immich',
              status: 'active',
              capabilities: { preferredView: 'media-grid' },
            },
          ],
        });
      }
      if (url.includes('/cloud-storage/connections/conn-immich/items')) {
        if (url.endsWith('/items/asset-1')) {
          return jsonResponse({
            id: 'asset-1',
            name: 'photo.jpg',
            mimeType: 'image/jpeg',
            isFolder: false,
            size: 2048,
            thumbnailUrl: 'immich-thumbnail:asset-1',
            mediaMetadata: {
              takenAt: '2026-05-04T12:00:00.000Z',
              geo: {
                latitude: 43.6532,
                longitude: -79.3832,
                city: 'Toronto',
                country: 'Canada',
              },
              people: [{ id: 'person-1', name: 'Yong' }],
              tags: [{ id: 'tag-1', value: 'family' }],
              fileInfo: { width: 1600, height: 900 },
            },
          });
        }
        return jsonResponse({
          items: [
            {
              id: 'asset-1',
              name: 'photo.jpg',
              mimeType: 'image/jpeg',
              isFolder: false,
              thumbnailUrl: 'immich-thumbnail:asset-1',
            },
          ],
        });
      }
      return jsonResponse({}, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(
      <CloudStorageAssetPicker
        open={true}
        onOpenChange={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    const image = (await screen.findByAltText('photo.jpg')) as HTMLImageElement;
    expect(image.src).toContain(
      '/cloud-storage/connections/conn-immich/items/asset-1/thumbnail',
    );
    fireEvent.doubleClick(screen.getByRole('button', { name: 'photo.jpg' }));
    await expect(screen.findByText('File details')).resolves.toBeVisible();
    expect(await screen.findByText('Toronto, Canada')).toBeVisible();
    expect(await screen.findByText('Yong')).toBeVisible();
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
