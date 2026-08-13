import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FileViewer } from '@/components/design/FileViewer';

import { renderWithProviders } from './helpers/render-with-providers';

describe('Manual edit hidden target selection', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('keeps hidden data-neuma-id targets selectable from the edit panel', async () => {
    const user = userEvent.setup();
    mockFileViewerFetch();

    renderWithProviders(
      <FileViewer
        projectId="design_hidden"
        surface="prototype"
        path="artifacts/index.html"
      />,
    );

    const iframe = await screen.findByTitle('html artifact');
    await user.click(screen.getByRole('tab', { name: /edit/i }));
    const nonce = iframe.getAttribute('srcdoc')?.match(/var N="([^"]+)"/)?.[1];
    expect(nonce).toBeTruthy();

    fireEvent(
      window,
      new MessageEvent('message', {
        source: (iframe as HTMLIFrameElement).contentWindow,
        data: {
          nonce,
          type: 'event',
          payload: {
            kind: 'neuma-target-list',
            targets: [
              {
                kind: 'neuma-target',
                id: 'hidden-cta',
                label: 'Hidden CTA',
                tagName: 'BUTTON',
                text: 'Hidden CTA',
                styles: { color: 'rgb(255, 255, 255)' },
              },
            ],
          },
        },
      }),
    );

    await user.click(
      await screen.findByRole('button', { name: /hidden cta/i }),
    );
    await waitFor(() =>
      expect(screen.getByText('button · hidden-cta')).toBeVisible(),
    );
  });

  it('keeps the source editor in a full-height pane', async () => {
    const user = userEvent.setup();
    mockFileViewerFetch();

    renderWithProviders(
      <FileViewer
        projectId="design_source_height"
        surface="prototype"
        path="artifacts/index.html"
      />,
    );

    await screen.findByTitle('html artifact');
    await user.click(screen.getByRole('tab', { name: /source/i }));

    expect(screen.getByTestId('file-viewer-source-pane')).toHaveClass(
      'min-h-0',
      'flex-1',
    );
    expect(screen.getByTestId('file-viewer-source-editor')).toHaveClass(
      'h-full',
      'min-h-[420px]',
    );
  });
});

function mockFileViewerFetch() {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/file?')) {
      return jsonResponse({
        path: 'artifacts/index.html',
        content:
          '<main><button data-neuma-id="hidden-cta" style="display:none">Hidden CTA</button></main>',
      });
    }
    if (url.endsWith('/edit/patches')) return jsonResponse({ patches: [] });
    return jsonResponse({});
  }) as typeof fetch;
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
