import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CloudStorageLibraryTab } from '@/components/library/CloudStorageLibraryTab';

import { renderWithProviders } from '../helpers/render-with-providers';

describe('CloudStorageLibraryTab', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders connected personal media with the media grid view', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/cloud-storage/connections')) {
        return jsonResponse({
          items: [
            {
              id: 'conn-immich',
              provider: 'immich',
              displayName: 'Family Immich',
              status: 'active',
              capabilities: { preferredView: 'media-grid' },
            },
          ],
        });
      }
      if (url.includes('/cloud-storage/connections/conn-immich/items')) {
        return jsonResponse({
          items: [
            {
              id: 'asset-1',
              name: 'beach.jpg',
              mimeType: 'image/jpeg',
              isFolder: false,
              thumbnailUrl: 'https://example.test/beach.jpg',
              mediaMetadata: {
                fileInfo: { width: 1200, height: 800 },
              },
            },
          ],
        });
      }
      return jsonResponse({}, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<CloudStorageLibraryTab />);

    expect(await screen.findByText('Family Immich')).toBeInTheDocument();
    expect(await screen.findByText('beach.jpg')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'beach.jpg' })).toHaveAttribute(
      'src',
      'https://example.test/beach.jpg',
    );
  });

  it('searches the selected connection and filters stock licenses', async () => {
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
              capabilities: { preferredView: 'media-grid', readOnly: true },
            },
          ],
        });
      }
      if (url.includes('/cloud-storage/connections/conn-openverse/search')) {
        expect(url).toContain('q=ocean');
        const allItems = [
          {
            id: 'stock-1',
            name: 'ocean cc0.jpg',
            mimeType: 'image/jpeg',
            isFolder: false,
            thumbnailUrl: 'https://example.test/ocean.jpg',
            licenseInfo: {
              provider: 'OpenVerse',
              license: 'CC0',
              creatorName: 'Avery',
            },
          },
          {
            id: 'stock-2',
            name: 'ocean by.jpg',
            mimeType: 'image/jpeg',
            isFolder: false,
            thumbnailUrl: 'https://example.test/ocean-by.jpg',
            licenseInfo: {
              provider: 'OpenVerse',
              license: 'CC BY',
              creatorName: 'Blair',
            },
          },
        ];
        // Mirror the real server: when the client passes license_filter, the
        // backend returns only matching items. Client-side filtering was
        // removed as redundant.
        const licenseParams = Array.from(
          new URL(url, 'http://localhost').searchParams.getAll(
            'license_filter',
          ),
        ).map((value) => value.toLowerCase());
        const items =
          licenseParams.length === 0
            ? allItems
            : allItems.filter((item) =>
                licenseParams.includes(
                  item.licenseInfo.license.toLowerCase().replace(/\s+/g, ''),
                ),
              );
        return jsonResponse({ items });
      }
      if (url.includes('/cloud-storage/connections/conn-openverse/items')) {
        return jsonResponse({ items: [] });
      }
      return jsonResponse({}, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<CloudStorageLibraryTab />);

    fireEvent.change(await screen.findByPlaceholderText('Search media...'), {
      target: { value: 'ocean' },
    });

    expect(await screen.findByText('ocean cc0.jpg')).toBeInTheDocument();
    expect(await screen.findByText('ocean by.jpg')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'CC0' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('license_filter=cc0'),
        expect.any(Object),
      ),
    );
    expect(screen.getByText('ocean cc0.jpg')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByText('ocean by.jpg')).not.toBeInTheDocument(),
    );
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
