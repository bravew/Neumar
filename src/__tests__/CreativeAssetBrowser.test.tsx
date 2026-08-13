import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AssetCatalogPickerDialog } from '@/components/assets/AssetCatalogPickerDialog';
import { CreativeAssetBrowser } from '@/components/creative/CreativeAssetBrowser';
import { DesignAssetsBrowserDialog } from '@/components/design/DesignAssetsBrowserDialog';
import { ProjectAssetsBrowserDialog } from '@/components/video/assets/ProjectAssetsBrowserDialog';
import type { Asset } from '@/shared/assets/types';
import {
  clearCreativeDebugCounters,
  readCreativeDebugCounters,
} from '@/shared/creative-workflow/debug-counters';
import type { DesignOutput } from '@/shared/types/design-mode';
import type { VideoProject } from '@/shared/types/video';

import { installLocalStorageMock } from './helpers/local-storage';
import { renderWithProviders } from './helpers/render-with-providers';

type ProjectAsset = VideoProject['assets'][number];

describe('CreativeAssetBrowser', () => {
  beforeEach(() => installLocalStorageMock());
  afterEach(() => {
    vi.unstubAllGlobals();
    clearCreativeDebugCounters();
  });

  it('emits shared search, filter, semantic, and view controls', async () => {
    const user = userEvent.setup();
    const onQueryChange = vi.fn();
    const onKindChange = vi.fn();
    const onSourceChange = vi.fn();
    const onTagsChange = vi.fn();
    const onDateFromChange = vi.fn();
    const onDateToChange = vi.fn();
    const onSemanticChange = vi.fn();
    const onViewModeChange = vi.fn();

    renderWithProviders(
      <CreativeAssetBrowser
        query=""
        onQueryChange={onQueryChange}
        queryPlaceholder="Search assets"
        empty={false}
        emptyMessage="No assets"
        kindFilters={[
          { id: 'all', label: 'All', count: 2 },
          { id: 'image', label: 'Images', count: 1 },
        ]}
        activeKind="all"
        onKindChange={onKindChange}
        sourceFilters={[
          { id: 'all', label: 'All sources' },
          { id: 'local_fs', label: 'Local files', count: 1 },
        ]}
        activeSource="all"
        onSourceChange={onSourceChange}
        tags=""
        onTagsChange={onTagsChange}
        dateFrom=""
        dateTo=""
        onDateFromChange={onDateFromChange}
        onDateToChange={onDateToChange}
        semantic={false}
        onSemanticChange={onSemanticChange}
        viewMode="grid"
        viewModes={['grid', 'list']}
        onViewModeChange={onViewModeChange}
        totalCount={2}
      >
        <div>Asset cards</div>
      </CreativeAssetBrowser>,
    );

    fireEvent.change(screen.getByPlaceholderText('Search assets'), {
      target: { value: 'hero' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: /source/i }), {
      target: { value: 'local_fs' },
    });
    fireEvent.change(screen.getByPlaceholderText('Tags'), {
      target: { value: 'campaign' },
    });
    fireEvent.change(screen.getByLabelText('From'), {
      target: { value: '2026-06-01' },
    });
    fireEvent.change(screen.getByLabelText('To'), {
      target: { value: '2026-06-21' },
    });
    await user.click(screen.getByRole('button', { name: /images/i }));
    await user.click(screen.getByRole('button', { name: /semantic/i }));
    await user.click(screen.getByRole('button', { name: /view mode: list/i }));

    expect(onQueryChange).toHaveBeenLastCalledWith('hero');
    expect(readCreativeDebugCounters().events['asset.search.used']?.count).toBe(
      1,
    );
    expect(onSourceChange).toHaveBeenCalledWith('local_fs');
    expect(onTagsChange).toHaveBeenCalledWith('campaign');
    expect(onDateFromChange).toHaveBeenCalledWith('2026-06-01');
    expect(onDateToChange).toHaveBeenCalledWith('2026-06-21');
    expect(onKindChange).toHaveBeenCalledWith('image');
    expect(onSemanticChange).toHaveBeenCalledWith(true);
    expect(onViewModeChange).toHaveBeenCalledWith('list');
    expect(screen.getByText('2 results')).toBeInTheDocument();
  });
});

describe('AssetCatalogPickerDialog shared browser', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses the shared browser shell for catalog search', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async () =>
      jsonResponse({ items: [catalogAssetFixture()], nextCursor: null }),
    );
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(
      <AssetCatalogPickerDialog
        open
        onOpenChange={vi.fn()}
        onAttach={vi.fn()}
      />,
    );

    expect(await screen.findByTestId('creative-asset-browser')).toBeVisible();
    fireEvent.change(screen.getByPlaceholderText('Search assets...'), {
      target: { value: 'skyline' },
    });

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/assets/search?q=skyline'),
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      ),
    );

    await user.click(screen.getByRole('button', { name: /images/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('kind=image'),
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      ),
    );
  });

  it('surfaces shared selected counts while attaching catalog assets', async () => {
    const user = userEvent.setup();
    const onAttach = vi.fn();
    const fetchMock = vi.fn(async () =>
      jsonResponse({ items: [catalogAssetFixture()], nextCursor: null }),
    );
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(
      <AssetCatalogPickerDialog
        open
        onOpenChange={vi.fn()}
        onAttach={onAttach}
      />,
    );

    await screen.findByText('Skyline');
    await user.click(
      screen.getByRole('button', { name: /select asset: skyline/i }),
    );

    expect(screen.getAllByText(/1 selected/i).length).toBeGreaterThan(0);
    expect(
      screen.getByRole('button', { name: /attach 1 selected/i }),
    ).toBeEnabled();

    await user.click(
      screen.getByRole('button', { name: /attach 1 selected/i }),
    );

    expect(onAttach).toHaveBeenCalledWith(['asset-1']);
  });

  it('recovers a genuinely stuck load into a retryable error', async () => {
    vi.useFakeTimers();
    try {
      // A load that never resolves but rejects when its signal aborts — the
      // shape of a request stuck behind a saturated connection pool.
      const fetchMock = vi.fn(
        (_url: string, init?: { signal?: AbortSignal }) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(new DOMException('Aborted', 'AbortError')),
            );
          }),
      );
      vi.stubGlobal('fetch', fetchMock);

      renderWithProviders(
        <AssetCatalogPickerDialog
          open
          onOpenChange={vi.fn()}
          onAttach={vi.fn()}
        />,
      );

      // Past the slow hint but before the hard ceiling: still loading, only the
      // non-blocking "taking longer" hint — the request is NOT aborted yet.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20000);
      });
      expect(
        screen.getByText('Loading assets is taking longer than expected.'),
      ).toBeInTheDocument();
      expect(
        screen.queryByText('Failed to load assets'),
      ).not.toBeInTheDocument();

      // Past the hard ceiling: the stuck request is aborted and the grid falls
      // through to a distinct, retryable error instead of spinning forever.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30000);
      });
      expect(screen.getByText('Failed to load assets')).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /retry/i }),
      ).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('DesignAssetsBrowserDialog shared browser', () => {
  it('filters generated Design assets through the shared browser shell', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <DesignAssetsBrowserDialog
        open
        projectId="design-1"
        assets={[
          designAsset({
            id: 'image-1',
            kind: 'image',
            path: 'artifacts/hero.png',
          }),
          designAsset({
            id: 'audio-1',
            kind: 'audio',
            path: 'audio/voice.mp3',
          }),
        ]}
        onOpenChange={vi.fn()}
        onOpenAsset={vi.fn()}
      />,
    );

    expect(screen.getByTestId('creative-asset-browser')).toBeVisible();
    expect(screen.getByText('artifacts/hero.png')).toBeInTheDocument();
    expect(
      screen.getAllByRole('button', { name: /open preview:/i }),
    ).toHaveLength(2);

    const listView = screen.getByRole('button', { name: /view mode: list/i });
    await user.click(listView);
    expect(listView).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('artifacts/hero.png')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^audio\s*1$/i }));

    expect(screen.getByText('audio/voice.mp3')).toBeInTheDocument();
    expect(screen.queryByText('artifacts/hero.png')).not.toBeInTheDocument();
  });
});

describe('ProjectAssetsBrowserDialog shared browser', () => {
  it('shows selected context count and grouped Video project assets', async () => {
    const user = userEvent.setup();
    const video = projectAsset({
      id: 'video-1',
      kind: 'video',
      source: 'user',
      path: 'videos/project/assets/beach.mov',
      provenance: { provider: 'local', sourceDisplayName: 'beach.mov' },
    });
    const image = projectAsset({
      id: 'image-1',
      kind: 'image',
      source: 'user',
      path: 'videos/project/assets/frame.png',
      provenance: { provider: 'local', sourceDisplayName: 'frame.png' },
    });
    const onToggleContext = vi.fn();

    renderWithProviders(
      <ProjectAssetsBrowserDialog
        open
        project={videoProject([video, image])}
        newIds={new Set()}
        selectedContextAssetIds={[image.id]}
        onOpenChange={vi.fn()}
        onPlace={vi.fn()}
        onDownload={vi.fn()}
        onDelete={vi.fn()}
        onPreview={vi.fn()}
        onToggleContext={onToggleContext}
      />,
    );

    expect(screen.getByText('1 selected')).toBeInTheDocument();

    const listView = screen.getByRole('button', { name: /view mode: list/i });
    await user.click(listView);
    expect(listView).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('beach.mov')).toBeInTheDocument();

    await user.click(
      screen.getByRole('checkbox', {
        name: /remove frame\.png from agent context/i,
      }),
    );
    expect(onToggleContext).toHaveBeenCalledWith(image);

    await user.click(
      screen.getByRole('button', { name: /view mode: grouped/i }),
    );

    expect(screen.getAllByText(/Videos/).length).toBeGreaterThan(1);
    expect(screen.getAllByText(/Images/).length).toBeGreaterThan(1);
    expect(screen.getByText('beach.mov')).toBeInTheDocument();
    expect(screen.getByText('frame.png')).toBeInTheDocument();
  });
});

function catalogAssetFixture(overrides: Partial<Asset> = {}): Asset {
  return {
    id: 'asset-1',
    source: 'local_fs',
    connectionId: null,
    sourceId: null,
    clientRequestId: null,
    kind: 'image',
    mime: 'image/png',
    bytes: 128,
    width: 640,
    height: 360,
    durationMs: null,
    contentHash: null,
    title: 'Skyline',
    description: null,
    caption: null,
    ocrText: null,
    transcript: null,
    storagePath: 'assets/skyline.png',
    thumbPath: null,
    previewPath: null,
    capturedAt: null,
    importedAt: 1,
    modifiedAt: 1,
    tags: [],
    attachments: [],
    indexState: 'embedded',
    indexError: null,
    ...overrides,
  };
}

function designAsset(overrides: Partial<DesignOutput>): DesignOutput {
  return {
    id: 'output-1',
    kind: 'image',
    path: 'artifacts/output.png',
    createdAt: '2026-06-21T00:00:00.000Z',
    ...overrides,
  };
}

function projectAsset(overrides: Partial<ProjectAsset>): ProjectAsset {
  const kind = overrides.kind ?? 'video';
  return {
    id: 'asset-1',
    kind,
    source: 'user',
    path: 'videos/project/assets/asset.mov',
    metadata: {
      durationMs: kind === 'image' ? 0 : 4200,
      width: kind === 'audio' ? undefined : 1920,
      height: kind === 'audio' ? undefined : 1080,
      fileSize: 1_024_000,
    },
    ...overrides,
  };
}

function videoProject(assets: ProjectAsset[]): VideoProject {
  const now = '2026-06-21T00:00:00.000Z';
  return {
    schemaVersion: 2,
    id: 'video-1',
    name: 'Asset browser project',
    template: 'custom',
    prompt: 'Use assets',
    assets,
    sources: [],
    linkedSources: [],
    sourceAnalyses: [],
    cutPlans: [],
    analysisArtifacts: [],
    scenes: [],
    history: { head: -1, entries: [] },
    render: { status: 'idle', updatedAt: now },
    budget: { capUsd: 5, spentUsd: 0 },
    outputs: [],
    createdAt: now,
    updatedAt: now,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
