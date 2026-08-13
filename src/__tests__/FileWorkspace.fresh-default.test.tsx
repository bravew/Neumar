import { useLocation } from 'react-router-dom';

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FileWorkspace } from '@/components/design/FileWorkspace';

import { renderWithProviders } from './helpers/render-with-providers';

describe('FileWorkspace fresh project defaults', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('shows the artifact home instead of auto-opening scaffold files', async () => {
    const user = userEvent.setup();
    const fileReads: string[] = [];
    mockWorkspaceFetch({ fileReads });

    renderWithProviders(
      <>
        <FileWorkspace
          projectId="design_fresh"
          surface="prototype"
          outputs={[]}
        />
        <LocationProbe />
      </>,
      { initialEntries: ['/design/design_fresh'] },
    );

    expect(
      await screen.findByText('Generated assets appear here.'),
    ).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Toggle file tree' }));
    expect(
      await screen.findByRole('button', { name: 'project.json' }),
    ).toBeVisible();
    expect(fileReads).toEqual([]);
    expect(screen.getByTestId('route-probe')).toHaveTextContent(
      '/design/design_fresh',
    );
  });

  it('keeps explicit scaffold deep links reachable', async () => {
    const fileReads: string[] = [];
    mockWorkspaceFetch({ fileReads });

    renderWithProviders(
      <>
        <FileWorkspace
          projectId="design_fresh"
          surface="prototype"
          outputs={[]}
        />
        <LocationProbe />
      </>,
      { initialEntries: ['/design/design_fresh?file=project.json'] },
    );

    await waitFor(() => expect(fileReads).toContain('project.json'));
    expect(
      await screen.findByDisplayValue(/"title": "Scaffold"/),
    ).toBeVisible();
    expect(screen.getByTestId('route-probe')).toHaveTextContent(
      '/design/design_fresh?file=project.json',
    );
  });
});

function mockWorkspaceFetch({ fileReads }: { fileReads: string[] }) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/files')) {
      return jsonResponse({
        files: [
          {
            name: 'project.json',
            path: 'project.json',
            isDir: false,
          },
          {
            name: 'brief.json',
            path: 'brief.json',
            isDir: false,
          },
        ],
      });
    }
    if (url.includes('/file?')) {
      const path =
        new URL(url, 'http://localhost').searchParams.get('path') ?? '';
      fileReads.push(path);
      return jsonResponse({
        path,
        content: '{\n  "title": "Scaffold"\n}',
      });
    }
    return jsonResponse({});
  }) as typeof fetch;
}

function LocationProbe() {
  const location = useLocation();
  return (
    <output data-testid="route-probe">
      {location.pathname}
      {location.search}
    </output>
  );
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
