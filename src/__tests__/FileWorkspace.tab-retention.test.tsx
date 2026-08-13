import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FileWorkspace } from '@/components/design/FileWorkspace';

import { renderWithProviders } from './helpers/render-with-providers';

describe('FileWorkspace preview tab retention', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('hides recently viewed HTML previews instead of unmounting them and evicts past the cap', async () => {
    const user = userEvent.setup();
    mockWorkspaceFetch();

    renderWithProviders(
      <FileWorkspace
        projectId="design_tabs"
        surface="prototype"
        outputs={[
          {
            id: 'out_one',
            kind: 'html',
            path: 'artifacts/one.html',
            createdAt: '2026-05-24T00:00:00.000Z',
          },
        ]}
      />,
    );

    // The file tree is a collapsible drawer, default collapsed — open it so the
    // per-file buttons are reachable.
    await user.click(
      await screen.findByRole('button', { name: 'Toggle file tree' }),
    );

    await screen.findByTitle('html artifact');
    await waitFor(() =>
      expect(
        screen.getByTitle('html artifact').getAttribute('srcdoc'),
      ).toContain('one'),
    );
    await user.click(
      screen.getByRole('button', { name: 'artifacts/two.html' }),
    );
    await waitFor(() =>
      expect(screen.getAllByTitle('html artifact')).toHaveLength(2),
    );
    expect(
      screen
        .getAllByTitle('html artifact')
        .some((iframe) => iframe.getAttribute('srcdoc')?.includes('one.html')),
    ).toBe(true);
    const secondIframe = screen
      .getAllByTitle('html artifact')
      .find((iframe) => iframe.getAttribute('srcdoc')?.includes('two.html'));
    expect(secondIframe).toBeTruthy();

    await user.click(
      screen.getByRole('button', { name: 'artifacts/one.html' }),
    );
    await waitFor(() =>
      expect(screen.getAllByTitle('html artifact')).toContain(secondIframe),
    );

    await user.click(
      screen.getByRole('button', { name: 'artifacts/three.html' }),
    );
    await user.click(
      screen.getByRole('button', { name: 'artifacts/four.html' }),
    );
    await waitFor(() =>
      expect(screen.getAllByTitle('html artifact')).toHaveLength(3),
    );
    expect(screen.getAllByTitle('html artifact')).not.toContain(secondIframe);
  });
});

function mockWorkspaceFetch() {
  const files = ['one', 'two', 'three', 'four'].map((name) => ({
    name: `${name}.html`,
    path: `artifacts/${name}.html`,
    isDir: false,
  }));
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/files')) return jsonResponse({ files });
    if (url.includes('/file?')) {
      const path = new URL(url).searchParams.get('path') ?? '';
      return jsonResponse({
        path,
        content: `<main><h1>${path}</h1></main>`,
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
