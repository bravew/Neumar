import { createEvent, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TimelineTrackLabels } from '@/components/video/timeline/TimelineLabels';
import { TimelineTrack } from '@/components/video/timeline/TimelineTrack';
import { useTimelineEditorStore } from '@/components/video/timeline/useTimelineEditorStore';
import { ASSET_DRAG_MIME, type AssetDragPayload } from '@/shared/assets';
import type {
  VideoProject,
  VideoTimeline,
  VideoTimelineClip,
  VideoTimelineTrack,
} from '@/shared/types/video';

describe('TimelineTrack context menu', () => {
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

  it('selects a right-clicked clip before dispatching clip actions', async () => {
    const user = userEvent.setup();
    const timeline = timelineFixture();
    useTimelineEditorStore.getState().setProjectTimeline('project-1', timeline);
    const onSelectClip = vi.fn((clip: VideoTimelineClip) =>
      useTimelineEditorStore.getState().selectClip(clip.id),
    );
    const onDeleteSelectedClip = vi.fn();
    const { container } = renderTrack({
      timeline,
      onSelectClip,
      onDeleteSelectedClip,
    });
    const clip = container.querySelector('[data-timeline-clip-id="clip-1"]');
    expect(clip).toBeInstanceOf(HTMLElement);

    fireEvent.contextMenu(clip!, { clientX: 120, clientY: 80 });
    await user.click(await screen.findByText(labels.deleteClip));

    expect(onSelectClip).toHaveBeenCalledWith(timeline.tracks[0]!.clips[0]!);
    expect(onDeleteSelectedClip).toHaveBeenCalledOnce();
  });

  it('dispatches track menu actions from empty track space', async () => {
    const user = userEvent.setup();
    const timeline = timelineFixture();
    const onSelectTrack = vi.fn();
    const onToggleTrackMute = vi.fn();
    const onMoveTrackLayer = vi.fn();
    const { container } = renderTrack({
      timeline,
      onSelectTrack,
      onToggleTrackMute,
      onMoveTrackLayer,
    });
    const trackLane = container.querySelector(
      '[data-timeline-track-id="track-video-main"]',
    );
    expect(trackLane).toBeInstanceOf(HTMLElement);

    fireEvent.contextMenu(trackLane!, { clientX: 160, clientY: 90 });
    await user.click(await screen.findByText(labels.muteTrack));

    expect(onSelectTrack).toHaveBeenCalledWith('track-video-main');
    expect(onToggleTrackMute).toHaveBeenCalledWith(timeline.tracks[0]);

    fireEvent.contextMenu(trackLane!, { clientX: 180, clientY: 90 });
    await user.click(await screen.findByText(labels.moveLayerUp));

    expect(onMoveTrackLayer).toHaveBeenCalledWith('track-video-main', 'up');
  });

  it('routes clip AI keyframe actions through the agent tool callback', async () => {
    const user = userEvent.setup();
    const timeline = timelineFixture();
    useTimelineEditorStore.getState().setProjectTimeline('project-1', timeline);
    const onApplyAgentTool = vi.fn();
    const { container } = renderTrack({ timeline, onApplyAgentTool });
    const clip = container.querySelector('[data-timeline-clip-id="clip-1"]');
    expect(clip).toBeInstanceOf(HTMLElement);

    fireEvent.contextMenu(clip!, { clientX: 120, clientY: 80 });
    await user.click(await screen.findByText(labels.aiSetKeyframes));

    expect(onApplyAgentTool).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'setKeyframes',
        args: expect.objectContaining({ clipId: 'clip-1' }),
      }),
    );
  });

  it('renames the track from the timeline header', async () => {
    const user = userEvent.setup();
    const timeline = timelineFixture();
    const onRenameTrack = vi.fn();
    renderTrack({ timeline, onRenameTrack });

    const nameInput = screen.getByRole('textbox', {
      name: labels.renameTrack,
    });
    await user.clear(nameInput);
    await user.type(nameInput, 'Main camera');
    await user.tab();

    expect(onRenameTrack).toHaveBeenCalledWith(
      'track-video-main',
      'Main camera',
    );
  });

  it('cancels track rename on escape', async () => {
    const user = userEvent.setup();
    const timeline = timelineFixture();
    const onRenameTrack = vi.fn();
    renderTrack({ timeline, onRenameTrack });

    const nameInput = screen.getByRole('textbox', {
      name: labels.renameTrack,
    });
    await user.clear(nameInput);
    await user.type(nameInput, 'Main camera');
    await user.keyboard('{Escape}');

    expect(onRenameTrack).not.toHaveBeenCalled();
    expect(nameInput).toHaveValue('Video 1');
  });

  it('dispatches catalog asset drops from a timeline lane', () => {
    const timeline = timelineFixture();
    const onDropCatalogAssets = vi.fn();
    const { container } = renderTrack({ timeline, onDropCatalogAssets });
    const trackLane = container.querySelector(
      '[data-timeline-track-id="track-video-main"]',
    );
    expect(trackLane).toBeInstanceOf(HTMLElement);
    const dataTransfer = createDataTransfer({
      [ASSET_DRAG_MIME]: JSON.stringify({
        assetIds: ['asset-1', 'asset-2'],
        primaryKind: 'image',
        source: 'library',
      }),
    });

    fireEvent.dragOver(trackLane!, { dataTransfer });
    const dropEvent = createEvent.drop(trackLane!, { dataTransfer });
    Object.defineProperty(dropEvent, 'clientX', { value: 260 });
    fireEvent(trackLane!, dropEvent);

    expect(onDropCatalogAssets).toHaveBeenCalledWith(
      timeline.tracks[0],
      26_000,
      {
        assetIds: ['asset-1', 'asset-2'],
        primaryKind: 'image',
        source: 'library',
      },
    );
  });
});

function renderTrack({
  timeline,
  onSelectClip = vi.fn(),
  onSelectTrack = vi.fn(),
  onToggleTrackMute = vi.fn(),
  onRenameTrack = vi.fn(),
  onMoveTrackLayer = vi.fn(),
  onDeleteSelectedClip = vi.fn(),
  onToggleTrackSyncLock = vi.fn(),
  onApplyAgentTool,
  onDropCatalogAssets,
}: {
  timeline: VideoTimeline;
  onSelectClip?: (clip: VideoTimelineClip) => void;
  onSelectTrack?: (trackId: string) => void;
  onToggleTrackMute?: (track: VideoTimelineTrack) => void;
  onRenameTrack?: (trackId: string, name: string) => void;
  onMoveTrackLayer?: (trackId: string, direction: 'up' | 'down') => void;
  onDeleteSelectedClip?: (options?: { ripple?: boolean }) => void;
  onToggleTrackSyncLock?: (track: VideoTimelineTrack) => void;
  onApplyAgentTool?: (input: {
    name: string;
    args: Record<string, unknown>;
    reasoning?: string;
  }) => void;
  onDropCatalogAssets?: (
    track: VideoTimelineTrack,
    startMs: number,
    payload: AssetDragPayload,
  ) => void;
}) {
  return render(
    <TimelineTrack
      project={projectFixture(timeline)}
      track={timeline.tracks[0]!}
      headerWidth={160}
      timelineWidth={800}
      pixelsPerSecond={10}
      fps={30}
      playheadMs={500}
      selectedTrack={false}
      selectedClipIds={useTimelineEditorStore.getState().selectedClipIds}
      selectedLinkGroupIds={new Set<string>()}
      labels={labels}
      onSelectTrack={onSelectTrack}
      onSelectClip={onSelectClip}
      onTrimClip={vi.fn()}
      onMoveClip={vi.fn()}
      onToggleTrackMute={onToggleTrackMute}
      onToggleTrackLock={vi.fn()}
      onToggleTrackSyncLock={onToggleTrackSyncLock}
      onDeleteSelectedClip={onDeleteSelectedClip}
      onRenameTrack={onRenameTrack}
      onMoveTrackLayer={onMoveTrackLayer}
      onDropCatalogAssets={onDropCatalogAssets}
      onApplyAgentTool={onApplyAgentTool}
    />,
  );
}

function createDataTransfer(initial: Record<string, string>): DataTransfer {
  return {
    dropEffect: 'none',
    effectAllowed: 'copy',
    files: [],
    getData: vi.fn((type: string) => initial[type] ?? ''),
    types: Object.keys(initial),
  } as unknown as DataTransfer;
}

function projectFixture(timeline: VideoTimeline): VideoProject {
  return {
    id: 'project-1',
    name: 'Project',
    template: 'custom',
    prompt: 'Prompt',
    assets: [],
    timeline,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function timelineFixture(): VideoTimeline {
  return {
    schema: 'neuma.video.timeline.v1',
    durationMs: 1000,
    fps: 30,
    tracks: [
      {
        id: 'track-video-main',
        kind: 'video',
        name: 'Video 1',
        muted: false,
        locked: false,
        hidden: false,
        order: 0,
        clips: [
          {
            id: 'clip-1',
            kind: 'video',
            name: 'Scene 1',
            sourceRef: { kind: 'scene', sceneId: 'scene-1' },
            sceneId: 'scene-1',
            startMs: 0,
            durationMs: 1000,
            trimStartMs: 0,
            trimEndMs: 1000,
            sourceDurationMs: 1000,
          },
        ],
      },
    ],
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
