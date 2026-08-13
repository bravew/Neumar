import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';

import {
  clampTimelineZoom,
  getVisibleTimeRange,
  pixelsToMs,
  TIMELINE_ZOOM,
  zoomToFitTimeline,
  type VisibleTimeRange,
} from './timelineMath';

export type TimelinePlaybackState = 'stopped' | 'playing' | 'paused';
export type TimelinePlayheadUpdateSource = 'external' | 'preview';

/** Which inspector panel is mounted — forwarded to the agent as UI context. */
export interface TimelineInspectorPanel {
  clipId: string;
  tab?: string;
}

interface SetPlayheadOptions {
  source?: TimelinePlayheadUpdateSource;
}

interface TimelineUiState {
  hoverMs: number | null;
  playheadMs: number;
  playheadUpdateSource: TimelinePlayheadUpdateSource;
  playbackState: TimelinePlaybackState;
  pixelsPerSecond: number;
  scrollX: number;
  viewportWidth: number;
  snappingEnabled: boolean;
  snapTolerancePx: number;
  razorToolEnabled: boolean;
  selectedTrackId: string | null;
  expandedTracks: Set<string>;
  trackHeights: Record<string, number>;
  inspectorPanel: TimelineInspectorPanel | null;
  setInspectorPanel: (panel: TimelineInspectorPanel | null) => void;
  setTrackHeight: (trackId: string, height: number) => void;
  resetTrackHeight: (trackId: string) => void;
  setHoverMs: (hoverMs: number | null) => void;
  setViewportWidth: (width: number) => void;
  setScrollX: (scrollX: number) => void;
  setPlayheadMs: (playheadMs: number, options?: SetPlayheadOptions) => void;
  setPlaybackState: (playbackState: TimelinePlaybackState) => void;
  seekToPixel: (pixel: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomToFit: (durationMs: number) => void;
  resetZoom: () => void;
  togglePlayback: () => void;
  stop: () => void;
  selectTrack: (trackId: string | null) => void;
  toggleSnapping: () => void;
  toggleRazorTool: () => void;
  setRazorToolEnabled: (enabled: boolean) => void;
  setTrackExpanded: (trackId: string, expanded: boolean) => void;
  isTrackExpanded: (trackId: string) => boolean;
  pixelsToMs: (pixel: number) => number;
  getVisibleTimeRange: () => VisibleTimeRange;
}

export const useTimelineUiStore = create<TimelineUiState>((set, get) => ({
  hoverMs: null,
  playheadMs: 0,
  playheadUpdateSource: 'external',
  playbackState: 'stopped',
  pixelsPerSecond: TIMELINE_ZOOM.DEFAULT,
  scrollX: 0,
  viewportWidth: 800,
  snappingEnabled: readStoredBoolean('neuma.timeline.snapping', true),
  snapTolerancePx: 6,
  razorToolEnabled: false,
  selectedTrackId: null,
  expandedTracks: new Set<string>(),
  trackHeights: readStoredTrackHeights(),
  inspectorPanel: null,
  setInspectorPanel: (panel) =>
    set((state) => {
      if (
        state.inspectorPanel?.clipId === panel?.clipId &&
        state.inspectorPanel?.tab === panel?.tab
      ) {
        return state;
      }
      return { inspectorPanel: panel };
    }),
  setTrackHeight: (trackId, height) =>
    set((state) => {
      const clamped = Math.max(28, Math.min(400, Math.round(height)));
      if (state.trackHeights[trackId] === clamped) return state;
      const trackHeights = { ...state.trackHeights, [trackId]: clamped };
      writeStoredTrackHeights(trackHeights);
      return { trackHeights };
    }),
  resetTrackHeight: (trackId) =>
    set((state) => {
      if (state.trackHeights[trackId] === undefined) return state;
      const { [trackId]: _omit, ...rest } = state.trackHeights;
      writeStoredTrackHeights(rest);
      return { trackHeights: rest };
    }),
  setHoverMs: (hoverMs) =>
    set((state) => {
      const nextHoverMs =
        hoverMs === null ? null : Math.max(0, Math.round(hoverMs));
      if (state.hoverMs === nextHoverMs) return state;
      return { hoverMs: nextHoverMs };
    }),
  setViewportWidth: (width) =>
    set({ viewportWidth: Math.max(1, Math.round(width)) }),
  setScrollX: (scrollX) => set({ scrollX: Math.max(0, scrollX) }),
  setPlayheadMs: (playheadMs, options) =>
    set({
      playheadMs: Math.max(0, Math.round(playheadMs)),
      playheadUpdateSource: options?.source ?? 'external',
    }),
  setPlaybackState: (playbackState) => set({ playbackState }),
  seekToPixel: (pixel) => {
    const { pixelsPerSecond } = get();
    set({
      playheadMs: pixelsToMs(pixel, pixelsPerSecond),
      playheadUpdateSource: 'external',
    });
  },
  zoomIn: () =>
    set((state) => ({
      pixelsPerSecond: clampTimelineZoom(state.pixelsPerSecond * 1.5),
    })),
  zoomOut: () =>
    set((state) => ({
      pixelsPerSecond: clampTimelineZoom(state.pixelsPerSecond / 1.5),
    })),
  zoomToFit: (durationMs) =>
    set((state) => ({
      pixelsPerSecond: zoomToFitTimeline(durationMs, state.viewportWidth),
      scrollX: 0,
    })),
  resetZoom: () =>
    set({
      pixelsPerSecond: TIMELINE_ZOOM.DEFAULT,
      scrollX: 0,
    }),
  togglePlayback: () =>
    set((state) => ({
      playbackState: state.playbackState === 'playing' ? 'paused' : 'playing',
    })),
  stop: () =>
    set({
      playbackState: 'stopped',
      playheadMs: 0,
      playheadUpdateSource: 'external',
    }),
  selectTrack: (trackId) => set({ selectedTrackId: trackId }),
  toggleSnapping: () =>
    set((state) => {
      const snappingEnabled = !state.snappingEnabled;
      writeStoredBoolean('neuma.timeline.snapping', snappingEnabled);
      return { snappingEnabled };
    }),
  toggleRazorTool: () =>
    set((state) => ({ razorToolEnabled: !state.razorToolEnabled })),
  setRazorToolEnabled: (enabled) => set({ razorToolEnabled: enabled }),
  setTrackExpanded: (trackId, expanded) =>
    set((state) => {
      const expandedTracks = new Set(state.expandedTracks);
      if (expanded) {
        expandedTracks.add(trackId);
      } else {
        expandedTracks.delete(trackId);
      }
      return { expandedTracks };
    }),
  isTrackExpanded: (trackId) => get().expandedTracks.has(trackId),
  pixelsToMs: (pixel) => pixelsToMs(pixel, get().pixelsPerSecond),
  getVisibleTimeRange: () => {
    const { scrollX, viewportWidth, pixelsPerSecond } = get();
    return getVisibleTimeRange({ scrollX, viewportWidth, pixelsPerSecond });
  },
}));

export function useTimelineUiBindings() {
  return useTimelineUiStore(
    useShallow((state) => ({
      playheadMs: state.playheadMs,
      playbackState: state.playbackState,
      pixelsPerSecond: state.pixelsPerSecond,
      viewportWidth: state.viewportWidth,
      snappingEnabled: state.snappingEnabled,
      snapTolerancePx: state.snapTolerancePx,
      selectedTrackId: state.selectedTrackId,
      setViewportWidth: state.setViewportWidth,
      setScrollX: state.setScrollX,
      setPlayheadMs: state.setPlayheadMs,
      zoomIn: state.zoomIn,
      zoomOut: state.zoomOut,
      zoomToFit: state.zoomToFit,
      resetZoom: state.resetZoom,
      togglePlayback: state.togglePlayback,
      toggleSnapping: state.toggleSnapping,
      setRazorToolEnabled: state.setRazorToolEnabled,
      selectTrack: state.selectTrack,
    })),
  );
}

function readStoredBoolean(key: string, fallback: boolean): boolean {
  if (typeof window === 'undefined') return fallback;
  try {
    const value = window.localStorage.getItem(key);
    if (value == null) return fallback;
    return value === 'true';
  } catch {
    return fallback;
  }
}

const TRACK_HEIGHTS_KEY = 'neuma.timeline.trackHeights';

function readStoredTrackHeights(): Record<string, number> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(TRACK_HEIGHTS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const result: Record<string, number> = {};
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === 'number' && Number.isFinite(value)) {
          result[key] = value;
        }
      }
      return result;
    }
    return {};
  } catch {
    return {};
  }
}

function writeStoredTrackHeights(heights: Record<string, number>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(TRACK_HEIGHTS_KEY, JSON.stringify(heights));
  } catch {
    // Best effort only.
  }
}

function writeStoredBoolean(key: string, value: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // Best effort only; timeline preferences can remain in memory.
  }
}
