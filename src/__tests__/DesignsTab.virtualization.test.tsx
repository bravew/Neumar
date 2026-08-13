import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { DesignsTab } from '@/components/design/tabs/DesignsTab';
import type { DesignProject } from '@/shared/types/design-mode';

import { renderWithProviders } from './helpers/render-with-providers';

const originalResizeObserver = globalThis.ResizeObserver;
const originalOffsetHeight = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'offsetHeight',
);
const originalClientWidth = Object.getOwnPropertyDescriptor(
  Element.prototype,
  'clientWidth',
);
const originalScrollTo = HTMLElement.prototype.scrollTo;

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get() {
      return this.hasAttribute('data-index')
        ? 265
        : (originalOffsetHeight?.get?.call(this) ?? 0);
    },
  });
  Object.defineProperty(Element.prototype, 'clientWidth', {
    configurable: true,
    get() {
      return this.matches('[data-testid="virtual-card-grid"]')
        ? 900
        : (originalClientWidth?.get?.call(this) ?? 0);
    },
  });
  HTMLElement.prototype.scrollTo = function (
    optionsOrX?: number | ScrollToOptions,
    y?: number,
  ) {
    this.scrollTop =
      typeof optionsOrX === 'object'
        ? (optionsOrX.top ?? this.scrollTop)
        : (y ?? this.scrollTop);
    this.dispatchEvent(new Event('scroll'));
  };
  globalThis.ResizeObserver = class TestResizeObserver implements ResizeObserver {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(target: Element) {
      if (!target.matches('[data-testid="virtual-card-grid"]')) return;
      const box = { inlineSize: 900, blockSize: 700 } as ResizeObserverSize;
      this.callback(
        [
          {
            target,
            contentRect: new DOMRectReadOnly(0, 0, 900, 700),
            borderBoxSize: [box],
            contentBoxSize: [box],
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
  HTMLElement.prototype.scrollTo = originalScrollTo;
  globalThis.ResizeObserver = originalResizeObserver;
});

describe('DesignsTab virtualization interactions', () => {
  it('selects a full range when its anchor has scrolled offscreen', async () => {
    const user = userEvent.setup();
    const projects = projectsFixture(120);
    renderTab(projects);
    await user.click(screen.getByRole('button', { name: /^select$/i }));
    await user.click(screen.getAllByLabelText('Select project')[0]!);

    const grid = screen.getByTestId('virtual-card-grid');
    grid.scrollTop = 13_000;
    fireEvent.scroll(grid);
    let target: HTMLElement | null = null;
    await waitFor(() => {
      target = document.querySelector<HTMLElement>(
        '[data-card-index="100"] [data-testid="design-folder-card"]',
      );
      expect(target).not.toBeNull();
    });
    fireEvent.click(target!, { shiftKey: true });

    expect(screen.getByText('101 selected')).toBeInTheDocument();
  });

  it('moves roving focus across virtual rows and repairs it after filtering', async () => {
    const user = userEvent.setup();
    renderTab(projectsFixture(120));
    const first = screen.getAllByTestId('design-folder-card')[0]!;
    first.focus();

    for (let index = 0; index < 12; index += 1) {
      fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
      const expectedIndex = (index + 1) * 2;
      await waitFor(() =>
        expect(
          document.activeElement?.closest('[data-card-index]'),
        ).toHaveAttribute('data-card-index', String(expectedIndex)),
      );
    }

    await user.type(screen.getByTestId('designs-search'), 'Project 119');
    await waitFor(() => {
      expect(screen.getAllByTestId('design-folder-card')).toHaveLength(1);
      expect(screen.getByTestId('design-folder-card')).toHaveAttribute(
        'tabindex',
        '0',
      );
    });
  });

  it('repairs roving focus when deletion removes the focused project', async () => {
    const projects = projectsFixture(120);
    const view = renderTab(projects);
    const first = screen.getAllByTestId('design-folder-card')[0]!;
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    await waitFor(() =>
      expect(
        document.activeElement?.closest('[data-card-index]'),
      ).toHaveAttribute('data-card-index', '1'),
    );

    view.rerender(
      tabElement(projects.filter((project) => project.id !== 'project-1')),
    );
    await waitFor(() =>
      expect(
        document.querySelector('[data-card-index="1"] [tabindex="0"]'),
      ).not.toBeNull(),
    );
  });
});

function renderTab(projects: DesignProject[]) {
  globalThis.fetch = vi.fn(async () =>
    Response.json({ files: [] }),
  ) as typeof fetch;
  return renderWithProviders(tabElement(projects));
}

function tabElement(projects: DesignProject[]) {
  return (
    <DesignsTab
      projects={projects}
      designSystems={[]}
      onOpen={vi.fn()}
      onRename={vi.fn()}
      onDelete={vi.fn()}
    />
  );
}

function projectsFixture(count: number): DesignProject[] {
  return Array.from({ length: count }, (_, index) => ({
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
    createdAt: '2026-08-08T00:00:00.000Z',
    updatedAt: '2026-08-08T00:00:00.000Z',
  }));
}
