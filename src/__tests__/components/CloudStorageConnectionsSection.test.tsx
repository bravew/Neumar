import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CloudStorageConnectionsSection } from '@/components/settings/cloud-storage/CloudStorageConnectionsSection';

import { renderWithProviders } from '../helpers/render-with-providers';

describe('CloudStorageConnectionsSection', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('removes an active local Immich connector from settings', async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? 'GET';
        if (url.endsWith('/cloud-storage/connections') && method === 'GET') {
          return jsonResponse({
            items: [
              {
                id: 'local_immich_1',
                provider: 'immich',
                displayName: 'home album',
                status: 'active',
                capabilities: { selfHostedBaseUrl: true },
              },
            ],
          });
        }
        if (url.includes('/path-mappings')) {
          return jsonResponse({ items: [] });
        }
        if (
          url.endsWith('/cloud-storage/connections/local_immich_1') &&
          method === 'DELETE'
        ) {
          return jsonResponse({ ok: true });
        }
        return jsonResponse({});
      },
    );
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true),
    );

    renderWithProviders(<CloudStorageConnectionsSection />);

    await screen.findByText('home album');
    fireEvent.click(screen.getByRole('button', { name: 'Remove connector' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/cloud-storage/connections/local_immich_1'),
        expect.objectContaining({ method: 'DELETE' }),
      ),
    );
    expect(screen.queryByText('home album')).not.toBeInTheDocument();
  });

  it('toggles Immich asset indexing and runs a catalog sync', async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? 'GET';
        if (url.endsWith('/cloud-storage/connections') && method === 'GET') {
          return jsonResponse({
            items: [
              {
                id: 'local_immich_1',
                provider: 'immich',
                displayName: 'home album',
                status: 'active',
                capabilities: { selfHostedBaseUrl: true },
                assetsCatalog: { enabled: false },
              },
            ],
          });
        }
        if (url.includes('/path-mappings')) {
          return jsonResponse({ items: [] });
        }
        if (
          url.endsWith(
            '/cloud-storage/connections/local_immich_1/assets-index',
          ) &&
          method === 'PATCH'
        ) {
          return jsonResponse({
            item: {
              id: 'local_immich_1',
              provider: 'immich',
              displayName: 'home album',
              status: 'active',
              capabilities: { selfHostedBaseUrl: true },
              assetsCatalog: { enabled: true },
            },
          });
        }
        if (
          url.endsWith(
            '/cloud-storage/connections/local_immich_1/assets-sync',
          ) &&
          method === 'POST'
        ) {
          return jsonResponse({
            item: {
              id: 'local_immich_1',
              provider: 'immich',
              displayName: 'home album',
              status: 'active',
              capabilities: { selfHostedBaseUrl: true },
              assetsCatalog: {
                enabled: true,
                lastSyncedAt: 1780272000000,
              },
            },
          });
        }
        return jsonResponse({});
      },
    );
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<CloudStorageConnectionsSection />);

    await screen.findByText('home album');
    fireEvent.click(screen.getByRole('switch', { name: 'Index in Assets' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining(
          '/cloud-storage/connections/local_immich_1/assets-index',
        ),
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ enabled: true }),
        }),
      ),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Sync assets' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining(
          '/cloud-storage/connections/local_immich_1/assets-sync',
        ),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ mode: 'auto' }),
        }),
      ),
    );
  });

  it('shows the asset storage budget warning from settings', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/assets/stats/storage')) {
        return jsonResponse({
          totalCount: 12,
          activeCount: 10,
          deletedCount: 2,
          totalBytes: 9 * 1024 * 1024 * 1024,
          localBytes: 9 * 1024 * 1024 * 1024,
          remoteBytes: 0,
          deletedBytes: 1024 * 1024 * 1024,
          cacheBytes: 0,
          materializedBytes: 0,
          proxyBytes: 0,
          previewArtifactBytes: 0,
          managedBytes: 9 * 1024 * 1024 * 1024,
          budgetBytes: 10 * 1024 * 1024 * 1024,
          warningThresholdBytes: 8 * 1024 * 1024 * 1024,
          warning: true,
        });
      }
      if (url.endsWith('/cloud-storage/connections')) {
        return jsonResponse({ items: [] });
      }
      return jsonResponse({});
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<CloudStorageConnectionsSection />);

    expect(await screen.findByText('Asset catalog storage')).toBeVisible();
    expect(
      screen.getByText(/Catalog storage is above the warning threshold/),
    ).toBeVisible();
    expect(screen.getByText('1.0 GB pending garbage collection')).toBeVisible();
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
