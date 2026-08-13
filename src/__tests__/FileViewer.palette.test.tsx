import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FileViewer } from '@/components/design/FileViewer';

import { renderWithProviders } from './helpers/render-with-providers';

describe('FileViewer palette and free-pin comments', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('posts palette messages to the sandbox iframe', async () => {
    const user = userEvent.setup();
    mockFileViewerFetch('<main><h1>Palette</h1></main>');

    renderWithProviders(
      <FileViewer
        projectId="design_test"
        surface="prototype"
        path="artifacts/index.html"
      />,
    );

    const iframe = await screen.findByTitle('html artifact');
    await waitFor(() =>
      expect(iframe.getAttribute('srcdoc')).toContain('Palette'),
    );
    const frameWindow = (iframe as HTMLIFrameElement).contentWindow as Window;
    const postMessage = vi.spyOn(frameWindow, 'postMessage');
    const nonce = iframe.getAttribute('srcdoc')?.match(/var N="([^"]+)"/)?.[1];
    expect(nonce).toBeTruthy();
    fireEvent(
      window,
      new MessageEvent('message', {
        source: frameWindow,
        data: { nonce, type: 'shell:ready' },
      }),
    );

    await user.click(await screen.findByRole('button', { name: /tweaks/i }));
    await user.click(await screen.findByRole('button', { name: /coral/i }));

    await waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'palette/apply',
          hue: 8,
          desaturate: false,
        }),
        '*',
      ),
    );
  });

  it('opens a coordinate pin target and saves it without chat attach', async () => {
    const user = userEvent.setup();
    const postedBodies: unknown[] = [];
    mockFileViewerFetch('<main><h1>No annotations</h1></main>', postedBodies);

    renderWithProviders(
      <FileViewer
        projectId="design_test"
        surface="prototype"
        path="artifacts/index.html"
      />,
    );

    await user.click(await screen.findByRole('tab', { name: /comment/i }));
    const iframe = await screen.findByTitle('html artifact');
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
            kind: 'neuma-target',
            id: 'data-neuma-pin-10-20',
            selector: '[data-neuma-pin="data-neuma-pin-10-20"]',
            role: 'pin',
            label: 'pin',
            tagName: 'PIN',
            pin: { x: 10, y: 20 },
          },
        },
      }),
    );

    expect(await screen.findByText('Pin · at 10, 20')).toBeVisible();
    await user.type(screen.getByPlaceholderText(/write a comment/i), 'Pin it.');
    await user.click(screen.getByRole('button', { name: /^comment$/i }));

    await waitFor(() => expect(postedBodies).toHaveLength(1));
    expect(postedBodies[0]).toMatchObject({
      text: 'Pin it.',
      attachToChat: false,
      target: {
        selector: '[data-neuma-pin="data-neuma-pin-10-20"]',
        x: 10,
        y: 20,
      },
    });
  });
});

function mockFileViewerFetch(html: string, postedBodies: unknown[] = []) {
  globalThis.fetch = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/file?')) {
        return jsonResponse({ path: 'artifacts/index.html', content: html });
      }
      if (url.endsWith('/comments') && init?.method === 'POST') {
        postedBodies.push(JSON.parse(String(init.body)));
        return jsonResponse({ comment: { id: 'comment_1' } }, 201);
      }
      if (url.endsWith('/comments')) {
        return jsonResponse({ comments: [] });
      }
      return jsonResponse({});
    },
  ) as typeof fetch;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
