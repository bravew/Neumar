import { beforeEach, describe, expect, it } from 'vitest';

import { buildTimelineClipboardPayload } from '@/components/video/timeline/timelineClipboard';
import { timelineTransitionSeamId } from '@/components/video/timeline/timelineTransitions';
import { useTimelineEditorStore } from '@/components/video/timeline/useTimelineEditorStore';
import type { VideoTimeline } from '@/shared/types/video';

describe('useTimelineEditorStore', () => {
  beforeEach(() => {
    useTimelineEditorStore.setState({
      projectId: null,
      timeline: null,
      selectedClipId: null,
      selectedClipIds: new Set<string>(),
      lastSelectedClipId: null,
      selectedMarkerId: null,
      selectedSeamId: null,
      lastEditWarning: null,
      userHistory: [],
      userHistoryIndex: 0,
      revision: 0,
      persistedRevision: 0,
    });
  });

  it('marks track edits dirty and avoids clobbering unsaved timeline state', () => {
    const timeline = timelineFixture();
    useTimelineEditorStore.getState().setProjectTimeline('project-1', timeline);

    useTimelineEditorStore
      .getState()
      .updateTrack('track-video-main', { muted: true });

    expect(useTimelineEditorStore.getState().timeline?.tracks[0]?.muted).toBe(
      true,
    );
    expect(useTimelineEditorStore.getState().userHistory).toHaveLength(1);
    expect(useTimelineEditorStore.getState().revision).toBe(1);
    expect(useTimelineEditorStore.getState().persistedRevision).toBe(0);

    useTimelineEditorStore.getState().setProjectTimeline('project-1', {
      ...timeline,
      tracks: [{ ...timeline.tracks[0]!, muted: false }],
    });

    expect(useTimelineEditorStore.getState().timeline?.tracks[0]?.muted).toBe(
      true,
    );

    useTimelineEditorStore.getState().markPersisted('project-1', 1);
    useTimelineEditorStore.getState().setProjectTimeline('project-1', {
      ...timeline,
      tracks: [{ ...timeline.tracks[0]!, locked: true }],
    });

    expect(useTimelineEditorStore.getState().timeline?.tracks[0]?.locked).toBe(
      true,
    );
    expect(useTimelineEditorStore.getState().revision).toBe(0);
  });

  it('renames tracks through the timeline history path', () => {
    useTimelineEditorStore
      .getState()
      .setProjectTimeline('project-1', timelineFixture());

    useTimelineEditorStore
      .getState()
      .updateTrack('track-video-main', { name: 'Main camera' });

    const state = useTimelineEditorStore.getState();
    expect(state.timeline?.tracks[0]?.name).toBe('Main camera');
    expect(state.revision).toBe(1);
    expect(state.userHistory).toHaveLength(1);

    useTimelineEditorStore.getState().undoUserEdit();
    expect(useTimelineEditorStore.getState().timeline?.tracks[0]?.name).toBe(
      'Video 1',
    );
  });

  it('adds an empty video layer above existing visual tracks', () => {
    useTimelineEditorStore
      .getState()
      .setProjectTimeline('project-1', multilayerTimelineFixture());

    const trackId = useTimelineEditorStore.getState().addVideoTrack();

    const state = useTimelineEditorStore.getState();
    const tracks = state.timeline?.tracks ?? [];
    expect(tracks.find((track) => track.id === trackId)).toMatchObject({
      kind: 'video',
      name: 'Video 2',
      order: 20,
      muted: false,
      locked: false,
      hidden: false,
      clips: [],
    });
    expect(tracks.find((track) => track.id === 'track-audio')?.order).toBe(20);
    expect(state.selectedClipId).toBeNull();
    expect(state.selectedClipIds.size).toBe(0);
    expect(state.revision).toBe(1);
  });

  it('moves visual clips across unlocked visual layers', () => {
    useTimelineEditorStore
      .getState()
      .setProjectTimeline('project-1', multilayerTimelineFixture());

    useTimelineEditorStore
      .getState()
      .moveClip('clip-1', 250, undefined, 'track-overlay');

    const state = useTimelineEditorStore.getState();
    const sourceTrack = state.timeline?.tracks.find(
      (track) => track.id === 'track-video-main',
    );
    const targetTrack = state.timeline?.tracks.find(
      (track) => track.id === 'track-overlay',
    );
    expect(sourceTrack?.clips).toHaveLength(0);
    expect(targetTrack?.clips[0]?.id).toBe('clip-1');
    expect(targetTrack?.clips[0]?.startMs).toBeCloseTo(266.67);
    expect(state.timeline?.durationMs).toBeCloseTo(1266.67);
    expect(state.revision).toBe(1);
  });

  it('reorders visual layers without changing audio track order', () => {
    useTimelineEditorStore
      .getState()
      .setProjectTimeline('project-1', multilayerTimelineFixture());

    useTimelineEditorStore.getState().moveTrackLayer('track-video-main', 'up');

    const state = useTimelineEditorStore.getState();
    expect(
      state.timeline?.tracks.find((track) => track.id === 'track-video-main')
        ?.order,
    ).toBe(10);
    expect(
      state.timeline?.tracks.find((track) => track.id === 'track-overlay')
        ?.order,
    ).toBe(0);
    expect(
      state.timeline?.tracks.find((track) => track.id === 'track-audio'),
    ).toMatchObject({ order: 20 });
    expect(state.revision).toBe(1);
  });

  it('splits the selected clip at the playhead and selects the right segment', () => {
    useTimelineEditorStore
      .getState()
      .setProjectTimeline('project-1', timelineFixture());
    useTimelineEditorStore.getState().selectClip('clip-1');

    useTimelineEditorStore.getState().splitSelectedClipAtPlayhead(400);

    const state = useTimelineEditorStore.getState();
    const clips = state.timeline?.tracks[0]?.clips ?? [];
    expect(clips).toHaveLength(2);
    expect(clips[0]).toMatchObject({
      startMs: 0,
      durationMs: 400,
      trimStartMs: 0,
      trimEndMs: 400,
    });
    expect(clips[1]).toMatchObject({
      startMs: 400,
      durationMs: 600,
      trimStartMs: 400,
      trimEndMs: 1000,
    });
    expect(state.selectedClipId).toBe(clips[1]!.id);
    expect([...state.selectedClipIds]).toEqual([clips[1]!.id]);
    expect(state.revision).toBe(1);
  });

  it('splits speed-adjusted clips at the playback-mapped source boundary', () => {
    const timeline = timelineFixture();
    const track = timeline.tracks[0]!;
    if (track.kind !== 'video') {
      throw new Error('Expected the fixture to start with a video track.');
    }
    timeline.tracks[0] = {
      ...track,
      clips: [
        {
          ...track.clips[0]!,
          durationMs: 1000,
          trimStartMs: 0,
          trimEndMs: 2000,
          sourceDurationMs: 2000,
          playback: { speed: 2, reverse: false },
        },
      ],
    };
    useTimelineEditorStore.getState().setProjectTimeline('project-1', timeline);
    useTimelineEditorStore.getState().selectClip('clip-1');

    useTimelineEditorStore.getState().splitSelectedClipAtPlayhead(400);

    const clips =
      useTimelineEditorStore.getState().timeline?.tracks[0]?.clips ?? [];
    expect(clips[0]).toMatchObject({
      durationMs: 400,
      trimStartMs: 0,
      trimEndMs: 800,
      playback: { speed: 2, reverse: false },
    });
    expect(clips[1]).toMatchObject({
      startMs: 400,
      durationMs: 600,
      trimStartMs: 800,
      trimEndMs: 2000,
      playback: { speed: 2, reverse: false },
    });
  });

  it('splits reversed clips into forward trim windows that preserve playback order', () => {
    const timeline = timelineFixture();
    const track = timeline.tracks[0]!;
    if (track.kind !== 'video') {
      throw new Error('Expected the fixture to start with a video track.');
    }
    timeline.tracks[0] = {
      ...track,
      clips: [
        {
          ...track.clips[0]!,
          playback: { speed: 1, reverse: true },
        },
      ],
    };
    useTimelineEditorStore.getState().setProjectTimeline('project-1', timeline);
    useTimelineEditorStore.getState().selectClip('clip-1');

    useTimelineEditorStore.getState().splitSelectedClipAtPlayhead(400);

    const clips =
      useTimelineEditorStore.getState().timeline?.tracks[0]?.clips ?? [];
    expect(clips[0]).toMatchObject({
      durationMs: 400,
      trimStartMs: 600,
      trimEndMs: 1000,
      playback: { speed: 1, reverse: true },
    });
    expect(clips[1]).toMatchObject({
      startMs: 400,
      durationMs: 600,
      trimStartMs: 0,
      trimEndMs: 600,
      playback: { speed: 1, reverse: true },
    });
  });

  it('splits still-image clips that have zero-duration source metadata', () => {
    useTimelineEditorStore
      .getState()
      .setProjectTimeline('project-1', imageTimelineFixture());
    useTimelineEditorStore.getState().selectClip('clip-image');

    useTimelineEditorStore.getState().splitSelectedClipAtPlayhead(1000);

    const state = useTimelineEditorStore.getState();
    const clips = state.timeline?.tracks[0]?.clips ?? [];
    expect(clips).toHaveLength(2);
    expect(clips[0]).toMatchObject({
      kind: 'image',
      startMs: 0,
      durationMs: 1000,
      trimStartMs: 0,
      trimEndMs: 1000,
      sourceDurationMs: 3000,
    });
    expect(clips[1]).toMatchObject({
      kind: 'image',
      startMs: 1000,
      durationMs: 2000,
      trimStartMs: 1000,
      trimEndMs: 3000,
      sourceDurationMs: 3000,
    });
    expect(state.selectedClipId).toBe(clips[1]!.id);
    expect([...state.selectedClipIds]).toEqual([clips[1]!.id]);
    expect(state.revision).toBe(1);
  });

  it('range-selects clips on the same track', () => {
    useTimelineEditorStore
      .getState()
      .setProjectTimeline('project-1', timelineFixtureWithThreeClips());

    useTimelineEditorStore.getState().selectClip('clip-1');
    useTimelineEditorStore.getState().selectClip('clip-3', { mode: 'range' });

    const state = useTimelineEditorStore.getState();
    expect([...state.selectedClipIds]).toEqual(['clip-1', 'clip-2', 'clip-3']);
    expect(state.selectedClipId).toBe('clip-3');
  });

  it('toggles individual clips in a multi-selection', () => {
    useTimelineEditorStore
      .getState()
      .setProjectTimeline('project-1', timelineFixtureWithTwoClips());

    useTimelineEditorStore.getState().selectClip('clip-1');
    useTimelineEditorStore.getState().selectClip('clip-2', { mode: 'toggle' });
    useTimelineEditorStore.getState().selectClip('clip-1', { mode: 'toggle' });

    const state = useTimelineEditorStore.getState();
    expect([...state.selectedClipIds]).toEqual(['clip-2']);
    expect(state.selectedClipId).toBe('clip-2');
  });

  it('deletes the selected clip without moving later clips', () => {
    const timeline = timelineFixtureWithTwoClips();
    useTimelineEditorStore.getState().setProjectTimeline('project-1', timeline);
    useTimelineEditorStore.getState().selectClip('clip-1');

    useTimelineEditorStore.getState().deleteSelectedClip();

    const state = useTimelineEditorStore.getState();
    const clips = state.timeline?.tracks[0]?.clips ?? [];
    expect(clips).toHaveLength(1);
    expect(clips[0]).toMatchObject({ id: 'clip-2', startMs: 1000 });
    expect(state.timeline?.durationMs).toBe(1500);
    expect(state.selectedClipId).toBeNull();
    expect(state.selectedClipIds.size).toBe(0);
    expect(state.revision).toBe(1);
  });

  it('ripple deletes the selected clip within its unlocked track', () => {
    const timeline = timelineFixtureWithTwoClips();
    useTimelineEditorStore.getState().setProjectTimeline('project-1', timeline);
    useTimelineEditorStore.getState().selectClip('clip-1');

    useTimelineEditorStore.getState().deleteSelectedClip({ ripple: true });

    const state = useTimelineEditorStore.getState();
    const clips = state.timeline?.tracks[0]?.clips ?? [];
    expect(clips).toHaveLength(1);
    expect(clips[0]).toMatchObject({ id: 'clip-2', startMs: 0 });
    expect(state.timeline?.durationMs).toBe(500);
    expect(state.selectedClipId).toBeNull();
    expect(state.selectedClipIds.size).toBe(0);
    expect(state.revision).toBe(1);
  });

  it('deletes every selected clip without moving later clips', () => {
    useTimelineEditorStore
      .getState()
      .setProjectTimeline('project-1', timelineFixtureWithThreeClips());
    useTimelineEditorStore.getState().selectClips(['clip-1', 'clip-3']);

    useTimelineEditorStore.getState().deleteSelectedClip();

    const state = useTimelineEditorStore.getState();
    const clips = state.timeline?.tracks[0]?.clips ?? [];
    expect(clips).toHaveLength(1);
    expect(clips[0]).toMatchObject({ id: 'clip-2', startMs: 1000 });
    expect(state.selectedClipIds.size).toBe(0);
    expect(state.revision).toBe(1);
  });

  it('duplicates the selected clip and selects the copy', () => {
    useTimelineEditorStore
      .getState()
      .setProjectTimeline('project-1', timelineFixture());
    useTimelineEditorStore.getState().selectClip('clip-1');

    useTimelineEditorStore.getState().duplicateSelectedClips();

    const state = useTimelineEditorStore.getState();
    const clips = state.timeline?.tracks[0]?.clips ?? [];
    const copiedClipId = [...state.selectedClipIds][0];
    expect(clips).toHaveLength(2);
    expect(copiedClipId).toBeTruthy();
    expect(copiedClipId).not.toBe('clip-1');
    expect(findClip(state.timeline!, copiedClipId!)).toMatchObject({
      startMs: 1000,
      durationMs: 1000,
    });
    expect(state.revision).toBe(1);
  });

  it('sets selected clip playback through shared edit builders', () => {
    useTimelineEditorStore
      .getState()
      .setProjectTimeline('project-1', timelineFixture());
    useTimelineEditorStore.getState().selectClip('clip-1');

    useTimelineEditorStore.getState().setSelectedClipSpeed(2);
    useTimelineEditorStore.getState().setSelectedClipReverse(true);

    const clip =
      useTimelineEditorStore.getState().timeline?.tracks[0]?.clips[0];
    expect(clip).toMatchObject({
      durationMs: 500,
      playback: { speed: 2, reverse: true },
    });
    expect(useTimelineEditorStore.getState().revision).toBe(2);
  });

  it('updates selected visual transforms through shared edit builders', () => {
    useTimelineEditorStore
      .getState()
      .setProjectTimeline('project-1', timelineFixture());
    useTimelineEditorStore.getState().selectClip('clip-1');

    useTimelineEditorStore
      .getState()
      .rotateSelectedVisualClips(90, { relative: true });
    useTimelineEditorStore.getState().flipSelectedVisualClips('horizontal');
    useTimelineEditorStore
      .getState()
      .setSelectedVisualClipTransform({ opacity: 0.5 });

    const clip =
      useTimelineEditorStore.getState().timeline?.tracks[0]?.clips[0];
    expect(clip).toMatchObject({
      transforms: { rotation: 90, scaleX: -1, opacity: 0.5 },
    });
    expect(useTimelineEditorStore.getState().revision).toBe(3);
  });

  it('selects all unlocked clips and moves selected clips together', () => {
    useTimelineEditorStore
      .getState()
      .setProjectTimeline('project-1', timelineFixtureWithTwoClips());

    useTimelineEditorStore.getState().selectAllClips();
    useTimelineEditorStore.getState().moveClip('clip-1', 250);

    const state = useTimelineEditorStore.getState();
    const clips = state.timeline?.tracks[0]?.clips ?? [];
    expect([...state.selectedClipIds]).toEqual(['clip-1', 'clip-2']);
    expect(clips[0]?.id).toBe('clip-1');
    expect(clips[0]?.startMs).toBeCloseTo(266.67);
    expect(clips[1]?.id).toBe('clip-2');
    expect(clips[1]?.startMs).toBeCloseTo(1266.67);
    expect(state.revision).toBe(1);
  });

  it('does not delete clips on locked tracks', () => {
    const timeline = timelineFixture();
    timeline.tracks[0] = { ...timeline.tracks[0]!, locked: true };
    useTimelineEditorStore.getState().setProjectTimeline('project-1', timeline);
    useTimelineEditorStore.getState().selectClip('clip-1');

    useTimelineEditorStore.getState().deleteSelectedClip({ ripple: true });

    const state = useTimelineEditorStore.getState();
    expect(state.timeline?.tracks[0]?.clips).toHaveLength(1);
    expect(state.selectedClipId).toBe('clip-1');
    expect([...state.selectedClipIds]).toEqual(['clip-1']);
    expect(state.revision).toBe(0);
  });

  it('trims clip start and end while preserving source bounds', () => {
    useTimelineEditorStore
      .getState()
      .setProjectTimeline('project-1', timelineFixture());

    useTimelineEditorStore.getState().trimClip('clip-1', 'start', 250);
    useTimelineEditorStore.getState().trimClip('clip-1', 'end', -300);

    const state = useTimelineEditorStore.getState();
    const clip = state.timeline?.tracks[0]?.clips[0];
    expect(clip?.startMs).toBeCloseTo(266.67);
    expect(clip?.durationMs).toBeCloseTo(433.33);
    expect(clip?.trimStartMs).toBeCloseTo(266.67);
    expect(clip?.trimEndMs).toBe(700);
    expect(state.timeline?.durationMs).toBe(700);
    expect(state.revision).toBe(2);
  });

  it('trims still-image clips that have zero-duration source metadata', () => {
    useTimelineEditorStore
      .getState()
      .setProjectTimeline('project-1', imageTimelineFixture());

    useTimelineEditorStore.getState().trimClip('clip-image', 'end', -1000);
    useTimelineEditorStore.getState().trimClip('clip-image', 'start', 500);

    const state = useTimelineEditorStore.getState();
    const clip = state.timeline?.tracks[0]?.clips[0];
    expect(clip).toMatchObject({
      kind: 'image',
      startMs: 500,
      durationMs: 1500,
      trimStartMs: 500,
      trimEndMs: 2000,
      sourceDurationMs: 3000,
    });
    expect(state.timeline?.durationMs).toBe(2000);
    expect(state.revision).toBe(2);
  });

  it('extends still-image clip ends from a drag baseline', () => {
    useTimelineEditorStore
      .getState()
      .setProjectTimeline('project-1', imageTimelineFixture());
    const baselineClip =
      useTimelineEditorStore.getState().timeline?.tracks[0]?.clips[0];
    if (!baselineClip) throw new Error('Expected an image clip.');

    useTimelineEditorStore
      .getState()
      .trimClip('clip-image', 'end', 1000, baselineClip);

    const state = useTimelineEditorStore.getState();
    const clip = state.timeline?.tracks[0]?.clips[0];
    expect(clip).toMatchObject({
      kind: 'image',
      startMs: 0,
      durationMs: 4000,
      trimStartMs: 0,
      trimEndMs: 4000,
      sourceDurationMs: 4000,
    });
    expect(state.timeline?.durationMs).toBe(4000);
    expect(state.revision).toBe(1);
  });

  it('does not trim below the minimum clip duration or through locked tracks', () => {
    const timeline = timelineFixture();
    useTimelineEditorStore.getState().setProjectTimeline('project-1', timeline);

    useTimelineEditorStore.getState().trimClip('clip-1', 'end', -10_000);

    const trimmedClip =
      useTimelineEditorStore.getState().timeline?.tracks[0]?.clips[0];
    expect(trimmedClip).toMatchObject({
      durationMs: 100,
      trimEndMs: 100,
    });

    useTimelineEditorStore.getState().setProjectTimeline('project-2', {
      ...timeline,
      tracks: [{ ...timeline.tracks[0]!, locked: true }],
    });
    useTimelineEditorStore.getState().trimClip('clip-1', 'start', 200);

    const lockedClip =
      useTimelineEditorStore.getState().timeline?.tracks[0]?.clips[0];
    expect(lockedClip).toMatchObject({
      startMs: 0,
      durationMs: 1000,
      trimStartMs: 0,
    });
  });

  it('moves clips horizontally and clamps at the timeline start', () => {
    useTimelineEditorStore
      .getState()
      .setProjectTimeline('project-1', timelineFixture());

    useTimelineEditorStore.getState().moveClip('clip-1', 500);
    useTimelineEditorStore.getState().moveClip('clip-1', -10_000);

    const state = useTimelineEditorStore.getState();
    const clip = state.timeline?.tracks[0]?.clips[0];
    expect(clip).toMatchObject({
      startMs: 0,
      durationMs: 1000,
      trimStartMs: 0,
      trimEndMs: 1000,
    });
    expect(state.timeline?.durationMs).toBe(1000);
    expect(state.revision).toBe(2);
  });

  it('moves linked clips together when dragging one partner', () => {
    useTimelineEditorStore
      .getState()
      .setProjectTimeline('project-1', linkedTimelineFixture());

    useTimelineEditorStore.getState().moveClip('clip-video', 250);

    const state = useTimelineEditorStore.getState();
    expect(findClip(state.timeline!, 'clip-video')?.startMs).toBeCloseTo(
      266.67,
    );
    expect(findClip(state.timeline!, 'clip-audio')?.startMs).toBeCloseTo(
      266.67,
    );
    expect(state.revision).toBe(1);
    expect(state.lastEditWarning).toBeNull();
  });

  it('keeps split linked clip segments paired through move and paste', () => {
    useTimelineEditorStore
      .getState()
      .setProjectTimeline('project-1', linkedTimelineFixture());
    useTimelineEditorStore.getState().selectClip('clip-video');

    useTimelineEditorStore.getState().splitSelectedClipAtPlayhead(400);

    let state = useTimelineEditorStore.getState();
    const videoTrack = state.timeline?.tracks.find(
      (track) => track.id === 'track-video-main',
    );
    const audioTrack = state.timeline?.tracks.find(
      (track) => track.id === 'track-audio',
    );
    const [leftClip, rightClip] = videoTrack?.clips ?? [];
    const [leftAudioClip, rightAudioClip] = audioTrack?.clips ?? [];
    expect(leftClip?.linkGroupId).toBeTruthy();
    expect(leftClip?.linkGroupId).toBe(leftAudioClip?.linkGroupId);
    expect(rightClip?.linkGroupId).toBeTruthy();
    expect(rightClip?.linkGroupId).toBe(rightAudioClip?.linkGroupId);
    expect(rightClip?.linkGroupId).not.toBe(leftClip?.linkGroupId);

    useTimelineEditorStore.getState().moveClip(rightClip!.id, 250);

    state = useTimelineEditorStore.getState();
    expect(findClip(state.timeline!, leftClip!.id)).toMatchObject({
      startMs: 0,
      durationMs: 400,
    });
    expect(findClip(state.timeline!, leftAudioClip!.id)).toMatchObject({
      startMs: 0,
      durationMs: 400,
    });
    expect(findClip(state.timeline!, rightClip!.id)?.startMs).toBeCloseTo(
      666.67,
    );
    expect(findClip(state.timeline!, rightClip!.id)?.durationMs).toBe(600);
    expect(findClip(state.timeline!, rightAudioClip!.id)?.startMs).toBeCloseTo(
      666.67,
    );
    expect(findClip(state.timeline!, rightAudioClip!.id)?.durationMs).toBe(600);

    const payload = buildTimelineClipboardPayload(
      state.timeline!,
      state.selectedClipIds,
    );
    if (!payload) throw new Error('Expected clipboard payload.');
    expect(payload.clips).toHaveLength(2);
    expect(payload.clips[0]?.clip.linkGroupId).toBe(rightClip?.linkGroupId);
    expect(payload.clips[1]?.clip.linkGroupId).toBe(rightClip?.linkGroupId);

    const pasted = useTimelineEditorStore
      .getState()
      .pasteClipboardPayload(payload, 2000);

    state = useTimelineEditorStore.getState();
    const insertedClipIds = [...state.selectedClipIds];
    const insertedClip = findClip(state.timeline!, insertedClipIds[0]!);
    const insertedAudioClip = findClip(state.timeline!, insertedClipIds[1]!);
    expect(pasted).toBe(true);
    expect(insertedClip?.startMs).toBe(2000);
    expect(insertedClip?.durationMs).toBe(600);
    expect(insertedAudioClip?.startMs).toBe(2000);
    expect(insertedAudioClip?.durationMs).toBe(600);
    expect(insertedClip?.linkGroupId).toBeTruthy();
    expect(insertedClip?.linkGroupId).toBe(insertedAudioClip?.linkGroupId);
    expect(insertedClip?.linkGroupId).not.toBe(rightClip?.linkGroupId);
  });

  it('trims linked clips together when dragging one partner edge', () => {
    useTimelineEditorStore
      .getState()
      .setProjectTimeline('project-1', linkedTimelineFixture());

    useTimelineEditorStore.getState().trimClip('clip-video', 'start', 200);

    const state = useTimelineEditorStore.getState();
    expect(findClip(state.timeline!, 'clip-video')).toMatchObject({
      startMs: 200,
      durationMs: 800,
      trimStartMs: 200,
    });
    expect(findClip(state.timeline!, 'clip-audio')).toMatchObject({
      startMs: 200,
      durationMs: 800,
      trimStartMs: 200,
    });
  });

  it('blocks linked moves when a partner track is sync locked', () => {
    const timeline = linkedTimelineFixture();
    timeline.tracks[1] = { ...timeline.tracks[1]!, syncLocked: true };
    useTimelineEditorStore.getState().setProjectTimeline('project-1', timeline);

    useTimelineEditorStore.getState().moveClip('clip-video', 250);

    const state = useTimelineEditorStore.getState();
    expect(findClip(state.timeline!, 'clip-video')?.startMs).toBe(0);
    expect(findClip(state.timeline!, 'clip-audio')?.startMs).toBe(0);
    expect(state.revision).toBe(0);
    expect(state.lastEditWarning).toMatchObject({
      kind: 'sync-lock-conflict',
      action: 'move',
      linkGroupId: 'av-1',
      trackIds: ['track-audio'],
    });
  });

  it('resyncs and unlinks out-of-sync linked groups', () => {
    const timeline = linkedTimelineFixture();
    const audioTrack = timeline.tracks[1]!;
    timeline.tracks[1] = {
      ...audioTrack,
      clips: [{ ...audioTrack.clips[0]!, startMs: 180, durationMs: 900 }],
    } as VideoTimeline['tracks'][number];
    useTimelineEditorStore.getState().setProjectTimeline('project-1', timeline);

    useTimelineEditorStore.getState().resyncLinkGroup('av-1');

    let state = useTimelineEditorStore.getState();
    expect(findClip(state.timeline!, 'clip-audio')).toMatchObject({
      startMs: 0,
      durationMs: 1000,
    });

    useTimelineEditorStore.getState().unlinkLinkGroup('av-1');
    state = useTimelineEditorStore.getState();
    expect(
      findClip(state.timeline!, 'clip-video')?.linkGroupId,
    ).toBeUndefined();
    expect(
      findClip(state.timeline!, 'clip-audio')?.linkGroupId,
    ).toBeUndefined();
    expect(state.revision).toBe(2);
  });

  it('undoes and redoes user timeline edits without touching agent journal state', () => {
    useTimelineEditorStore
      .getState()
      .setProjectTimeline('project-1', timelineFixtureWithTwoClips());

    useTimelineEditorStore.getState().selectClip('clip-1');
    useTimelineEditorStore.getState().moveClip('clip-1', 500);

    let state = useTimelineEditorStore.getState();
    expect(state.timeline?.tracks[0]?.clips[0]).toMatchObject({
      id: 'clip-1',
      startMs: 500,
    });
    expect(state.selectedClipId).toBe('clip-1');
    expect(state.userHistory).toHaveLength(1);
    expect(state.userHistoryIndex).toBe(1);

    useTimelineEditorStore.getState().undoUserEdit();

    state = useTimelineEditorStore.getState();
    expect(state.timeline?.tracks[0]?.clips[0]).toMatchObject({
      id: 'clip-1',
      startMs: 0,
    });
    expect(state.selectedClipId).toBe('clip-1');
    expect(state.userHistoryIndex).toBe(0);

    useTimelineEditorStore.getState().redoUserEdit();

    state = useTimelineEditorStore.getState();
    expect(state.timeline?.tracks[0]?.clips[0]).toMatchObject({
      id: 'clip-1',
      startMs: 500,
    });
    expect(state.userHistoryIndex).toBe(1);
    expect(state.revision).toBe(3);
  });

  it('keeps undo history when autosave returns the same timeline', () => {
    useTimelineEditorStore
      .getState()
      .setProjectTimeline('project-1', timelineFixtureWithTwoClips());

    useTimelineEditorStore.getState().selectClip('clip-1');
    useTimelineEditorStore.getState().moveClip('clip-1', 500);
    useTimelineEditorStore.getState().markPersisted('project-1', 1);
    const savedTimeline = structuredClone(
      useTimelineEditorStore.getState().timeline!,
    );

    useTimelineEditorStore
      .getState()
      .setProjectTimeline('project-1', savedTimeline);
    useTimelineEditorStore.getState().undoUserEdit();

    const state = useTimelineEditorStore.getState();
    expect(state.timeline?.tracks[0]?.clips[0]).toMatchObject({
      id: 'clip-1',
      startMs: 0,
    });
    expect(state.userHistory).toHaveLength(1);
    expect(state.userHistoryIndex).toBe(0);
    expect(state.revision).toBe(2);
  });

  it('ignores deep-equal project timeline refreshes from polling', () => {
    const timeline = timelineFixtureWithTwoClips();
    useTimelineEditorStore.getState().setProjectTimeline('project-1', timeline);
    const storedTimeline = useTimelineEditorStore.getState().timeline;

    useTimelineEditorStore
      .getState()
      .setProjectTimeline('project-1', structuredClone(timeline));

    const state = useTimelineEditorStore.getState();
    expect(state.timeline).toBe(storedTimeline);
    expect(state.revision).toBe(0);
    expect(state.userHistory).toHaveLength(0);
  });

  it('keeps undo history when autosave drops undefined optional fields', () => {
    useTimelineEditorStore
      .getState()
      .setProjectTimeline('project-1', timelineFixture());

    useTimelineEditorStore.getState().selectClip('clip-1');
    useTimelineEditorStore
      .getState()
      .updateSelectedVisualClipFilters({ brightness: 1.2 });
    useTimelineEditorStore.getState().resetSelectedVisualClipFilters();
    useTimelineEditorStore.getState().markPersisted('project-1', 2);
    const savedTimeline = JSON.parse(
      JSON.stringify(useTimelineEditorStore.getState().timeline),
    ) as VideoTimeline;

    useTimelineEditorStore
      .getState()
      .setProjectTimeline('project-1', savedTimeline);
    useTimelineEditorStore.getState().undoUserEdit();

    const clip =
      useTimelineEditorStore.getState().timeline?.tracks[0]?.clips[0];
    expect(clip).toMatchObject({ kind: 'video' });
    if (clip?.kind !== 'video') {
      throw new Error('Expected selected clip to remain a video clip.');
    }
    expect(clip.filters).toMatchObject({ brightness: 1.2 });
    expect(useTimelineEditorStore.getState().userHistoryIndex).toBe(1);
  });

  it('truncates redo history after a new edit branches from undo', () => {
    useTimelineEditorStore
      .getState()
      .setProjectTimeline('project-1', timelineFixtureWithTwoClips());

    useTimelineEditorStore.getState().moveClip('clip-1', 250);
    useTimelineEditorStore.getState().moveClip('clip-1', 500);
    useTimelineEditorStore.getState().undoUserEdit();
    useTimelineEditorStore
      .getState()
      .updateTrack('track-video-main', { muted: true });
    useTimelineEditorStore.getState().redoUserEdit();

    const state = useTimelineEditorStore.getState();
    expect(state.timeline?.tracks[0]).toMatchObject({ muted: true });
    expect(state.timeline?.tracks[0]?.clips[0]?.startMs).toBeCloseTo(266.67);
    expect(state.userHistory).toHaveLength(2);
    expect(state.userHistoryIndex).toBe(2);
  });

  it('does not move clips on locked tracks', () => {
    const timeline = timelineFixture();
    timeline.tracks[0] = { ...timeline.tracks[0]!, locked: true };
    useTimelineEditorStore.getState().setProjectTimeline('project-1', timeline);

    useTimelineEditorStore.getState().moveClip('clip-1', 500);

    const state = useTimelineEditorStore.getState();
    expect(state.timeline?.tracks[0]?.clips[0]?.startMs).toBe(0);
    expect(state.revision).toBe(0);
  });

  it('updates selected visual clip transitions and filters', () => {
    useTimelineEditorStore
      .getState()
      .setProjectTimeline('project-1', timelineFixture());
    useTimelineEditorStore.getState().selectClip('clip-1');

    useTimelineEditorStore
      .getState()
      .updateSelectedVisualClipTransition('wipe');
    useTimelineEditorStore.getState().updateSelectedVisualClipFilters({
      brightness: 1.25,
      hueRotateDeg: 30,
    });
    useTimelineEditorStore
      .getState()
      .updateSelectedVisualClipFilters({ brightness: 1 });

    const clip =
      useTimelineEditorStore.getState().timeline?.tracks[0]?.clips[0];
    expect(clip).toMatchObject({
      transitionToNext: 'wipe',
      filters: { hueRotateDeg: 30 },
    });
    expect(useTimelineEditorStore.getState().revision).toBe(3);

    useTimelineEditorStore.getState().resetSelectedVisualClipFilters();
    useTimelineEditorStore.getState().updateSelectedVisualClipTransition('cut');

    const resetClip =
      useTimelineEditorStore.getState().timeline?.tracks[0]?.clips[0];
    expect(resetClip).toMatchObject({ kind: 'video' });
    if (resetClip?.kind !== 'video') {
      throw new Error('Expected selected clip to remain a video clip.');
    }
    expect(resetClip.filters).toBeUndefined();
    expect(resetClip.transitionToNext).toBeUndefined();
    expect(useTimelineEditorStore.getState().revision).toBe(5);
  });

  it('sets and removes transitions on selected seams through history', () => {
    useTimelineEditorStore
      .getState()
      .setProjectTimeline('project-1', timelineFixtureWithTwoClips());
    useTimelineEditorStore.getState().selectClip('clip-2');
    const seamId = timelineTransitionSeamId(
      'track-video-main',
      'clip-1',
      'clip-2',
    );

    useTimelineEditorStore.getState().setTransitionOnSeam(seamId, {
      kind: 'cube',
      durationMs: 5000,
      direction: 'from-left',
    });

    let state = useTimelineEditorStore.getState();
    expect(state.selectedSeamId).toBe(seamId);
    expect(state.selectedClipIds.size).toBe(0);
    expect(firstVisualClip(state.timeline!)).toMatchObject({
      transitionToNext: {
        kind: 'cube',
        durationMs: 250,
        direction: 'from-left',
      },
    });
    expect(state.revision).toBe(1);

    useTimelineEditorStore.getState().undoUserEdit();

    state = useTimelineEditorStore.getState();
    expect(firstVisualClip(state.timeline!)).toMatchObject({
      kind: 'video',
    });
    expect(firstVisualClip(state.timeline!).transitionToNext).toBeUndefined();
    expect(state.selectedClipId).toBe('clip-2');

    useTimelineEditorStore.getState().redoUserEdit();
    expect(useTimelineEditorStore.getState().selectedSeamId).toBe(seamId);

    useTimelineEditorStore.getState().removeTransitionFromSeam(seamId);

    state = useTimelineEditorStore.getState();
    expect(firstVisualClip(state.timeline!).transitionToNext).toBeUndefined();
    expect(state.selectedSeamId).toBe(seamId);
    expect(state.revision).toBe(4);
  });

  it('does not set transitions across gapped seams', () => {
    const timeline = timelineFixtureWithTwoClips();
    const track = timeline.tracks[0]!;
    if (track.kind !== 'video') {
      throw new Error('Expected the fixture to start with a video track.');
    }
    timeline.tracks[0] = {
      ...track,
      clips: [
        track.clips[0]!,
        {
          ...track.clips[1]!,
          startMs: 1200,
        },
      ],
    };
    useTimelineEditorStore.getState().setProjectTimeline('project-1', timeline);

    useTimelineEditorStore
      .getState()
      .setTransitionOnSeam(
        timelineTransitionSeamId('track-video-main', 'clip-1', 'clip-2'),
        { kind: 'fade', durationMs: 500 },
      );

    const state = useTimelineEditorStore.getState();
    expect(firstVisualClip(state.timeline!).transitionToNext).toBeUndefined();
    expect(state.selectedSeamId).toBeNull();
    expect(state.revision).toBe(0);
  });

  it('clamps replacement transitions against the new preset max', () => {
    const timeline = timelineFixtureWithTwoClips();
    const track = timeline.tracks[0]!;
    if (track.kind !== 'video') {
      throw new Error('Expected the fixture to start with a video track.');
    }
    timeline.durationMs = 12_000;
    const clipA = track.clips[0]!;
    const clipB = track.clips[1]!;
    if (clipA.kind === 'effect' || clipB.kind === 'effect') {
      throw new Error('Expected visual clip fixtures.');
    }
    timeline.tracks[0] = {
      ...track,
      clips: [
        {
          ...clipA,
          durationMs: 6000,
          trimEndMs: 6000,
          sourceDurationMs: 6000,
          transitionToNext: { kind: 'cube', durationMs: 1500 },
        },
        {
          ...clipB,
          startMs: 6000,
          durationMs: 6000,
          trimEndMs: 6000,
          sourceDurationMs: 6000,
        },
      ],
    };
    useTimelineEditorStore.getState().setProjectTimeline('project-1', timeline);

    useTimelineEditorStore
      .getState()
      .setTransitionOnSeam(
        timelineTransitionSeamId('track-video-main', 'clip-1', 'clip-2'),
        { kind: 'fade', durationMs: 5000 },
      );

    expect(
      firstVisualClip(useTimelineEditorStore.getState().timeline!),
    ).toMatchObject({
      transitionToNext: { kind: 'fade', durationMs: 3000 },
    });
  });

  it('updates selected visual clip audio seam mode', () => {
    useTimelineEditorStore
      .getState()
      .setProjectTimeline('project-1', timelineFixture());
    useTimelineEditorStore.getState().selectClip('clip-1');

    useTimelineEditorStore.getState().updateSelectedVisualClipAudioSeam('cut');

    const cutClip =
      useTimelineEditorStore.getState().timeline?.tracks[0]?.clips[0];
    expect(cutClip).toMatchObject({ audioSeamToNext: 'cut' });
    expect(useTimelineEditorStore.getState().revision).toBe(1);

    useTimelineEditorStore
      .getState()
      .updateSelectedVisualClipAudioSeam('follow');

    const followClip =
      useTimelineEditorStore.getState().timeline?.tracks[0]?.clips[0];
    expect(followClip).toMatchObject({ kind: 'video' });
    if (followClip?.kind !== 'video') {
      throw new Error('Expected selected clip to remain a video clip.');
    }
    expect(followClip.audioSeamToNext).toBeUndefined();
    expect(useTimelineEditorStore.getState().revision).toBe(2);
  });

  it('routes selected audio clip edits through timeline operations', () => {
    useTimelineEditorStore
      .getState()
      .setProjectTimeline('project-1', linkedTimelineFixture());
    useTimelineEditorStore.getState().selectClip('clip-audio');

    useTimelineEditorStore.getState().setSelectedAudioClipGain(4.5);
    useTimelineEditorStore.getState().setSelectedAudioClipFade('both', 250);
    useTimelineEditorStore.getState().setSelectedAudioClipMute(true);

    const state = useTimelineEditorStore.getState();
    const clip = findClip(state.timeline!, 'clip-audio');
    expect(clip).toMatchObject({
      gainDb: 4.5,
      fadeInMs: 250,
      fadeOutMs: 250,
      fadeInCurve: 'linear',
      fadeOutCurve: 'linear',
      muted: true,
    });
    expect(state.revision).toBe(3);
    expect(state.userHistory).toHaveLength(3);

    useTimelineEditorStore.getState().undoUserEdit();
    expect(
      findClip(useTimelineEditorStore.getState().timeline!, 'clip-audio'),
    ).toMatchObject({
      gainDb: 4.5,
      fadeInMs: 250,
      fadeOutMs: 250,
    });
  });

  it('updates and clamps timeline bookend fades', () => {
    useTimelineEditorStore
      .getState()
      .setProjectTimeline('project-1', timelineFixture());

    useTimelineEditorStore.getState().updateTimelineBookend('intro', 12);
    useTimelineEditorStore.getState().updateTimelineBookend('outro', 5000);

    expect(useTimelineEditorStore.getState().timeline).toMatchObject({
      intro: { kind: 'fade', durationMs: 33 },
      outro: { kind: 'fade', durationMs: 3000 },
    });
    expect(useTimelineEditorStore.getState().revision).toBe(2);

    useTimelineEditorStore.getState().updateTimelineBookend('intro', null);

    expect(useTimelineEditorStore.getState().timeline?.intro).toBeUndefined();
    expect(useTimelineEditorStore.getState().revision).toBe(3);
  });

  it('inserts dropped asset clips into unlocked tracks', () => {
    useTimelineEditorStore
      .getState()
      .setProjectTimeline('project-1', timelineFixture());

    useTimelineEditorStore.getState().insertClip('track-video-main', {
      id: 'clip-linked-asset-1',
      kind: 'image',
      name: 'Dropped image',
      sourceRef: { kind: 'asset', assetId: 'asset-1' },
      startMs: 1200,
      durationMs: 3000,
      trimStartMs: 0,
      trimEndMs: 3000,
      sourceDurationMs: 3000,
    });

    const state = useTimelineEditorStore.getState();
    expect(state.timeline?.tracks[0]?.clips).toHaveLength(2);
    expect(state.timeline?.durationMs).toBe(4200);
    expect(state.selectedClipId).toBe('clip-linked-asset-1');
    expect([...state.selectedClipIds]).toEqual(['clip-linked-asset-1']);
    expect(state.revision).toBe(1);
  });

  it('pastes clipboard payloads at the playhead and selects inserted clips', () => {
    const timeline = timelineFixtureWithTwoClips();
    const payload = buildTimelineClipboardPayload(
      timeline,
      new Set(['clip-2']),
    );
    if (!payload) throw new Error('Expected clipboard payload.');
    useTimelineEditorStore.getState().setProjectTimeline('project-1', timeline);

    const pasted = useTimelineEditorStore
      .getState()
      .pasteClipboardPayload(payload, 3000);

    const state = useTimelineEditorStore.getState();
    const insertedClipId = [...state.selectedClipIds][0];
    expect(pasted).toBe(true);
    expect(insertedClipId).toBeTruthy();
    expect(state.timeline?.tracks[0]?.clips.at(-1)).toMatchObject({
      id: insertedClipId,
      startMs: 3000,
      durationMs: 500,
    });
    expect(state.revision).toBe(1);
  });

  it('adds, updates, and deletes timeline markers', () => {
    useTimelineEditorStore
      .getState()
      .setProjectTimeline('project-1', timelineFixture());

    const markerId = useTimelineEditorStore.getState().addMarker(333.4, 'Beat');

    expect(markerId).toEqual(expect.stringMatching(/^marker-/));
    let state = useTimelineEditorStore.getState();
    expect(state.timeline?.markers?.[0]).toMatchObject({
      id: markerId,
      timeMs: 333,
      label: 'Beat',
      color: 'blue',
    });
    expect(state.selectedMarkerId).toBe(markerId);
    expect(state.revision).toBe(1);

    useTimelineEditorStore.getState().updateMarker(markerId!, {
      timeMs: 1200,
      label: 'Chapter 1',
      isChapter: true,
    });

    state = useTimelineEditorStore.getState();
    expect(state.timeline?.markers?.[0]).toMatchObject({
      timeMs: 1200,
      label: 'Chapter 1',
      isChapter: true,
    });

    useTimelineEditorStore.getState().deleteMarker(markerId!);

    state = useTimelineEditorStore.getState();
    expect(state.timeline?.markers).toBeUndefined();
    expect(state.selectedMarkerId).toBeNull();
    expect(state.revision).toBe(3);
  });

  it('removes clips that source a deleted asset and recomputes duration', () => {
    const timeline = timelineFixtureWithAssetClip();
    useTimelineEditorStore.getState().setProjectTimeline('project-1', timeline);
    useTimelineEditorStore.getState().selectClip('clip-asset');

    useTimelineEditorStore.getState().removeClipsForAssets(['asset-1']);

    const state = useTimelineEditorStore.getState();
    const clips = state.timeline?.tracks[0]?.clips ?? [];
    expect(clips.map((clip) => clip.id)).toEqual(['clip-1']);
    // Duration collapses to the surviving scene clip's end.
    expect(state.timeline?.durationMs).toBe(1000);
    // The deleted clip drops out of the selection, and the edit is undoable.
    expect(state.selectedClipIds.has('clip-asset')).toBe(false);
    expect(state.revision).toBe(1);
    expect(state.persistedRevision).toBe(0);
  });

  it('leaves the timeline untouched when no clip sources the asset', () => {
    const timeline = timelineFixtureWithAssetClip();
    useTimelineEditorStore.getState().setProjectTimeline('project-1', timeline);

    useTimelineEditorStore.getState().removeClipsForAssets(['asset-missing']);

    const state = useTimelineEditorStore.getState();
    expect(state.timeline?.tracks[0]?.clips).toHaveLength(2);
    expect(state.revision).toBe(0);
  });
});

function timelineFixtureWithAssetClip(): VideoTimeline {
  const timeline = timelineFixture();
  const videoTrack = timeline.tracks[0]!;
  if (videoTrack.kind !== 'video') {
    throw new Error('Expected the fixture to start with a video track.');
  }
  const firstClip = videoTrack.clips[0]!;
  timeline.durationMs = 2000;
  timeline.tracks[0] = {
    ...videoTrack,
    clips: [
      ...videoTrack.clips,
      {
        ...firstClip,
        id: 'clip-asset',
        sourceRef: { kind: 'asset', assetId: 'asset-1' },
        sceneId: 'scene-asset',
        startMs: 1000,
        durationMs: 1000,
        trimStartMs: 0,
        trimEndMs: 1000,
        sourceDurationMs: 1000,
      },
    ],
  };
  return timeline;
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

function timelineFixtureWithTwoClips(): VideoTimeline {
  const timeline = timelineFixture();
  const videoTrack = timeline.tracks[0]!;
  if (videoTrack.kind !== 'video') {
    throw new Error('Expected the fixture to start with a video track.');
  }
  const firstClip = videoTrack.clips[0]!;
  timeline.durationMs = 1500;
  timeline.tracks[0] = {
    ...videoTrack,
    clips: [
      ...videoTrack.clips,
      {
        ...firstClip,
        id: 'clip-2',
        sceneId: 'scene-2',
        startMs: 1000,
        durationMs: 500,
        trimStartMs: 0,
        trimEndMs: 500,
        sourceDurationMs: 500,
      },
    ],
  };
  return timeline;
}

function timelineFixtureWithThreeClips(): VideoTimeline {
  const timeline = timelineFixtureWithTwoClips();
  const videoTrack = timeline.tracks[0]!;
  if (videoTrack.kind !== 'video') {
    throw new Error('Expected the fixture to start with a video track.');
  }
  const firstClip = videoTrack.clips[0]!;
  timeline.durationMs = 2400;
  timeline.tracks[0] = {
    ...videoTrack,
    clips: [
      ...videoTrack.clips,
      {
        ...firstClip,
        id: 'clip-3',
        sceneId: 'scene-3',
        startMs: 1800,
        durationMs: 600,
        trimStartMs: 0,
        trimEndMs: 600,
        sourceDurationMs: 600,
      },
    ],
  };
  return timeline;
}

function linkedTimelineFixture(): VideoTimeline {
  const timeline = timelineFixture();
  const videoTrack = timeline.tracks[0]!;
  if (videoTrack.kind !== 'video') {
    throw new Error('Expected the fixture to start with a video track.');
  }
  const videoClip = videoTrack.clips[0]!;
  return {
    ...timeline,
    tracks: [
      {
        ...videoTrack,
        clips: [
          {
            ...videoClip,
            id: 'clip-video',
            linkGroupId: 'av-1',
          },
        ],
      },
      {
        id: 'track-audio',
        kind: 'audio-music',
        name: 'Music',
        muted: false,
        locked: false,
        order: 0,
        clips: [
          {
            id: 'clip-audio',
            kind: 'audio',
            name: 'Camera audio',
            sourceRef: { kind: 'scene', sceneId: 'scene-1' },
            sceneId: 'scene-1',
            linkGroupId: 'av-1',
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

function findClip(timeline: VideoTimeline, clipId: string) {
  for (const track of timeline.tracks) {
    const clip = track.clips.find((candidate) => candidate.id === clipId);
    if (clip) return clip;
  }
  return null;
}

function firstVisualClip(timeline: VideoTimeline) {
  const clip = timeline.tracks[0]?.clips[0];
  if (
    !clip ||
    (clip.kind !== 'video' && clip.kind !== 'image' && clip.kind !== 'overlay')
  ) {
    throw new Error('Expected the first fixture clip to be visual.');
  }
  return clip;
}

function imageTimelineFixture(): VideoTimeline {
  const timeline = timelineFixture();
  const videoTrack = timeline.tracks[0];
  if (!videoTrack || videoTrack.kind !== 'video') {
    throw new Error('Expected the fixture to start with a video track.');
  }
  timeline.durationMs = 3000;
  timeline.tracks[0] = {
    ...videoTrack,
    clips: [
      {
        id: 'clip-image',
        kind: 'image',
        name: 'Still',
        sourceRef: { kind: 'asset', assetId: 'asset-image' },
        startMs: 0,
        durationMs: 3000,
        trimStartMs: 0,
        trimEndMs: 0,
        sourceDurationMs: 0,
      },
    ],
  };
  return timeline;
}

function multilayerTimelineFixture(): VideoTimeline {
  const timeline = timelineFixture();
  timeline.tracks = [
    timeline.tracks[0]!,
    {
      id: 'track-overlay',
      kind: 'overlay',
      name: 'Overlay',
      muted: false,
      locked: false,
      hidden: false,
      order: 10,
      clips: [],
    },
    {
      id: 'track-audio',
      kind: 'audio-music',
      name: 'Music',
      muted: false,
      locked: false,
      order: 20,
      clips: [],
    },
  ];
  return timeline;
}
