import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { VideoProjectEditorActions } from '@/components/video/editorTypes';
import { useTimelineEditorStore } from '@/components/video/timeline/useTimelineEditorStore';
import { LocalTranscriptModelSetup } from '@/components/video/transcript/LocalTranscriptModelSetup';
import { getTranscribableAssets } from '@/components/video/transcript/SourceTranscriptionAction';
import { TranscriptTab } from '@/components/video/transcript/TranscriptTab';
import { VideoApiError } from '@/shared/hooks/useVideoProject';
import { LanguageProvider } from '@/shared/providers/language-provider';
import type { VideoMediaItem, VideoProject } from '@/shared/types/video';

vi.mock('@/components/video/TranscriptView', () => ({
  TranscriptView: () => <div>Scene text editor</div>,
}));

function asset(
  id: string,
  kind: VideoMediaItem['kind'] = 'video',
): VideoMediaItem {
  return {
    id,
    kind,
    source: 'uploaded',
    path: `${id}.mp4`,
    metadata: { durationMs: 1000 },
  };
}

function project(
  assets = [asset('video'), asset('audio', 'audio')],
): VideoProject {
  return {
    id: 'p',
    name: 'Project',
    template: 'custom',
    prompt: '',
    assets,
    createdAt: '2026-10-12',
    updatedAt: '2026-10-12',
    timeline: {
      schema: 'neuma.video.timeline.v1',
      fps: 30,
      durationMs: 1000,
      tracks: [
        {
          id: 'v',
          kind: 'video',
          name: 'Video',
          muted: false,
          locked: false,
          order: 0,
          clips: assets
            .filter((item) => item.kind !== 'audio')
            .map((item) => ({
              id: item.id,
              kind: item.kind === 'image' ? 'image' : 'video',
              sourceRef: { kind: 'asset', assetId: item.id },
              startMs: 0,
              durationMs: 1000,
              trimStartMs: 0,
              trimEndMs: 1000,
            })),
        },
        {
          id: 'a',
          kind: 'audio-vo',
          name: 'Audio',
          muted: false,
          locked: false,
          order: 1,
          clips: assets
            .filter((item) => item.kind === 'audio')
            .map((item) => ({
              id: item.id,
              kind: 'audio',
              sourceRef: { kind: 'asset', assetId: item.id },
              startMs: 0,
              durationMs: 1000,
              trimStartMs: 0,
              trimEndMs: 1000,
              volume: 1,
            })),
        },
      ],
    },
  };
}

function actions(
  transcribeAsset: VideoProjectEditorActions['transcribeAsset'],
) {
  // The scene editor is stubbed; all speech actions are real props under test.
  return {
    transcribeAsset,
    patchSourceTranscript: vi.fn(),
  } as unknown as VideoProjectEditorActions;
}

beforeEach(() =>
  useTimelineEditorStore.setState(useTimelineEditorStore.getInitialState()),
);
afterEach(() => vi.unstubAllGlobals());

describe('Transcript tab transcription', () => {
  it('offers translation for cached speech before a caption track exists', async () => {
    const p = project([asset('video')]);
    p.sources = [
      {
        id: 's',
        mediaItemId: 'video',
        origin: 'upload',
        contentHash: 'hash',
        analysisStatus: 'done',
        createdAt: 'now',
      },
    ];
    p.sourceAnalyses = [
      {
        id: 'analysis',
        sourceId: 's',
        durationMs: 1000,
        scenes: [],
        speechRanges: [],
        cutCandidates: [],
        transcript: {
          engine: 'local',
          words: [{ text: 'hello', startMs: 0, endMs: 100 }],
        },
      },
    ];
    const prepared: VideoProject = {
      ...p,
      timeline: {
        ...p.timeline!,
        tracks: [
          ...p.timeline!.tracks,
          {
            id: 'captions',
            kind: 'caption',
            name: 'Captions',
            muted: false,
            locked: false,
            order: 30,
            clips: [
              {
                id: 'cue',
                kind: 'caption',
                sourceRef: { kind: 'asset', assetId: 'video' },
                startMs: 0,
                durationMs: 100,
                trimStartMs: 0,
                trimEndMs: 100,
                text: 'hello',
              },
            ],
          },
        ],
      },
    };
    const prepareCaptionTranslation = vi.fn().mockResolvedValue(prepared);
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              destination: 'https://api.example.com',
              configured: true,
            }),
          ),
      ),
    );
    render(
      <TranscriptTab
        project={p}
        actions={{ ...actions(vi.fn()), prepareCaptionTranslation }}
      />,
      { wrapper: LanguageProvider },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Translate captions' }));
    await waitFor(() =>
      expect(prepareCaptionTranslation).toHaveBeenCalledTimes(1),
    );
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('shows an honest speech empty state and retains scene editing as a separate tab', () => {
    render(<TranscriptTab project={project([])} actions={actions(vi.fn())} />, {
      wrapper: LanguageProvider,
    });
    expect(
      screen.getByText(/No word-timed speech transcript yet/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Transcribe asset' }),
    ).toBeDisabled();
    expect(screen.queryByText('Scene text editor')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Scenes' }));
    expect(screen.getByText('Scene text editor')).toBeInTheDocument();
  });

  it('includes linked/catalog video and audio, deduplicates clips, skips images, silent video and transcribed sources', () => {
    const linked = {
      ...asset('linked'),
      origin: 'external' as const,
      provenance: { provider: 'local-fs', sourceDisplayName: 'Interview' },
    };
    const catalog = {
      ...asset('catalog'),
      path: 'catalog:remote',
      materializationState: 'referenced' as const,
    };
    const p = project([
      linked,
      catalog,
      asset('audio', 'audio'),
      asset('image', 'image'),
      {
        ...asset('silent'),
        metadata: { durationMs: 1000, audioTrackCount: 0 },
      },
    ]);
    p.sources = [
      {
        id: 's',
        mediaItemId: 'audio',
        origin: 'upload',
        contentHash: 'hash',
        analysisStatus: 'done',
        createdAt: 'now',
      },
    ];
    p.sourceAnalyses = [
      {
        id: 'analysis',
        sourceId: 's',
        durationMs: 1000,
        scenes: [],
        speechRanges: [],
        cutCandidates: [],
        transcript: {
          engine: 'local',
          words: [{ text: 'hello', startMs: 0, endMs: 100 }],
        },
      },
    ];
    const videoTrack = p.timeline?.tracks.find(
      (track) => track.kind === 'video',
    );
    if (!videoTrack || videoTrack.kind !== 'video' || !videoTrack.clips[0])
      throw new Error('Missing video fixture');
    videoTrack.clips.push({ ...videoTrack.clips[0], id: 'duplicate' });
    expect(getTranscribableAssets(p).map((item) => item.id)).toEqual([
      'linked',
      'catalog',
    ]);
  });

  it('resolves linked source references to their registered media asset', () => {
    const p = project([asset('linked')]);
    p.sources = [
      {
        id: 's',
        mediaItemId: 'linked',
        origin: 'workspace-path',
        contentHash: 'hash',
        analysisStatus: 'idle',
        createdAt: 'now',
      },
    ];
    const clip = p.timeline?.tracks[0]?.clips[0];
    if (!clip) throw new Error('Missing clip fixture');
    clip.sourceRef = { kind: 'linked', sourceId: 's', externalId: 'file' };
    expect(getTranscribableAssets(p).map((item) => item.id)).toEqual([
      'linked',
    ]);
  });

  it('uses the live timeline and selected asset, disables repeated submits and renders the updated speech', async () => {
    const p = project();
    useTimelineEditorStore.setState({
      projectId: 'p',
      timeline: project([asset('audio', 'audio')]).timeline,
    });
    let finish!: (value: VideoProject) => void;
    const transcribeAsset = vi.fn(
      () =>
        new Promise<VideoProject>((resolve) => {
          finish = resolve;
        }),
    );
    const { rerender } = render(
      <TranscriptTab project={p} actions={actions(transcribeAsset)} />,
      { wrapper: LanguageProvider },
    );
    expect(screen.getAllByRole('option')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Transcribe asset' }));
    expect(transcribeAsset).toHaveBeenCalledWith('audio');
    expect(
      screen.getByRole('button', { name: 'Transcribing…' }),
    ).toBeDisabled();
    expect(screen.getByRole('combobox')).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Analyzing audio');
    fireEvent.click(screen.getByRole('button', { name: 'Transcribing…' }));
    expect(transcribeAsset).toHaveBeenCalledTimes(1);
    const updated: VideoProject = {
      ...p,
      sources: [
        {
          id: 's',
          mediaItemId: 'audio',
          origin: 'upload',
          contentHash: 'hash',
          analysisStatus: 'done',
          createdAt: 'now',
        },
      ],
      sourceAnalyses: [
        {
          id: 'a',
          sourceId: 's',
          durationMs: 1000,
          scenes: [],
          speechRanges: [],
          cutCandidates: [],
          transcript: {
            engine: 'local',
            words: [{ text: 'spoken', startMs: 0, endMs: 100 }],
          },
        },
      ],
    };
    await act(async () => finish(updated));
    rerender(
      <TranscriptTab project={updated} actions={actions(transcribeAsset)} />,
    );
    expect(screen.getByRole('button', { name: 'spoken' })).toBeInTheDocument();
    expect(
      screen.queryByText(/No word-timed speech transcript/),
    ).not.toBeInTheDocument();
  });

  it('keeps actionable failures visible and permits retry without switching to scene text', async () => {
    const transcribeAsset = vi
      .fn()
      .mockRejectedValueOnce(
        new VideoApiError(
          'No timed speech found. Check the audio track.',
          422,
          { code: 'timed-transcript-unavailable' },
        ),
      )
      .mockResolvedValue(project());
    render(
      <TranscriptTab project={project()} actions={actions(transcribeAsset)} />,
      { wrapper: LanguageProvider },
    );
    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: 'audio' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Transcribe asset' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Check the audio track',
    );
    expect(screen.queryByText('Scene text editor')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Transcribe asset' }),
    ).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Transcribe asset' }));
    await waitFor(() =>
      expect(screen.queryByRole('alert')).not.toBeInTheDocument(),
    );
    expect(transcribeAsset).toHaveBeenLastCalledWith('audio');
  });

  it('tracks explicit model download until ready and stops polling on unmount', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            sttModels: { parakeet: { state: 'not_downloaded' } },
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: 'download_started' })),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ sttModels: { parakeet: { state: 'downloading' } } }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ sttModels: { parakeet: { state: 'ready' } } }),
        ),
      );
    vi.stubGlobal('fetch', fetchMock);
    const { unmount } = render(<LocalTranscriptModelSetup />, {
      wrapper: LanguageProvider,
    });
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Download local model (487 MB)',
      }),
    );
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Downloading'),
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    await waitFor(
      () =>
        expect(screen.getByRole('status')).toHaveTextContent(
          'Local model ready',
        ),
      { timeout: 2500 },
    );
    expect(fetchMock).toHaveBeenCalledTimes(4);
    unmount();
  });

  it('stops model polling and aborts its request when the setup panel unmounts', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ sttModels: { parakeet: { state: 'downloading' } } }),
        ),
      );
    vi.stubGlobal('fetch', fetchMock);
    const { unmount } = render(<LocalTranscriptModelSetup />, {
      wrapper: LanguageProvider,
    });
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Downloading'),
    );
    const signal = fetchMock.mock.calls[0]?.[1]?.signal;
    unmount();
    expect(signal?.aborted).toBe(true);
  });

  it('offers model setup explicitly, reports download failure and never uploads audio', async () => {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) =>
      Promise.resolve(
        new Response(
          JSON.stringify(
            init?.method === 'POST'
              ? { error: 'Disk full' }
              : { sttModels: { parakeet: { state: 'not_downloaded' } } },
          ),
          { status: init?.method === 'POST' ? 500 : 200 },
        ),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const transcribeAsset = vi.fn().mockRejectedValue(
      new VideoApiError('Install the timing model.', 422, {
        code: 'local-model-not-ready',
      }),
    );
    render(
      <TranscriptTab project={project()} actions={actions(transcribeAsset)} />,
      { wrapper: LanguageProvider },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Transcribe asset' }));
    const download = await screen.findByRole('button', {
      name: 'Download local model (487 MB)',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toMatch(/\/speech\/local\/status$/);
    fireEvent.click(download);
    expect(await screen.findByText('Disk full')).toBeInTheDocument();
    expect(fetchMock.mock.calls[1]![0]).toMatch(/\/speech\/local\/download$/);
    expect(fetchMock.mock.calls[1]![1]?.body).toBe(
      JSON.stringify({ model: 'parakeet' }),
    );
    expect(
      screen.getByRole('button', { name: 'Download local model (487 MB)' }),
    ).toBeEnabled();
  });
});
