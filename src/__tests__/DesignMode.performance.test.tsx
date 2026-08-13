import { fireEvent, waitFor } from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AssetGallery } from '@/components/design/AssetGallery';
import { FileTreePanel } from '@/components/design/FileTreePanel';
import { DesignsTab } from '@/components/design/tabs/DesignsTab';
import type {
  DesignFileEntry,
  DesignOutput,
  DesignProject,
} from '@/shared/types/design-mode';

import { renderWithProviders } from './helpers/render-with-providers';

const originalResizeObserver = globalThis.ResizeObserver;
const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
const originalOffsetHeight = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'offsetHeight',
);
const originalClientWidth = Object.getOwnPropertyDescriptor(
  Element.prototype,
  'clientWidth',
);

function measuredRowHeight(element: Element) {
  if (!element.hasAttribute('data-index')) return null;
  if (!element.querySelector('article')) return 34;
  return element.querySelector('[data-testid="design-folder-card"]')
    ? 265
    : 360;
}

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get() {
      return (
        measuredRowHeight(this) ?? originalOffsetHeight?.get?.call(this) ?? 0
      );
    },
  });
  Object.defineProperty(Element.prototype, 'clientWidth', {
    configurable: true,
    get() {
      if (
        this.matches(
          '[data-testid="virtual-card-grid"], [data-testid="virtual-file-tree"]',
        )
      )
        return 900;
      return originalClientWidth?.get?.call(this) ?? 0;
    },
  });
  Element.prototype.getBoundingClientRect = function () {
    const height = measuredRowHeight(this);
    if (height !== null) {
      return new DOMRect(0, 0, 900, height);
    }
    return originalGetBoundingClientRect.call(this);
  };
  globalThis.ResizeObserver = class TestResizeObserver implements ResizeObserver {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(target: Element) {
      if (
        !target.matches(
          '[data-testid="virtual-card-grid"], [data-testid="virtual-file-tree"]',
        )
      )
        return;
      this.callback(
        [
          {
            target,
            contentRect: new DOMRectReadOnly(0, 0, 900, 700),
            borderBoxSize: [
              { inlineSize: 900, blockSize: 700 } as ResizeObserverSize,
            ],
            contentBoxSize: [
              { inlineSize: 900, blockSize: 700 } as ResizeObserverSize,
            ],
            devicePixelContentBoxSize: [],
          },
        ],
        this,
      );
    }
    unobserve() {}
    disconnect() {}
  };
});

afterAll(() => {
  if (originalOffsetHeight) {
    Object.defineProperty(
      HTMLElement.prototype,
      'offsetHeight',
      originalOffsetHeight,
    );
  }
  if (originalClientWidth) {
    Object.defineProperty(
      Element.prototype,
      'clientWidth',
      originalClientWidth,
    );
  }
  Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
  globalThis.ResizeObserver = originalResizeObserver;
});

describe('DesignMode large-library performance', () => {
  it('bounds 4,000 project cards and cover-request concurrency', async () => {
    const projects = Array.from({ length: 4_000 }, (_, index) =>
      projectFixture(index),
    );
    let activeCoverRequests = 0;
    let maxCoverRequests = 0;
    let startedCoverRequests = 0;
    globalThis.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (!String(input).includes('/design/projects/project-')) {
        return Promise.resolve(Response.json({}));
      }
      startedCoverRequests += 1;
      activeCoverRequests += 1;
      maxCoverRequests = Math.max(maxCoverRequests, activeCoverRequests);
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => {
            activeCoverRequests -= 1;
            reject(new DOMException('aborted', 'AbortError'));
          },
          { once: true },
        );
      });
    }) as typeof fetch;
    const startedAt = performance.now();
    const view = renderWithProviders(
      <DesignsTab
        projects={projects}
        designSystems={[]}
        onOpen={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    await waitFor(() => expect(startedCoverRequests).toBeGreaterThan(0));
    const grid = view.getByTestId('virtual-card-grid');
    const counts: number[] = [];
    const indices: number[] = [];
    for (const offset of [0, 265_000, 529_000]) {
      grid.scrollTop = offset;
      fireEvent.scroll(grid);
      await waitFor(() => {
        const cards = view.container.querySelectorAll(
          '[data-testid="design-folder-card"]',
        );
        expect(cards.length).toBeGreaterThan(0);
        expect(cards.length).toBeLessThan(40);
      });
      counts.push(
        view.container.querySelectorAll('[data-testid="design-folder-card"]')
          .length,
      );
      indices.push(
        Number(
          view.container
            .querySelector('[data-card-index]')
            ?.getAttribute('data-card-index') ?? 0,
        ),
      );
    }
    console.info('CP6_POST_PROJECTS', {
      renderedAtOffsets: counts,
      firstIndices: indices,
      startedCoverRequests,
      maxCoverRequests,
      durationMs: Math.round(performance.now() - startedAt),
    });
    expect(indices[1]).toBeGreaterThan(indices[0] ?? -1);
    expect(indices[2]).toBeGreaterThan(indices[1] ?? -1);
    expect(maxCoverRequests).toBeLessThanOrEqual(6);
  }, 30_000);

  it('bounds 4,000 file rows at top, middle, and end offsets', async () => {
    const files = Array.from({ length: 4_000 }, (_, index) =>
      fileFixture(index),
    );
    const startedAt = performance.now();
    const view = renderWithProviders(
      <FileTreePanel
        hasVisibleFiles
        workspace={workspaceFixture(files) as never}
      />,
    );
    const list = view.getByTestId('virtual-file-tree');
    const counts: number[] = [];
    const indices: number[] = [];
    for (const offset of [0, 68_000, 135_000]) {
      list.scrollTop = offset;
      fireEvent.scroll(list);
      await waitFor(() => {
        const rows = view.container.querySelectorAll('input[type="checkbox"]');
        expect(rows.length).toBeGreaterThan(0);
        expect(rows.length).toBeLessThan(80);
      });
      counts.push(
        view.container.querySelectorAll('input[type="checkbox"]').length,
      );
      indices.push(
        Number(
          view.container
            .querySelector('[data-index]')
            ?.getAttribute('data-index') ?? 0,
        ),
      );
    }
    console.info('CP6_POST_FILES', {
      renderedAtOffsets: counts,
      firstIndices: indices,
      durationMs: Math.round(performance.now() - startedAt),
    });
    expect(indices[1]).toBeGreaterThan(indices[0] ?? -1);
    expect(indices[2]).toBeGreaterThan(indices[1] ?? -1);
  }, 30_000);

  it('windows a realistic 120-output gallery', () => {
    const assets = Array.from({ length: 120 }, (_, index) =>
      assetFixture(index),
    );
    const startedAt = performance.now();
    const view = renderWithProviders(
      <AssetGallery
        projectId="project-perf"
        assets={assets}
        onOpen={vi.fn()}
      />,
    );
    const rendered = view.container.querySelectorAll('article').length;
    console.info('CP6_POST_ASSETS', {
      rendered,
      durationMs: Math.round(performance.now() - startedAt),
    });
    expect(rendered).toBeGreaterThan(0);
    expect(rendered).toBeLessThan(60);
  }, 30_000);
});

function projectFixture(index: number): DesignProject {
  const timestamp = '2026-08-08T00:00:00.000Z';
  return {
    id: `project-${index}`,
    title: `Project ${index}`,
    surface: 'prototype',
    intent: 'landing-page',
    status: 'draft',
    skillId: null,
    designSystemId: null,
    inspirationDesignSystemIds: [],
    craftRefs: [],
    linkedContextDirs: [],
    brief: {},
    outputs: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function fileFixture(index: number): DesignFileEntry {
  return {
    name: `file-${index}.html`,
    path: `artifacts/file-${index}.html`,
    isDir: false,
    updatedAt: '2026-08-08T00:00:00.000Z',
  };
}

function assetFixture(index: number): DesignOutput {
  return {
    id: `asset-${index}`,
    path: `artifacts/asset-${index}.png`,
    kind: 'image',
    createdAt: '2026-08-08T00:00:00.000Z',
  } as DesignOutput;
}

function workspaceFixture(files: DesignFileEntry[]) {
  return {
    selectedFilePaths: [],
    selectedPaths: new Set<string>(),
    setSelectedPaths: vi.fn(),
    deleting: false,
    deleteSelectedFiles: vi.fn(),
    deleteError: null,
    sortBy: 'name',
    sortDirection: 'asc',
    groupBy: 'none',
    kindFilter: 'all',
    updateSortBy: vi.fn(),
    updateSortDirection: vi.fn(),
    updateGroupBy: vi.fn(),
    updateKindFilter: vi.fn(),
    currentDirectory: null,
    currentDirectoryLabel: '',
    goUpDirectory: vi.fn(),
    fileListError: null,
    retryFileList: vi.fn(),
    visibleDirectories: [],
    groupedFiles: [{ id: 'all', files }],
    activePath: null,
    renameFile: vi.fn(),
    openDirectory: vi.fn(),
    toggleSelection: vi.fn(),
    openFile: vi.fn(),
  };
}
