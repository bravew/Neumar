import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useVideoProject } from '@/shared/hooks/useVideoProject';
import type { VideoProject } from '@/shared/types/video';

afterEach(() => {
  vi.unstubAllGlobals();
});

function project(name: string): VideoProject {
  return {
    id: 'project-1',
    name,
    template: 'custom',
    prompt: '',
    assets: [],
    createdAt: '2026-08-26T00:00:00.000Z',
    updatedAt: '2026-08-26T00:00:00.000Z',
  } as unknown as VideoProject;
}

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

describe('useVideoProject refresh', () => {
  it('does not re-enter the loading state once the project is on screen', async () => {
    // `loading` swaps the editor for a spinner, so a mutation that flipped it
    // would unmount the agent dock and reload its conversation. Render is the
    // loudest case: it refreshes on completion.
    let gate: ((response: Response) => void) | undefined;
    let gateCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string | URL | Request, init?: RequestInit) => {
        const href = String(url);
        if (init?.method === 'POST' && href.includes('/render')) {
          return Promise.resolve(jsonResponse({ render: { status: 'done' } }));
        }
        gateCount += 1;
        // Hold the post-render refresh open so the pending window is real
        // rather than collapsed into one React batch.
        if (gateCount > 1) {
          return new Promise<Response>((resolve) => {
            gate = resolve;
          });
        }
        return Promise.resolve(jsonResponse({ project: project('Clip') }));
      }),
    );

    const { result } = renderHook(() => useVideoProject('project-1'));
    await waitFor(() => expect(result.current.project).not.toBeNull());
    expect(result.current.loading).toBe(false);

    let pending: Promise<unknown> | undefined;
    await act(async () => {
      pending = result.current.renderProject('16:9');
      await waitFor(() => expect(gate).toBeDefined());
    });

    // The refresh is in flight and the editor must still be mounted.
    expect(result.current.loading).toBe(false);

    await act(async () => {
      gate?.(jsonResponse({ project: project('Clip') }));
      await pending;
    });
    expect(result.current.loading).toBe(false);
  });

  it('still shows the loading state before the first project arrives', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonResponse({ project: project('Clip') }))),
    );

    const { result } = renderHook(() => useVideoProject('project-1'));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
  });
});
