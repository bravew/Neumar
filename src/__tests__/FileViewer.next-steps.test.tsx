import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FileViewer } from '@/components/design/FileViewer';

import { renderWithProviders } from './helpers/render-with-providers';

describe('FileViewer next steps', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('surfaces post-generation actions for generated artifacts', async () => {
    const user = userEvent.setup();
    const onSendToChat = vi.fn();
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    mockFileViewerFetch();

    renderWithProviders(
      <FileViewer
        projectId="design_next_steps"
        surface="prototype"
        path="artifacts/index.html"
        onSendToChat={onSendToChat}
      />,
    );

    expect(
      screen.getByRole('region', { name: /artifact next steps/i }),
    ).toBeVisible();

    await user.click(screen.getByRole('button', { name: /iterate/i }));
    expect(onSendToChat).toHaveBeenCalledWith(
      'Iterate on artifacts/index.html. Improve the current artifact while preserving its working structure.',
    );

    await user.click(screen.getByRole('button', { name: /copy path/i }));
    expect(writeText).toHaveBeenCalledWith('artifacts/index.html');
    expect(screen.getByRole('button', { name: /copied/i })).toBeVisible();
  });

  it('does not show post-generation actions for reference files', () => {
    mockFileViewerFetch();

    renderWithProviders(
      <FileViewer
        projectId="design_next_steps"
        surface="prototype"
        path="design-system/DESIGN.md"
      />,
    );

    expect(
      screen.queryByRole('region', { name: /artifact next steps/i }),
    ).toBeNull();
  });
});

function mockFileViewerFetch() {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/file?')) {
      return jsonResponse({
        path: 'artifacts/index.html',
        content: '<main><h1>Generated artifact</h1></main>',
      });
    }
    if (url.endsWith('/comments')) return jsonResponse({ comments: [] });
    return jsonResponse({});
  }) as typeof fetch;
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
