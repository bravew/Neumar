import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AssetPreviewDialog,
  AssetSearchBar,
  AssetsLibraryTab,
} from '@/components/library/assets';
import type { Asset } from '@/shared/assets/types';

import { renderWithProviders } from '../helpers/render-with-providers';

describe('AssetsLibraryTab', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads catalog assets and switches to search results', async () => {
    // After unifying list + search behind `/assets/search`, the frontend
    // always hits that endpoint. The mock returns "local" rows for the empty
    // query and "search" rows once a query is present.
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/assets/search')) {
        if (/[?&]q=/.test(url)) {
          return jsonResponse({
            items: [
              {
                asset: assetFixture({
                  id: 'asset-search',
                  title: 'Semantic skyline',
                }),
                score: 1,
                score_breakdown: { fts: 0, vector: 1 },
                snippet: null,
              },
            ],
            nextCursor: null,
          });
        }
        return jsonResponse({
          items: [assetFixture({ id: 'asset-local', title: 'Local note' })],
          nextCursor: null,
        });
      }
      return jsonResponse({});
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<AssetsLibraryTab />, {
      route: '/library?tab=assets',
    });

    await screen.findByText('Local note');
    fireEvent.change(screen.getByTestId('asset-search-input'), {
      target: { value: 'skyline' },
    });

    await screen.findByText('Semantic skyline');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/assets/search?q=skyline'),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('opens preview and deletes an asset', async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (init?.method === 'DELETE') return jsonResponse({ ok: true });
        if (url.includes('/assets/search')) {
          return jsonResponse({
            items: [assetFixture({ id: 'asset-delete', title: 'Delete me' })],
            nextCursor: null,
          });
        }
        return jsonResponse({});
      },
    );
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<AssetsLibraryTab />, {
      route: '/library?tab=assets',
    });

    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Open preview: Delete me',
      }),
    );
    expect(screen.getByText('Metadata')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/assets/asset-delete'),
        expect.objectContaining({ method: 'DELETE' }),
      ),
    );
    expect(screen.queryByText('Delete me')).not.toBeInTheDocument();
  });

  it('supports keyboard navigation, selection, and preview open', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          items: [
            assetFixture({ id: 'asset-first', title: 'First asset' }),
            assetFixture({ id: 'asset-second', title: 'Second asset' }),
          ],
          nextCursor: null,
        }),
      ),
    );

    renderWithProviders(<AssetsLibraryTab />, {
      route: '/library?tab=assets',
    });

    const first = await screen.findByRole('button', {
      name: 'Open preview: First asset',
    });
    const second = await screen.findByRole('button', {
      name: 'Open preview: Second asset',
    });

    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    expect(second).toHaveFocus();

    fireEvent.keyDown(second, { key: ' ' });
    expect(second).toHaveAttribute('aria-pressed', 'true');

    fireEvent.keyDown(second, { key: 'Enter' });
    expect(screen.getByText('Metadata')).toBeInTheDocument();
  });
});

describe('AssetSearchBar', () => {
  it('emits query and semantic toggle changes', () => {
    const onChange = vi.fn();
    const onSemanticChange = vi.fn();
    renderWithProviders(
      <AssetSearchBar
        value=""
        semantic={false}
        onChange={onChange}
        onSemanticChange={onSemanticChange}
      />,
    );

    fireEvent.change(screen.getByTestId('asset-search-input'), {
      target: { value: 'mountain' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Semantic' }));

    expect(onChange).toHaveBeenCalledWith('mountain');
    expect(onSemanticChange).toHaveBeenCalledWith(true);
  });
});

describe('AssetPreviewDialog', () => {
  it('renders asset metadata', () => {
    renderWithProviders(
      <AssetPreviewDialog
        asset={assetFixture({ title: 'Preview target' })}
        open
        deleting={false}
        onOpenChange={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(screen.getByText('Preview target')).toBeInTheDocument();
    expect(screen.getByText('Metadata')).toBeInTheDocument();
    expect(screen.getByText('Local files')).toBeInTheDocument();
  });

  it('sandboxes PDF previews', () => {
    renderWithProviders(
      <AssetPreviewDialog
        asset={assetFixture({
          title: 'PDF target',
          kind: 'pdf',
          mime: 'application/pdf',
        })}
        open
        deleting={false}
        onOpenChange={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    const iframe = document.querySelector('iframe');
    expect(iframe).toHaveAttribute(
      'sandbox',
      'allow-scripts allow-same-origin',
    );
    expect(iframe).toHaveAttribute('referrerpolicy', 'no-referrer');
  });

  it('does not iframe arbitrary fallback file types', () => {
    renderWithProviders(
      <AssetPreviewDialog
        asset={assetFixture({
          title: 'HTML target',
          kind: 'other',
          mime: 'text/html',
        })}
        open
        deleting={false}
        onOpenChange={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(document.querySelector('iframe')).toBeNull();
    expect(
      screen.getByText('Inline preview is not available for this file type.'),
    ).toBeInTheDocument();
  });
});

function assetFixture(patch: Partial<Asset> = {}): Asset {
  return {
    id: 'asset-1',
    source: 'local_fs',
    connectionId: null,
    sourceId: null,
    clientRequestId: null,
    kind: 'image',
    mime: 'image/png',
    bytes: 2048,
    width: 64,
    height: 48,
    durationMs: null,
    contentHash: 'hash',
    title: 'Asset',
    description: 'Description',
    caption: null,
    ocrText: null,
    transcript: null,
    storagePath: 'asset.png',
    thumbPath: '.cache/thumb.webp',
    previewPath: '.cache/preview.jpg',
    capturedAt: null,
    importedAt: 1_700_000_000_000,
    modifiedAt: 1_700_000_000_000,
    tags: ['tag'],
    attachments: [],
    indexState: 'embedded',
    indexError: null,
    ...patch,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
