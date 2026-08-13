import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FileViewer } from '@/components/design/FileViewer';

import { renderWithProviders } from './helpers/render-with-providers';

describe('FileViewer JSX module preview', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('previews a JSX module through the sibling HTML Babel entry', async () => {
    mockModuleFetch();

    renderWithProviders(
      <FileViewer
        projectId="design_module"
        surface="prototype"
        path="artifacts/App.jsx"
        projectFiles={[
          { name: 'index.html', path: 'artifacts/index.html', isDir: false },
          { name: 'App.jsx', path: 'artifacts/App.jsx', isDir: false },
        ]}
      />,
    );

    await waitFor(() =>
      expect(
        screen.getByText(
          'This module renders inside artifacts/index.html. Showing the entry preview.',
        ),
      ).toBeVisible(),
    );
    const iframe = await screen.findByTitle('html artifact');
    await waitFor(() =>
      expect(iframe.getAttribute('srcdoc')).toContain('module-root'),
    );
  });
});

function mockModuleFetch() {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/file?')) {
      const path = new URL(url).searchParams.get('path');
      if (path === 'artifacts/index.html') {
        return jsonResponse({
          path,
          content:
            '<div id="module-root"></div><script type="text/babel" src="./App.jsx"></script>',
        });
      }
      return jsonResponse({
        path,
        content: 'export default function App() { return <h1>App</h1>; }',
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
