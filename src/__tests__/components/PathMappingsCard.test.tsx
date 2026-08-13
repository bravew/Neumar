import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PathMappingsCard } from '@/components/settings/cloud-storage/PathMappingsCard';

import { renderWithProviders } from '../helpers/render-with-providers';

describe('PathMappingsCard', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('verifies an existing Immich path mapping with a discovered sample asset', async () => {
    const mapping = {
      id: 'map-1',
      connectionId: 'conn-1',
      immichPathPrefix: '/usr/src/app/external/photos/',
      localMountPath: '/Volumes/photos',
      disabled: false,
      verified: false,
      lastError: 'not yet verified',
      createdAt: '2026-05-04T00:00:00.000Z',
      updatedAt: '2026-05-04T00:00:00.000Z',
    };
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? 'GET';

        if (method === 'GET' && url.endsWith('/path-mappings')) {
          return jsonResponse({ items: [mapping] });
        }
        if (method === 'GET' && url.endsWith('/path-mappings/discovery')) {
          return jsonResponse({
            mounts: [{ path: '/Volumes/photos', label: 'photos' }],
            tailscale: { available: true },
          });
        }
        if (method === 'GET' && url.includes('/items?limit=50')) {
          return jsonResponse({
            items: [
              {
                id: 'asset-1',
                size: 123,
                mediaMetadata: {
                  fileInfo: {
                    originalPath: '/usr/src/app/external/photos/a.jpg',
                    checksum: 'sha1:abc123',
                  },
                },
              },
            ],
          });
        }
        if (method === 'POST' && url.endsWith('/path-mappings/resolve-test')) {
          expect(JSON.parse(init?.body as string)).toMatchObject({
            id: 'asset-1',
            originalPath: '/usr/src/app/external/photos/a.jpg',
            fileSizeBytes: 123,
            checksum: 'sha1:abc123',
            immichPathPrefix: mapping.immichPathPrefix,
            localMountPath: mapping.localMountPath,
          });
          return jsonResponse({
            verified: true,
            verificationHash: 'sha1:abc123',
            resolution: {
              kind: 'local',
              absolutePath: '/Volumes/photos/a.jpg',
              sizeBytes: 123,
              mappingId: mapping.id,
              checksum: 'sha1:abc123',
            },
          });
        }
        if (
          method === 'PATCH' &&
          url.endsWith(`/path-mappings/${mapping.id}`)
        ) {
          expect(JSON.parse(init?.body as string)).toMatchObject({
            verified: true,
            verifiedAt: expect.any(String),
            verificationHash: 'sha1:abc123',
            lastError: null,
          });
          return jsonResponse({
            ...mapping,
            verified: true,
            verifiedAt: '2026-05-04T00:01:00.000Z',
            verificationHash: 'sha1:abc123',
            lastError: undefined,
            updatedAt: '2026-05-04T00:01:00.000Z',
          });
        }

        return jsonResponse({}, 404);
      },
    );
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<PathMappingsCard connectionId="conn-1" />);

    const verifyButton = await screen.findByRole('button', {
      name: 'Verify mapping',
    });
    await waitFor(() => expect(verifyButton).not.toBeDisabled());
    expect(
      await screen.findByText(/mount it in the OS first/),
    ).toBeInTheDocument();

    fireEvent.click(verifyButton);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining(`/path-mappings/${mapping.id}`),
        expect.objectContaining({ method: 'PATCH' }),
      ),
    );
    expect(await screen.findByText('Verified')).toBeInTheDocument();
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
