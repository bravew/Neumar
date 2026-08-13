import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FileViewer } from '@/components/design/FileViewer';

import { renderWithProviders } from './helpers/render-with-providers';

describe('FileViewer responsive preview', () => {
  const originalFetch = globalThis.fetch;
  const originalResizeObserver = globalThis.ResizeObserver;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    globalThis.ResizeObserver = originalResizeObserver;
    vi.restoreAllMocks();
  });

  it('switches viewport frame width without remounting the iframe', async () => {
    const user = userEvent.setup();
    mockResizeObserver();
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(300);
    mockFileViewerFetch('<main><h1>Responsive</h1></main>');

    renderWithProviders(
      <FileViewer
        projectId="design_responsive"
        surface="prototype"
        path="artifacts/index.html"
      />,
    );

    const iframe = await screen.findByTitle('html artifact');
    await user.click(screen.getByRole('button', { name: /phone 390/i }));

    await waitFor(() =>
      expect(screen.getByText('Fit 77%')).toBeInTheDocument(),
    );
    expect(screen.getByTitle('html artifact')).toBe(iframe);
    expect(iframe.parentElement).toHaveStyle({
      width: '390px',
      height: '844px',
    });
  });
});

function mockResizeObserver() {
  globalThis.ResizeObserver = class ResizeObserver {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(target: Element) {
      this.callback(
        [
          {
            target,
            contentRect: { width: 300 } as DOMRectReadOnly,
          } as ResizeObserverEntry,
        ],
        this,
      );
    }
    unobserve() {}
    disconnect() {}
  } as typeof ResizeObserver;
}

function mockFileViewerFetch(html: string) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/file?')) {
      return jsonResponse({
        path: 'artifacts/index.html',
        content: html,
        size: html.length,
        updatedAt: '2026-05-12T00:00:00.000Z',
      });
    }
    if (url.includes('/preview')) {
      return new Response(null, { status: 204 });
    }
    return jsonResponse({});
  }) as typeof fetch;
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
