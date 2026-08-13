import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SketchEditor } from '@/components/design/SketchEditor';

import { renderWithProviders } from './helpers/render-with-providers';

describe('SketchEditor save feedback', () => {
  const originalFetch = globalThis.fetch;
  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  const originalGetBoundingClientRect =
    HTMLCanvasElement.prototype.getBoundingClientRect;

  beforeEach(() => {
    HTMLCanvasElement.prototype.getContext = vi.fn(
      () =>
        ({
          beginPath: vi.fn(),
          clearRect: vi.fn(),
          lineTo: vi.fn(),
          moveTo: vi.fn(),
          setTransform: vi.fn(),
          stroke: vi.fn(),
          lineCap: 'round',
          lineJoin: 'round',
          globalAlpha: 1,
          lineWidth: 1,
          strokeStyle: '#000',
        }) as unknown as CanvasRenderingContext2D,
    ) as unknown as HTMLCanvasElement['getContext'];
    HTMLCanvasElement.prototype.getBoundingClientRect = vi.fn(
      () =>
        ({
          left: 0,
          top: 0,
          width: 1280,
          height: 720,
        }) as DOMRect,
    );
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    HTMLCanvasElement.prototype.getBoundingClientRect =
      originalGetBoundingClientRect;
    vi.restoreAllMocks();
  });

  it('keeps saving visible for at least 500ms and then shows saved on the button', async () => {
    mockSketchFetch();
    const { container } = renderWithProviders(
      <SketchEditor projectId="design_sketch" screenId="home" />,
    );
    const canvas = container.querySelector('canvas');
    expect(canvas).toBeTruthy();

    fireEvent.pointerDown(canvas!, {
      clientX: 20,
      clientY: 20,
      pointerId: 1,
      pointerType: 'mouse',
    });
    fireEvent.pointerMove(canvas!, {
      clientX: 40,
      clientY: 40,
      pointerId: 1,
      pointerType: 'mouse',
    });
    fireEvent.pointerUp(canvas!, { pointerId: 1, pointerType: 'mouse' });

    fireEvent.click(screen.getByRole('button', { name: /save sketch/i }));
    expect(screen.getByRole('button', { name: /saving/i })).toBeVisible();

    await wait(250);
    expect(screen.getByRole('button', { name: /saving/i })).toBeVisible();

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^saved$/i })).toBeVisible(),
    );
  });
});

function mockSketchFetch() {
  globalThis.fetch = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/file?'))
        return jsonResponse({ path: '', content: '{}' });
      if (url.endsWith('/sketches') && init?.method === 'POST') {
        return jsonResponse({ screenId: 'home' });
      }
      return jsonResponse({});
    },
  ) as typeof fetch;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
