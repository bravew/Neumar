import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FileWorkspace } from '@/components/design/FileWorkspace';

import { renderWithProviders } from './helpers/render-with-providers';

describe('FileWorkspace read failures', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('shows a calm read error state and retries the file read', async () => {
    const user = userEvent.setup();
    mockWorkspaceFetch();

    renderWithProviders(
      <FileWorkspace
        projectId="design_read_error"
        surface="prototype"
        outputs={[
          {
            id: 'out_html',
            kind: 'html',
            path: 'artifacts/index.html',
            createdAt: '2026-05-25T00:00:00.000Z',
          },
        ]}
      />,
    );

    expect(
      await screen.findByText("Couldn't read this file."),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() =>
      expect(
        screen.queryByText("Couldn't read this file."),
      ).not.toBeInTheDocument(),
    );
    expect(await screen.findByTitle('html artifact')).toHaveAttribute(
      'srcdoc',
      expect.stringContaining('Recovered'),
    );
  });
});

function mockWorkspaceFetch() {
  let readAttempts = 0;
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/files')) {
      return jsonResponse({
        files: [
          {
            name: 'index.html',
            path: 'artifacts/index.html',
            isDir: false,
          },
        ],
      });
    }
    if (url.includes('/file?')) {
      readAttempts += 1;
      const path = new URL(url).searchParams.get('path') ?? '';
      // Fail only the initial mount read; the retry (second read) recovers.
      if (readAttempts <= 1) {
        return jsonResponse({ error: 'FILE_NOT_READABLE' }, 500);
      }
      return jsonResponse({
        path,
        content: '<main><h1>Recovered</h1></main>',
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
