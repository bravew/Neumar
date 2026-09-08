import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ClipTimeWindow } from '@/components/video/timeline/clipWindow';
import type { TimelineTrackLabels } from '@/components/video/timeline/TimelineLabels';
import { TimelineTrack } from '@/components/video/timeline/TimelineTrack';
import { useTimelineEditorStore } from '@/components/video/timeline/useTimelineEditorStore';
import type {
  VideoProject,
  VideoTimeline,
  VideoTimelineTrack,
  VideoVisualTimelineClip,
} from '@/shared/types/video';

const CLIP_COUNT = 1000;
const CLIP_DURATION_MS = 800;
const CLIP_PITCH_MS = 1000;

/**
 * The windowing contract at the component level: with 1,000 clips on one track,
 * the mounted DOM has to track the visible window rather than the timeline.
 *
 * This renders `TimelineTrack` directly rather than the whole `Timeline`,
 * because the row virtualizer measures through `ResizeObserver`, which the test
 * environment stubs out as a no-op — a full `Timeline` render produces no rows
 * at all in jsdom, so it could not observe clip mounting either way.
 */
describe('timeline rendering performance', () => {
  beforeEach(() => {
    useTimelineEditorStore.setState({
      projectId: null,
      timeline: null,
      selectedClipId: null,
      selectedClipIds: new Set<string>(),
      lastSelectedClipId: null,
      selectedMarkerId: null,
      lastEditWarning: null,
      userHistory: [],
      userHistoryIndex: 0,
      revision: 0,
      persistedRevision: 0,
    });
  });

  it('mounts every clip when no window is supplied', () => {
    const { container } = renderTrack({});

    expect(mountedClipIds(container)).toHaveLength(CLIP_COUNT);
  });

  it('mounts only the clips inside the window', () => {
    const { container } = renderTrack({
      clipWindow: { startMs: 100_000, endMs: 110_000 },
    });

    const mounted = mountedClipIds(container);
    expect(mounted).toHaveLength(10);
    expect(mounted[0]).toBe('clip-100');
    expect(mounted.at(-1)).toBe('clip-109');
  });

  it('scales with the window, not with the clip count', () => {
    const narrow = renderTrack({
      clipWindow: { startMs: 0, endMs: 5000 },
    });
    const wide = renderTrack({
      clipWindow: { startMs: 0, endMs: 50_000 },
    });

    expect(mountedClipIds(narrow.container)).toHaveLength(5);
    expect(mountedClipIds(wide.container)).toHaveLength(50);
  });

  it('keeps a pinned clip mounted outside the window', () => {
    const { container } = renderTrack({
      clipWindow: { startMs: 100_000, endMs: 101_000 },
      pinnedClipIds: new Set(['clip-0', 'clip-999']),
    });

    const mounted = mountedClipIds(container);
    expect(mounted).toContain('clip-0');
    expect(mounted).toContain('clip-100');
    expect(mounted).toContain('clip-999');
    // Pinning adds the two clips and nothing else.
    expect(mounted).toHaveLength(3);
  });

  it('keeps link-group partners mounted so a highlight is never half-drawn', () => {
    const { container } = renderTrack({
      clipWindow: { startMs: 0, endMs: 1000 },
      linkGroupId: 'group-a',
      linkedClipIds: ['clip-0', 'clip-500'],
      selectedLinkGroupIds: new Set(['group-a']),
    });

    expect(mountedClipIds(container)).toEqual(['clip-0', 'clip-500']);
  });

  it('mounts a whole track that is the current drop target', () => {
    const { container } = renderTrack({
      clipWindow: { startMs: 0, endMs: 1000 },
      clipMoveDropTarget: {
        trackId: 'track-video-main',
        startMs: 400_000,
        accepted: true,
      },
    });

    // The drop indicator measures against its neighbours, so the target track
    // renders in full for the duration of the drag.
    expect(mountedClipIds(container)).toHaveLength(CLIP_COUNT);
  });
});

function mountedClipIds(container: HTMLElement): string[] {
  return [...container.querySelectorAll('[data-timeline-clip-id]')].map(
    (element) => element.getAttribute('data-timeline-clip-id') ?? '',
  );
}

function renderTrack({
  clipWindow,
  pinnedClipIds,
  selectedLinkGroupIds = new Set<string>(),
  clipMoveDropTarget,
  linkGroupId,
  linkedClipIds = [],
}: {
  clipWindow?: ClipTimeWindow;
  pinnedClipIds?: ReadonlySet<string>;
  selectedLinkGroupIds?: Set<string>;
  clipMoveDropTarget?: {
    trackId: string;
    startMs: number;
    accepted: boolean;
  } | null;
  linkGroupId?: string;
  linkedClipIds?: string[];
}) {
  const timeline = timelineFixture(linkGroupId, linkedClipIds);
  return render(
    <TimelineTrack
      project={projectFixture(timeline)}
      track={timeline.tracks[0]!}
      headerWidth={160}
      timelineWidth={800}
      pixelsPerSecond={10}
      fps={30}
      playheadMs={0}
      selectedTrack={false}
      selectedClipIds={new Set<string>()}
      selectedLinkGroupIds={selectedLinkGroupIds}
      clipWindow={clipWindow}
      pinnedClipIds={pinnedClipIds}
      clipMoveDropTarget={clipMoveDropTarget}
      labels={labels}
      onSelectTrack={vi.fn()}
      onSelectClip={vi.fn()}
      onTrimClip={vi.fn()}
      onMoveClip={vi.fn()}
      onToggleTrackMute={vi.fn()}
      onToggleTrackLock={vi.fn()}
      onToggleTrackSyncLock={vi.fn()}
      onDeleteSelectedClip={vi.fn()}
      onRenameTrack={vi.fn()}
      onMoveTrackLayer={vi.fn()}
    />,
  );
}

function timelineFixture(
  linkGroupId?: string,
  linkedClipIds: string[] = [],
): VideoTimeline {
  const linked = new Set(linkedClipIds);
  // Typed as the video track's own clip union: a bare VideoTimelineClip[] is
  // the widened union, which no single track kind accepts.
  const clips: VideoVisualTimelineClip[] = Array.from(
    { length: CLIP_COUNT },
    (_, index) => {
      const id = `clip-${index}`;
      return {
        id,
        kind: 'video',
        sourceRef: { kind: 'asset', assetId: 'asset-1' },
        startMs: index * CLIP_PITCH_MS,
        durationMs: CLIP_DURATION_MS,
        trimStartMs: 0,
        trimEndMs: CLIP_DURATION_MS,
        sourceDurationMs: CLIP_DURATION_MS,
        ...(linkGroupId && linked.has(id) ? { linkGroupId } : {}),
      } as VideoVisualTimelineClip;
    },
  );
  const track: VideoTimelineTrack = {
    id: 'track-video-main',
    kind: 'video',
    name: 'Video 1',
    muted: false,
    locked: false,
    hidden: false,
    order: 0,
    clips,
  };
  return {
    schema: 'neuma.video.timeline.v1',
    durationMs: CLIP_COUNT * CLIP_PITCH_MS,
    fps: 30,
    tracks: [track],
  };
}

function projectFixture(timeline: VideoTimeline): VideoProject {
  return {
    id: 'project-perf',
    name: 'Timeline performance',
    template: 'custom',
    prompt: '',
    assets: [
      {
        id: 'asset-1',
        kind: 'video',
        source: 'user',
        path: 'videos/project-perf/assets/video.mp4',
        metadata: { durationMs: CLIP_COUNT * CLIP_PITCH_MS },
      },
    ],
    timeline,
    render: { status: 'idle' },
    budget: { capUsd: 5, spentUsd: 0 },
    outputs: [],
    createdAt: '2026-09-08T00:00:00.000Z',
    updatedAt: '2026-09-08T00:00:00.000Z',
  };
}

const labels: TimelineTrackLabels = {
  muted: 'Muted',
  audible: 'Audible',
  locked: 'Locked',
  unlocked: 'Unlocked',
  syncLocked: 'Sync locked',
  syncUnlocked: 'Sync unlocked',
  trimStart: 'Trim start',
  trimEnd: 'Trim end',
  trackEmptyDropHint: 'Drag clips here',
  newTrackDropHint: 'Drop here to add a new track',
  moveLayerUp: 'Move layer up',
  moveLayerDown: 'Move layer down',
  renameTrack: 'Rename track',
  addClip: 'Add clip',
  contextMenu: 'Timeline context menu',
  copyClip: 'Copy clip',
  duplicateClip: 'Duplicate clip',
  cutClip: 'Cut clip',
  splitClip: 'Split clip at playhead',
  deleteClip: 'Delete clip',
  rippleDeleteClip: 'Ripple delete clip',
  muteTrack: 'Mute track',
  unmuteTrack: 'Unmute track',
  lockTrack: 'Lock track',
  unlockTrack: 'Unlock track',
  syncLockTrack: 'Sync-lock track',
  unsyncLockTrack: 'Disable sync lock',
  resizeTrack: 'Resize track',
  showTrack: 'Show track',
  hideTrack: 'Hide track',
  deleteTrack: 'Delete track',
  linkedClip: 'Linked group {group}',
  keyframedClip: 'Keyframed clip',
  captionGroup: 'Caption group {group}',
  audioMutedClip: 'Audio clip muted',
  audioGainClip: 'Audio gain {gain} dB',
  audioFadeClip: 'Audio fade {in} ms in / {out} ms out',
  audioTransitionClip: 'Audio transition {duration} ms',
  audioFadeInHandle: 'Adjust audio fade in',
  audioFadeOutHandle: 'Adjust audio fade out',
  keyboardMoveHint: 'Alt+Left/Right nudges clip; Shift moves farther.',
  keyboardMoveAnnouncement: '{name} starts at {time}.',
  resyncGroup: 'Resync',
  unlinkGroup: 'Unlink',
  aiEditClip: 'AI adjust clip',
  aiGenerateMusic: 'Generate music bed',
  aiSetKeyframes: 'Add fade keyframes',
  syncLockBlocked: 'Sync lock blocked {count} linked clip edits on {tracks}.',
  outOfSyncGroup: 'Group {group} is {drift} ms out of sync.',
  clearWarning: 'Clear warning',
  transitionNames: {
    cut: 'Cut',
    fade: 'Fade',
    slide: 'Slide',
    wipe: 'Wipe',
    iris: 'Iris',
    dissolve: 'Dissolve',
    'soft-wipe': 'Soft wipe',
    pixelize: 'Pixelize',
    'polygon-iris': 'Polygon iris',
    cover: 'Cover',
    reveal: 'Reveal',
    flip: 'Flip',
    'clock-wipe': 'Clock wipe',
    cube: 'Cube',
    'zoom-blur': 'Zoom blur',
    'zoom-in-out': 'Zoom in/out',
  },
  transitionDropHere: 'Drop here',
  transitionBadgeAriaLabel: '{name} transition, {duration} ms',
  transitionDropNoAdjacent: 'Drop on a seam between adjacent clips.',
  transitionDropGap: 'Transitions need touching clips.',
  transitionDropLocked: 'Unlock this track before adding a transition.',
  transitionDropTooShort: 'These clips are too short for a transition.',
  transitionResize: 'Resize transition',
  trackRole: {
    primary: 'Primary',
    broll: 'B-roll',
    overlay: 'Overlay',
    voice: 'Voice',
    music: 'Music',
    sfx: 'SFX',
    captions: 'Captions',
  },
  trackZone: {
    visual: 'Visual stack',
    audio: 'Audio mix',
    caption: 'Caption overlay',
  },
};
