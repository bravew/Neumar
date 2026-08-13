import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FileViewer } from '@/components/design/FileViewer';

import { renderWithProviders } from './helpers/render-with-providers';

describe('FileViewer draw send', () => {
  const originalFetch = globalThis.fetch;
  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  const originalGetBoundingClientRect =
    HTMLCanvasElement.prototype.getBoundingClientRect;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    HTMLCanvasElement.prototype.getBoundingClientRect =
      originalGetBoundingClientRect;
    vi.restoreAllMocks();
  });

  it('persists the draw comment then hands the prompt to the design composer queue', async () => {
    const user = userEvent.setup();
    const postedBodies: unknown[] = [];
    const onSendToChat = vi.fn();
    HTMLCanvasElement.prototype.getContext = vi.fn(
      () =>
        ({
          beginPath: vi.fn(),
          clearRect: vi.fn(),
          lineTo: vi.fn(),
          moveTo: vi.fn(),
          restore: vi.fn(),
          save: vi.fn(),
          setTransform: vi.fn(),
          stroke: vi.fn(),
          lineCap: 'round',
          lineJoin: 'round',
          lineWidth: 1,
          strokeStyle: '#000',
        }) as unknown as CanvasRenderingContext2D,
    ) as unknown as HTMLCanvasElement['getContext'];
    HTMLCanvasElement.prototype.getBoundingClientRect = vi.fn(
      () =>
        ({
          left: 0,
          top: 0,
          width: 320,
          height: 240,
        }) as DOMRect,
    );
    mockFileViewerFetch(postedBodies);

    renderWithProviders(
      <FileViewer
        projectId="design_draw"
        surface="prototype"
        path="artifacts/index.html"
        onSendToChat={onSendToChat}
      />,
    );

    await user.click(await screen.findByRole('tab', { name: /draw/i }));
    const canvas = await screen.findByLabelText(/0 strokes/i);
    fireEvent.pointerDown(canvas, {
      clientX: 12,
      clientY: 14,
      pointerId: 1,
      pointerType: 'mouse',
    });
    fireEvent.pointerMove(canvas, {
      clientX: 32,
      clientY: 34,
      pointerId: 1,
      pointerType: 'mouse',
    });
    fireEvent.pointerUp(canvas, { pointerId: 1, pointerType: 'mouse' });

    await user.click(screen.getByRole('button', { name: /send to chat/i }));

    await waitFor(() => expect(postedBodies).toHaveLength(1));
    expect(postedBodies[0]).toMatchObject({
      attachToChat: true,
      attachments: [{ kind: 'draw' }],
    });
    expect(onSendToChat).toHaveBeenCalledWith('Draw annotation attached.');
  });
});

function mockFileViewerFetch(postedBodies: unknown[]) {
  globalThis.fetch = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/file?')) {
        return jsonResponse({
          path: 'artifacts/index.html',
          content: '<main><h1>Draw</h1></main>',
        });
      }
      if (url.endsWith('/comments') && init?.method === 'POST') {
        postedBodies.push(JSON.parse(String(init.body)));
        return jsonResponse({ comment: { id: 'comment_draw' } }, 201);
      }
      if (url.endsWith('/comments')) return jsonResponse({ comments: [] });
      return jsonResponse({});
    },
  ) as typeof fetch;
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
