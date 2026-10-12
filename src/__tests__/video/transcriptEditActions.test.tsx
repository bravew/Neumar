import { act, fireEvent, render, screen } from '@testing-library/react';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useTimelineEditorStore } from '@/components/video/timeline/useTimelineEditorStore';
import { SourceTranscriptPanel } from '@/components/video/transcript/SourceTranscriptPanel';
import { useTranscriptSelectionStore } from '@/components/video/transcript/useTranscriptSelectionStore';
import { LanguageProvider } from '@/shared/providers/language-provider';
import type { VideoProject, VideoTimeline } from '@/shared/types/video';

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

const words = Array.from({ length: 10 }, (_, i) => ({
  text: `w${i}`,
  startMs: i * 100,
  endMs: i * 100 + 100,
}));

const timeline = {
  schema: 'neuma.video.timeline.v1',
  fps: 30,
  durationMs: 1000,
  tracks: [
    {
      id: 'v',
      kind: 'video',
      name: 'V',
      muted: false,
      locked: false,
      order: 0,
      clips: [
        {
          id: 'c',
          kind: 'video',
          sourceRef: { kind: 'asset', assetId: 'a' },
          startMs: 0,
          durationMs: 1000,
          trimStartMs: 0,
          trimEndMs: 1000,
        },
      ],
    },
  ],
} as unknown as VideoTimeline;

function project(): VideoProject {
  return {
    id: 'p',
    sources: [{ id: 's', mediaItemId: 'a' }],
    sourceAnalyses: [
      { id: 'an', sourceId: 's', transcript: { engine: 't', words } },
    ],
    timeline: useTimelineEditorStore.getState().timeline ?? timeline,
  } as unknown as VideoProject;
}

function panel() {
  return (
    <LanguageProvider>
      <SourceTranscriptPanel project={project()} />
    </LanguageProvider>
  );
}

function renderPanel() {
  return render(panel());
}

const clipDurations = () =>
  useTimelineEditorStore
    .getState()
    .timeline!.tracks[0]!.clips.map((c) => c.durationMs);

describe('transcript edit actions', () => {
  beforeEach(() => {
    useTimelineEditorStore.setState({
      ...useTimelineEditorStore.getInitialState(),
      projectId: 'p',
      timeline,
    });
    useTranscriptSelectionStore.setState(
      useTranscriptSelectionStore.getInitialState(),
    );
  });

  it('Delete in text mode never changes the timeline (AT-09)', () => {
    renderPanel();
    fireEvent.mouseDown(screen.getByText('w3'));
    fireEvent.mouseDown(screen.getByText('w5'), { shiftKey: true });
    fireEvent.keyDown(screen.getByRole('group', { name: 'Speech' }), {
      key: 'Delete',
    });
    expect(useTimelineEditorStore.getState().timeline).toBe(timeline);
  });

  it('cut, undo, then restore round-trips as single history steps (AT-08)', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Cut media' }));
    fireEvent.mouseDown(screen.getByText('w3'));
    fireEvent.mouseDown(screen.getByText('w5'), { shiftKey: true });
    fireEvent.keyDown(screen.getByRole('group', { name: 'Speech' }), {
      key: 'Delete',
    });
    expect(clipDurations().reduce((a, b) => a + b, 0)).toBe(700);

    useTimelineEditorStore.getState().undoUserEdit();
    expect(clipDurations()).toEqual([1000]);

    fireEvent.keyDown(screen.getByRole('group', { name: 'Speech' }), {
      key: 'Delete',
    });
    expect(clipDurations().reduce((a, b) => a + b, 0)).toBe(700);
    useTimelineEditorStore.getState().undoUserEdit();
    expect(clipDurations()).toEqual([1000]);
  });

  it('shows cut and undo immediately while the project prop remains unsaved', () => {
    const saved = project();
    render(
      <LanguageProvider>
        <SourceTranscriptPanel project={saved} />
      </LanguageProvider>,
    );
    fireEvent.mouseDown(screen.getByText('w3'));
    fireEvent.mouseDown(screen.getByText('w5'), { shiftKey: true });
    fireEvent.click(screen.getByRole('button', { name: 'Cut' }));
    expect(screen.getByText('w4').getAttribute('data-status')).toBe('cut');
    expect(saved.timeline).toBe(timeline);
    act(() => useTimelineEditorStore.getState().undoUserEdit());
    expect(screen.getByText('w4').getAttribute('data-status')).toBe('kept');
  });

  it('Restore re-adds a cut run via the Restore button', () => {
    const view = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Cut media' }));
    fireEvent.mouseDown(screen.getByText('w3'));
    fireEvent.mouseDown(screen.getByText('w5'), { shiftKey: true });
    fireEvent.keyDown(screen.getByRole('group', { name: 'Speech' }), {
      key: 'Delete',
    });
    view.rerender(panel());
    fireEvent.mouseDown(screen.getByText('w4'));
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    expect(
      useTimelineEditorStore
        .getState()
        .timeline!.tracks[0]!.clips.reduce((a, c) => a + c.durationMs, 0),
    ).toBe(1000);
  });

  it('reports a cut-specific error when the cut cannot be applied', () => {
    vi.mocked(toast.error).mockClear();
    vi.spyOn(
      useTimelineEditorStore.getState(),
      'applyTimelineOpBatch',
    ).mockReturnValue(false);
    renderPanel();
    fireEvent.mouseDown(screen.getByText('w3'));
    fireEvent.mouseDown(screen.getByText('w5'), { shiftKey: true });
    fireEvent.click(screen.getByRole('button', { name: 'Cut' }));
    expect(toast.error).toHaveBeenCalledWith('This cut could not be applied.');
  });
});
