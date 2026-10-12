import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useVideoProject, VideoApiError } from '@/shared/hooks/useVideoProject';
import type { VideoProject } from '@/shared/types/video';

const project: VideoProject = {
  id: 'p',
  name: 'Project',
  template: 'custom',
  prompt: '',
  assets: [],
  createdAt: 'now',
  updatedAt: 'now',
};
const updated: VideoProject = {
  ...project,
  sources: [
    {
      id: 's',
      mediaItemId: 'linked asset',
      origin: 'workspace-path',
      contentHash: 'hash',
      analysisStatus: 'error',
      createdAt: 'now',
    },
  ],
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

afterEach(() => vi.unstubAllGlobals());

describe('useVideoProject transcribeAsset', () => {
  it('posts the existing asset id without upload/provider body and reflects the server project', async () => {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) =>
      Promise.resolve(
        json({ project: init?.method === 'POST' ? updated : project }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useVideoProject('p'));
    await waitFor(() => expect(result.current.project).toEqual(project));
    await act(async () => {
      expect(await result.current.transcribeAsset('linked asset')).toEqual(
        updated,
      );
    });
    expect(fetchMock.mock.calls[1]![0]).toMatch(
      /\/video\/projects\/p\/assets\/linked%20asset\/transcribe$/,
    );
    expect(fetchMock.mock.calls[1]![1]).toMatchObject({ method: 'POST' });
    expect(fetchMock.mock.calls[1]![1]?.body).toBeUndefined();
    expect(result.current.project).toEqual(updated);
  });

  it('refreshes persisted source state on failure while preserving the actionable error', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ project }))
      .mockResolvedValueOnce(
        json(
          {
            project: updated,
            code: 'local-model-not-ready',
            error: 'Install Parakeet.',
          },
          422,
        ),
      )
      .mockResolvedValueOnce(json({ project: updated }));
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useVideoProject('p'));
    await waitFor(() => expect(result.current.project).toEqual(project));
    await act(async () => {
      await expect(
        result.current.transcribeAsset('linked asset'),
      ).rejects.toMatchObject({
        message: 'Install Parakeet.',
        status: 422,
        data: { code: 'local-model-not-ready' },
      });
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.current.project).toEqual(updated);
  });

  it('aborts on project switch and ignores a late response from the previous project', async () => {
    let finish!: (response: Response) => void;
    let signal: AbortSignal | null | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        if (init?.method === 'POST') {
          signal = init.signal;
          return new Promise<Response>((resolve) => {
            finish = resolve;
          });
        }
        return Promise.resolve(
          json({
            project: url.endsWith('/other')
              ? { ...project, id: 'other' }
              : project,
          }),
        );
      }),
    );
    const { result, rerender } = renderHook(({ id }) => useVideoProject(id), {
      initialProps: { id: 'p' },
    });
    await waitFor(() => expect(result.current.project?.id).toBe('p'));
    let request!: Promise<VideoProject | null>;
    act(() => {
      request = result.current.transcribeAsset('a');
    });
    rerender({ id: 'other' });
    await waitFor(() => expect(result.current.project?.id).toBe('other'));
    expect(signal?.aborted).toBe(true);
    await act(async () => {
      finish(json({ project: updated }));
      await request;
    });
    expect(result.current.project?.id).toBe('other');
  });

  it('preserves HTTP failure when refreshing error state also fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(json({ project }))
        .mockResolvedValueOnce(
          json(
            {
              project: updated,
              code: 'local-model-not-ready',
              error: 'Install Parakeet.',
            },
            422,
          ),
        )
        .mockRejectedValueOnce(new Error('Network lost')),
    );
    const { result } = renderHook(() => useVideoProject('p'));
    await waitFor(() => expect(result.current.project).toEqual(project));
    await act(async () => {
      await expect(result.current.transcribeAsset('a')).rejects.toBeInstanceOf(
        VideoApiError,
      );
    });
    expect(result.current.error).toBe('Network lost');
  });
});
