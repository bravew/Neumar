import { renderHook, act } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useTimelineEditorStore } from '@/components/video/timeline/useTimelineEditorStore';
import { useTimelineUiStore } from '@/components/video/timeline/useTimelineUiStore';
import { useVideoEditorSelectionContext } from '@/components/video/useVideoEditorSelectionContext';

describe('useVideoEditorSelectionContext', () => {
  beforeEach(() => {
    act(() => {
      useTimelineEditorStore.setState({
        projectId: 'project-1',
        selectedClipIds: new Set<string>(),
      });
      useTimelineUiStore.setState({ playheadMs: 0, inspectorPanel: null });
    });
  });

  it('emits activePanel when the clip inspector is open', () => {
    act(() => {
      useTimelineEditorStore.setState({
        selectedClipIds: new Set(['clip-overlay-1']),
      });
      useTimelineUiStore.setState({
        playheadMs: 1200,
        inspectorPanel: { clipId: 'clip-overlay-1', tab: 'transform' },
      });
    });

    const { result } = renderHook(() =>
      useVideoEditorSelectionContext({ projectId: 'project-1' }),
    );

    expect(result.current).toMatchObject({
      playheadMs: 1200,
      selectedClipIds: ['clip-overlay-1'],
      activePanel: {
        kind: 'clip-inspector',
        clipId: 'clip-overlay-1',
        tab: 'transform',
      },
    });
  });

  it('omits activePanel when no inspector is mounted', () => {
    act(() => {
      useTimelineEditorStore.setState({
        selectedClipIds: new Set(['clip-a']),
      });
      useTimelineUiStore.setState({ playheadMs: 500, inspectorPanel: null });
    });

    const { result } = renderHook(() =>
      useVideoEditorSelectionContext({ projectId: 'project-1' }),
    );

    expect(result.current?.activePanel).toBeUndefined();
    expect(result.current?.selectedClipIds).toEqual(['clip-a']);
  });
});
