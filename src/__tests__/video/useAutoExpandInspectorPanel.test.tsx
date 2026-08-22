import { renderHook, act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useTimelineEditorStore } from '@/components/video/timeline/useTimelineEditorStore';
import {
  INSPECTOR_PANEL_DEFAULT_SIZE,
  useAutoExpandInspectorPanel,
} from '@/components/video/useAutoExpandInspectorPanel';

/**
 * The Preview step's Inspector column is collapsible to 0% and the side rail
 * hides its Inspector tab on that step, so a collapsed column used to make
 * Transform/Style/Animate/Effects unreachable until a page reload.
 */
function panelStub(collapsed: boolean) {
  return {
    collapse: vi.fn(),
    expand: vi.fn(),
    getSize: vi.fn(() => ({ asPercentage: collapsed ? 0 : 28, inPixels: 0 })),
    isCollapsed: vi.fn(() => collapsed),
    resize: vi.fn(),
  };
}

function resetStore() {
  useTimelineEditorStore.setState({
    projectId: null,
    timeline: null,
    selectedClipId: null,
    selectedClipIds: new Set<string>(),
    lastSelectedClipId: null,
    selectedMarkerId: null,
    selectedSeamId: null,
  });
}

function selectClips(ids: string[]) {
  act(() => {
    useTimelineEditorStore.setState({
      selectedClipId: ids[0] ?? null,
      selectedClipIds: new Set(ids),
    });
  });
}

describe('useAutoExpandInspectorPanel', () => {
  afterEach(() => {
    resetStore();
    vi.restoreAllMocks();
  });

  it('reopens a collapsed inspector at a usable width when a clip is selected', () => {
    resetStore();
    const panel = panelStub(true);
    const { result } = renderHook(() => useAutoExpandInspectorPanel());
    result.current.current = panel;

    selectClips(['clip-1']);

    expect(panel.resize).toHaveBeenCalledWith(INSPECTOR_PANEL_DEFAULT_SIZE);
  });

  it('reopens when the user picks a different clip, not just the first one', () => {
    resetStore();
    const panel = panelStub(true);
    const { result } = renderHook(() => useAutoExpandInspectorPanel());
    result.current.current = panel;

    selectClips(['clip-1']);
    selectClips(['clip-2']);

    expect(panel.resize).toHaveBeenCalledTimes(2);
  });

  it('leaves an already-open inspector alone', () => {
    resetStore();
    const panel = panelStub(false);
    const { result } = renderHook(() => useAutoExpandInspectorPanel());
    result.current.current = panel;

    selectClips(['clip-1']);

    expect(panel.resize).not.toHaveBeenCalled();
  });

  it('does not fight a user who collapses it while the selection is unchanged', () => {
    resetStore();
    const panel = panelStub(true);
    const { result, rerender } = renderHook(() =>
      useAutoExpandInspectorPanel(),
    );
    result.current.current = panel;

    selectClips(['clip-1']);
    panel.resize.mockClear();
    rerender();

    expect(panel.resize).not.toHaveBeenCalled();
  });

  it('does not reopen when the selection is cleared', () => {
    resetStore();
    const panel = panelStub(true);
    const { result } = renderHook(() => useAutoExpandInspectorPanel());
    result.current.current = panel;

    selectClips(['clip-1']);
    panel.resize.mockClear();
    selectClips([]);

    expect(panel.resize).not.toHaveBeenCalled();
  });

  it('reopens for a transition seam selection too', () => {
    resetStore();
    const panel = panelStub(true);
    const { result } = renderHook(() => useAutoExpandInspectorPanel());
    result.current.current = panel;

    act(() => {
      useTimelineEditorStore.setState({
        timeline: {
          schema: 'neuma.video.timeline.v1',
          durationMs: 1000,
          fps: 30,
          tracks: [],
        },
        selectedSeamId: 'seam:track-video:clip-1:clip-2',
      });
    });

    expect(panel.resize).toHaveBeenCalledWith(INSPECTOR_PANEL_DEFAULT_SIZE);
  });
});
