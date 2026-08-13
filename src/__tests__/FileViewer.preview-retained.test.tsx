import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FileViewer } from '@/components/design/FileViewer';

import { renderWithProviders } from './helpers/render-with-providers';

describe('FileViewer preview retention', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('keeps the HTML iframe mounted while toggling source mode', async () => {
    const user = userEvent.setup();
    mockFileViewerFetch('<main><h1>Retained</h1></main>');

    renderWithProviders(
      <FileViewer
        projectId="design_retained"
        surface="prototype"
        path="artifacts/index.html"
      />,
    );

    const iframe = await screen.findByTitle('html artifact');
    await waitFor(() =>
      expect(iframe.getAttribute('srcdoc')).toContain('Retained'),
    );

    await user.click(screen.getByRole('tab', { name: /source/i }));
    expect(screen.getByTitle('html artifact')).toBe(iframe);

    await user.click(screen.getByRole('tab', { name: /preview/i }));
    expect(screen.getByTitle('html artifact')).toBe(iframe);
  });

  it('retains a preview loaded while the document is hidden', async () => {
    let visibility: DocumentVisibilityState = 'hidden';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(
      () => visibility,
    );
    mockFileViewerFetch('<main><h1>Hidden load</h1></main>');

    renderWithProviders(
      <FileViewer
        projectId="design_hidden_load"
        surface="prototype"
        path="artifacts/index.html"
      />,
    );

    const iframe = await screen.findByTitle('html artifact');
    await waitFor(() =>
      expect(iframe.getAttribute('srcdoc')).toContain('Hidden load'),
    );
    visibility = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));

    expect(screen.getByTitle('html artifact')).toBe(iframe);
    expect(iframe.getAttribute('srcdoc')).toContain('Hidden load');
  });
});

function mockFileViewerFetch(html: string) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/file?')) {
      return jsonResponse({
        path: 'artifacts/index.html',
        content: html,
      });
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
