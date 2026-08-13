import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  extractImmichPhotoUrls,
  ImmichPublishedMediaPreviews,
} from '@/components/task/ImmichPublishedMediaPreview';

describe('ImmichPublishedMediaPreview', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('extracts Immich photo URLs from assistant text', () => {
    const url =
      'https://album.rietech.ca/photos/d0f0b5bf-8eed-4999-945c-81c1e85dd640';

    expect(extractImmichPhotoUrls(`Immich: ${url}\nAgain: ${url}`)).toEqual([
      url,
    ]);
  });

  it('renders an inline image preview through the local proxy', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          item: {
            connectionId: 'local_immich_1',
            assetId: 'd0f0b5bf-8eed-4999-945c-81c1e85dd640',
            name: 'qr.jpg',
            mimeType: 'image/jpeg',
            mediaType: 'image',
            thumbnailUrl:
              '/cloud-storage/connections/local_immich_1/items/d0f0b5bf-8eed-4999-945c-81c1e85dd640/thumbnail',
            contentUrl:
              '/cloud-storage/connections/local_immich_1/items/d0f0b5bf-8eed-4999-945c-81c1e85dd640/content',
          },
        }),
      ),
    );

    render(
      <ImmichPublishedMediaPreviews content="Immich: https://album.rietech.ca/photos/d0f0b5bf-8eed-4999-945c-81c1e85dd640" />,
    );

    const image = (await screen.findByAltText('qr.jpg')) as HTMLImageElement;
    expect(image.src).toContain(
      '/cloud-storage/connections/local_immich_1/items/d0f0b5bf-8eed-4999-945c-81c1e85dd640/thumbnail',
    );
  });

  it('renders an inline video player through the local proxy', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          item: {
            connectionId: 'local_immich_1',
            assetId: 'd0f0b5bf-8eed-4999-945c-81c1e85dd640',
            name: 'clip.mp4',
            mimeType: 'video/mp4',
            mediaType: 'video',
            thumbnailUrl:
              '/cloud-storage/connections/local_immich_1/items/d0f0b5bf-8eed-4999-945c-81c1e85dd640/thumbnail',
            contentUrl:
              '/cloud-storage/connections/local_immich_1/items/d0f0b5bf-8eed-4999-945c-81c1e85dd640/content',
          },
        }),
      ),
    );

    const { container } = render(
      <ImmichPublishedMediaPreviews content="Immich: https://album.rietech.ca/photos/d0f0b5bf-8eed-4999-945c-81c1e85dd640" />,
    );

    await waitFor(() =>
      expect(container.querySelector('video')).toBeInTheDocument(),
    );
    const video = container.querySelector('video') as HTMLVideoElement;
    expect(video.src).toContain(
      '/cloud-storage/connections/local_immich_1/items/d0f0b5bf-8eed-4999-945c-81c1e85dd640/content',
    );
    expect(video.poster).toContain(
      '/cloud-storage/connections/local_immich_1/items/d0f0b5bf-8eed-4999-945c-81c1e85dd640/thumbnail',
    );
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
