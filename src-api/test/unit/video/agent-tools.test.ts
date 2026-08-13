import { describe, expect, it } from 'vitest';

import {
  applyProjectDiff,
  applyVideoAgentTool,
  redoVideoAgentJournalEntry,
  undoVideoAgentJournalEntry,
} from '@/shared/video/agent-tools';
import type { VideoProject } from '@/shared/video/types';

describe('video agent tools', () => {
  it('applies a caption patch, appends a journal entry, and undoes cleanly', () => {
    const project = projectFixture();
    const execution = applyVideoAgentTool(
      project,
      {
        name: 'setCaption',
        args: { sceneId: 'scene-2', text: 'Launch today' },
        reasoning: 'The user asked for a stronger CTA.',
      },
      { now: '2026-05-20T01:00:00.000Z', journalId: 'journal-1' },
    );

    expect(execution.project.storyboard?.scenes[1].caption?.text).toBe(
      'Launch today',
    );
    expect(execution.project.renderPlan).toBeUndefined();
    expect(execution.entry).toMatchObject({
      id: 'journal-1',
      tool: 'setCaption',
      reasoning: 'The user asked for a stronger CTA.',
      diff: [
        {
          op: 'replace',
          path: '/storyboard/scenes/1/caption',
          value: { text: 'Launch today', style: undefined },
        },
        { op: 'replace', path: '/storyboard/status', value: 'edited' },
        { op: 'remove', path: '/renderPlan' },
      ],
    });
    expect(execution.entry.inverseDiff).toEqual([
      {
        op: 'add',
        path: '/renderPlan',
        value: project.renderPlan,
      },
      { op: 'replace', path: '/storyboard/status', value: 'draft' },
      {
        op: 'replace',
        path: '/storyboard/scenes/1/caption',
        value: { text: 'Built for teams' },
      },
    ]);

    const undone = undoVideoAgentJournalEntry(
      execution.project,
      'journal-1',
      '2026-05-20T01:01:00.000Z',
    );
    expect(undone.project.storyboard).toEqual(project.storyboard);
    expect(undone.project.renderPlan).toEqual(project.renderPlan);
    expect(undone.project.agentJournal?.[0].undone).toBe(true);

    const redone = redoVideoAgentJournalEntry(
      undone.project,
      'journal-1',
      '2026-05-20T01:02:00.000Z',
    );
    expect(redone.project.storyboard?.scenes[1].caption?.text).toBe(
      'Launch today',
    );
    expect(redone.project.agentJournal?.[0].undone).toBe(false);
  });

  it.each([
    {
      name: 'addScene' as const,
      args: {
        afterSceneId: 'scene-1',
        intent: 'Show the dashboard',
        durationMs: 2000,
      },
      options: { sceneId: 'scene-added' },
    },
    {
      name: 'splitScene' as const,
      args: { sceneId: 'scene-2', atMs: 1500 },
      options: { sceneId: 'scene-split' },
    },
    {
      name: 'removeScene' as const,
      args: { sceneId: 'scene-2' },
    },
    {
      name: 'reorderScenes' as const,
      args: { order: ['scene-2', 'scene-1'] },
    },
    {
      name: 'setDuration' as const,
      args: { sceneId: 'scene-1', durationMs: 5000 },
    },
    {
      name: 'setTransition' as const,
      args: { sceneId: 'scene-1', transition: 'fade' as const },
    },
    {
      name: 'setTransition' as const,
      args: {
        sceneId: 'scene-1',
        transition: {
          kind: 'cube' as const,
          direction: 'from-right' as const,
          durationMs: 700,
        },
      },
    },
    {
      name: 'listTransitionKinds' as const,
      args: {},
    },
    {
      name: 'setTimelineBookend' as const,
      args: {
        position: 'intro' as const,
        kind: 'fade' as const,
        durationMs: 500,
      },
    },
    {
      name: 'regenerateScene' as const,
      args: { sceneId: 'scene-2', prompt: 'Wide studio product shot' },
    },
    {
      name: 'generateVoiceover' as const,
      args: { sceneId: 'scene-1', text: 'Meet the new product' },
      options: { sceneId: 'narration-1' },
    },
    {
      name: 'generateMusic' as const,
      args: { mood: 'optimistic synth', durationMs: 7000, tempoBpm: 96 },
    },
    {
      name: 'addCaptions' as const,
      args: {
        style: { position: 'bottom' as const, animation: 'classic' as const },
      },
    },
  ])('$name diff round-trips through inverse patch', (tool) => {
    const project = projectFixture();
    const execution = applyVideoAgentTool(
      project,
      { ...tool, reasoning: 'test' },
      {
        now: '2026-05-20T02:00:00.000Z',
        journalId: `${tool.name}-journal`,
        ...tool.options,
      },
    );

    const restored = applyProjectDiff(
      execution.project,
      execution.entry.inverseDiff ?? [],
    );
    expect(restored.storyboard).toEqual(project.storyboard);
    expect(restored.renderPlan).toEqual(project.renderPlan);
  });

  it('does not synthesize captions for add-scene without caption text', () => {
    const execution = applyVideoAgentTool(
      projectFixture(),
      {
        name: 'addScene',
        args: {
          afterSceneId: 'scene-1',
          intent: 'Show the dashboard',
          durationMs: 2000,
        },
        reasoning: 'test',
      },
      {
        now: '2026-05-20T02:00:00.000Z',
        journalId: 'add-scene-no-caption',
        sceneId: 'scene-added',
      },
    );

    const added = execution.project.storyboard?.scenes.find(
      (scene) => scene.id === 'scene-added',
    );
    expect(added?.caption).toBeUndefined();
  });

  it('returns the transition registry to agent tools', () => {
    const execution = applyVideoAgentTool(
      projectFixture(),
      { name: 'listTransitionKinds', args: {}, reasoning: 'test' },
      { now: '2026-05-20T02:00:00.000Z', journalId: 'transition-list' },
    );

    expect(execution.entry.diff).toEqual([]);
    expect(execution.entry.result).toMatchObject({
      transitions: expect.arrayContaining([
        expect.objectContaining({ kind: 'cube', native: ['remotion'] }),
      ]),
    });
  });

  it('rejects scene removal when it would leave the storyboard empty', () => {
    const base = projectFixture();
    const project: VideoProject = {
      ...base,
      storyboard: {
        ...base.storyboard!,
        scenes: [base.storyboard!.scenes[0]],
      },
    };

    expect(() =>
      applyVideoAgentTool(project, {
        name: 'removeScene',
        args: { sceneId: 'scene-1' },
      }),
    ).toThrow('Storyboard needs at least one scene');
  });

  it('sets and clears timeline bookends and clip audio seam modes', () => {
    const project = projectWithTimeline();

    const withBookend = applyVideoAgentTool(project, {
      name: 'setTimelineBookend',
      args: { position: 'outro', kind: 'fade', durationMs: 800 },
    });
    expect(withBookend.project.timeline?.outro).toEqual({
      kind: 'fade',
      durationMs: 800,
    });

    const withoutBookend = applyVideoAgentTool(withBookend.project, {
      name: 'clearTimelineBookend',
      args: { position: 'outro' },
    });
    expect(withoutBookend.project.timeline?.outro).toBeUndefined();

    const withCutAudio = applyVideoAgentTool(withoutBookend.project, {
      name: 'setClipAudioSeam',
      args: { clipId: 'clip-scene-1', mode: 'cut' },
    });
    expect(withCutAudio.project.timeline?.tracks[0]?.clips[0]).toMatchObject({
      audioSeamToNext: 'cut',
    });

    const withFollowAudio = applyVideoAgentTool(withCutAudio.project, {
      name: 'setClipAudioSeam',
      args: { clipId: 'clip-scene-1', mode: 'follow' },
    });
    const clip = withFollowAudio.project.timeline?.tracks[0]?.clips[0];
    expect(clip).toMatchObject({ kind: 'video' });
    if (clip?.kind !== 'video') {
      throw new Error('Expected video timeline clip.');
    }
    expect(clip.audioSeamToNext).toBeUndefined();
  });

  it('applies timeline ops through the agent journal path', () => {
    const project = projectWithTimeline();
    const execution = applyVideoAgentTool(
      project,
      {
        name: 'applyTimelineOp',
        args: {
          summary: 'Move the opening clip later',
          op: {
            kind: 'clip.move',
            clipId: 'clip-scene-1',
            from: { trackId: 'track-video-main', startMs: 0 },
            to: { trackId: 'track-video-main', startMs: 500 },
          },
        },
      },
      {
        now: '2026-05-25T03:00:00.000Z',
        journalId: 'timeline-op-journal',
      },
    );

    expect(execution.project.timeline?.tracks[0]?.clips[0]).toMatchObject({
      id: 'clip-scene-1',
      startMs: 500,
    });
    expect(execution.project.history).toMatchObject({
      head: 1,
      entries: [
        {
          id: 'timeline-op-journal',
          source: 'agent',
          summary: 'Move the opening clip later',
        },
      ],
    });
    expect(execution.entry).toMatchObject({
      id: 'timeline-op-journal',
      tool: 'applyTimelineOp',
      result: {
        opKind: 'clip.move',
        timelineDurationMs: 3500,
        historyHead: 1,
        acceptedOpId: 'timeline-op-journal',
      },
    });

    const restored = applyProjectDiff(
      execution.project,
      execution.entry.inverseDiff ?? [],
    );

    expect(restored.timeline).toEqual(project.timeline);
    expect(restored.history).toBeUndefined();
  });

  it('stamps accepted timeline operation ids on generated asset provenance', () => {
    const project: VideoProject = {
      ...projectWithTimeline(),
      assets: [
        {
          id: 'asset-generated',
          kind: 'video',
          source: 'ai-clip',
          path: 'videos/project/assets/generated.mp4',
          metadata: { durationMs: 2000, width: 1280, height: 720 },
          provenance: {
            provider: 'seedream-5-0',
            model: 'seedream-5-0',
            jobId: 'job-generated',
          },
        },
      ],
    };

    const execution = applyVideoAgentTool(
      project,
      {
        name: 'applyTimelineOp',
        args: {
          summary: 'Insert generated variant',
          op: {
            kind: 'clip.insert',
            trackId: 'track-video-main',
            at: 3000,
            clip: {
              id: 'clip-generated',
              kind: 'video',
              name: 'Generated variant',
              sourceRef: { kind: 'asset', assetId: 'asset-generated' },
              startMs: 3000,
              durationMs: 2000,
              trimStartMs: 0,
              trimEndMs: 2000,
              sourceDurationMs: 2000,
            },
          },
        },
      },
      {
        now: '2026-05-25T03:05:00.000Z',
        journalId: 'timeline-insert-journal',
      },
    );

    expect(execution.project.assets[0]?.provenance).toMatchObject({
      jobId: 'job-generated',
      acceptedOpId: 'timeline-insert-journal',
    });
    expect(execution.entry.result).toMatchObject({
      acceptedOpId: 'timeline-insert-journal',
    });

    const restored = applyProjectDiff(
      execution.project,
      execution.entry.inverseDiff ?? [],
    );
    expect(restored.assets[0]?.provenance).not.toHaveProperty('acceptedOpId');
  });

  it('applies timeline op batches as one agent journal entry', () => {
    const project = projectWithTimeline();
    const execution = applyVideoAgentTool(
      project,
      {
        name: 'applyTimelineOps',
        args: {
          summary: 'Move and tighten the opening clip',
          ops: [
            {
              kind: 'clip.move',
              clipId: 'clip-scene-1',
              from: { trackId: 'track-video-main', startMs: 0 },
              to: { trackId: 'track-video-main', startMs: 500 },
            },
            {
              kind: 'clip.trim',
              clipId: 'clip-scene-1',
              from: {
                startMs: 500,
                durationMs: 3000,
                trimStartMs: 0,
                trimEndMs: 3000,
              },
              to: {
                startMs: 500,
                durationMs: 2000,
                trimStartMs: 0,
                trimEndMs: 2000,
              },
            },
          ],
        },
      },
      {
        now: '2026-05-25T03:10:00.000Z',
        journalId: 'timeline-batch-journal',
      },
    );

    expect(execution.project.timeline?.tracks[0]?.clips[0]).toMatchObject({
      id: 'clip-scene-1',
      startMs: 500,
      durationMs: 2000,
    });
    expect(execution.project.history?.entries).toHaveLength(1);
    expect(execution.project.history?.entries[0]).toMatchObject({
      id: 'timeline-batch-journal',
      op: { kind: 'timeline.batch' },
      inverse: { kind: 'timeline.batch' },
      summary: 'Move and tighten the opening clip',
    });
    expect(execution.entry).toMatchObject({
      id: 'timeline-batch-journal',
      tool: 'applyTimelineOps',
      result: {
        opCount: 2,
        opKinds: ['clip.move', 'clip.trim'],
        historyHead: 1,
      },
    });

    const restored = applyProjectDiff(
      execution.project,
      execution.entry.inverseDiff ?? [],
    );

    expect(restored.timeline).toEqual(project.timeline);
    expect(restored.history).toBeUndefined();
  });

  it('compiles named timeline edit tools through the shared builder path', () => {
    const project = projectWithTimeline();
    const execution = applyVideoAgentTool(
      project,
      {
        name: 'setClipSpeed',
        args: {
          clipIds: ['clip-scene-1'],
          speed: 2,
          timingPolicy: 'preserve-source-span',
          summary: 'Make the opening clip twice as fast',
        },
      },
      {
        now: '2026-05-25T03:12:00.000Z',
        journalId: 'speed-journal',
      },
    );

    expect(execution.project.timeline?.tracks[0]?.clips[0]).toMatchObject({
      playback: { speed: 2, reverse: false },
      durationMs: 1500,
    });
    expect(execution.project.history?.entries[0]).toMatchObject({
      id: 'speed-journal',
      op: { kind: 'timeline.batch' },
      summary: 'Make the opening clip twice as fast',
    });
    expect(execution.entry).toMatchObject({
      tool: 'setClipSpeed',
      result: {
        tool: 'setClipSpeed',
        historyHead: 1,
        acceptedOpId: 'speed-journal',
      },
    });

    const restored = applyProjectDiff(
      execution.project,
      execution.entry.inverseDiff ?? [],
    );

    expect(restored.timeline).toEqual(project.timeline);
  });

  it('moves a linked clip group once when both partners are selected', () => {
    const project = projectWithLinkedTimeline();
    const execution = applyVideoAgentTool(
      project,
      {
        name: 'moveClips',
        args: {
          moves: [
            { clipId: 'clip-scene-1', toFrame: 30 },
            { clipId: 'clip-audio-1', toFrame: 30 },
          ],
          linkPolicy: 'linked',
          summary: 'Move selected linked clips together',
        },
      },
      {
        now: '2026-05-25T03:15:00.000Z',
        journalId: 'move-linked-journal',
      },
    );

    const [videoTrack, audioTrack] = execution.project.timeline?.tracks ?? [];
    expect(videoTrack?.clips[0]).toMatchObject({ startMs: 1000 });
    expect(audioTrack?.clips[0]).toMatchObject({ startMs: 1000 });
    expect(execution.project.history?.entries[0]).toMatchObject({
      op: { kind: 'timeline.batch', ops: [{ kind: 'clip.move' }] },
    });

    const restored = applyProjectDiff(
      execution.project,
      execution.entry.inverseDiff ?? [],
    );
    expect(restored.timeline).toEqual(project.timeline);
  });

  it('rejects conflicting destinations for linked move partners', () => {
    expect(() =>
      applyVideoAgentTool(projectWithLinkedTimeline(), {
        name: 'moveClips',
        args: {
          moves: [
            { clipId: 'clip-scene-1', toFrame: 30 },
            { clipId: 'clip-audio-1', toFrame: 60 },
          ],
          linkPolicy: 'linked',
          summary: 'Move selected linked clips together',
        },
      }),
    ).toThrow(
      'Linked clips must be moved once per link group with one destination',
    );
  });

  it('compiles named audio edit tools through the shared builder path', () => {
    const project = projectWithAudioTimeline();
    const gain = applyVideoAgentTool(
      project,
      {
        name: 'setAudioClipGain',
        args: {
          clipIds: ['clip-audio-1'],
          gainDb: -3,
          summary: 'Lower the voice clip',
        },
      },
      {
        now: '2026-05-25T03:17:00.000Z',
        journalId: 'audio-gain-journal',
      },
    );

    expect(gain.project.timeline?.tracks[1]?.clips[0]).toMatchObject({
      id: 'clip-audio-1',
      gainDb: -3,
    });
    expect(gain.project.history?.entries[0]).toMatchObject({
      id: 'audio-gain-journal',
      op: { kind: 'timeline.batch', ops: [{ kind: 'clip.setAudio' }] },
      summary: 'Lower the voice clip',
    });
    expect(gain.entry.result).toMatchObject({
      tool: 'setAudioClipGain',
      historyHead: 1,
      acceptedOpId: 'audio-gain-journal',
    });

    const crossfade = applyVideoAgentTool(
      project,
      {
        name: 'crossfadeAudioClips',
        args: {
          fromClipId: 'clip-audio-1',
          toClipId: 'clip-audio-2',
          durationMs: 800,
          curve: 'equal-power',
          summary: 'Blend the voice clips',
        },
      },
      {
        now: '2026-05-25T03:18:00.000Z',
        journalId: 'audio-crossfade-journal',
      },
    );

    expect(crossfade.project.timeline?.tracks[1]?.clips[0]).toMatchObject({
      audioTransitionToNext: {
        kind: 'crossfade',
        durationMs: 800,
        curve: 'equal-power',
      },
    });

    const restored = applyProjectDiff(
      gain.project,
      gain.entry.inverseDiff ?? [],
    );
    expect(restored.timeline).toEqual(project.timeline);
  });

  it('sets clip keyframes through the agent timeline journal path', () => {
    const project = projectWithTimeline();
    const execution = applyVideoAgentTool(
      project,
      {
        name: 'setKeyframes',
        args: {
          clipId: 'clip-scene-1',
          property: 'opacity',
          keys: [
            { atMs: 0, value: 0, interp: 'linear' },
            { atMs: 500, value: 1 },
          ],
          summary: 'Fade in the opening clip',
        },
      },
      {
        now: '2026-05-25T03:15:00.000Z',
        journalId: 'timeline-keyframes-journal',
      },
    );

    expect(execution.project.timeline?.tracks[0]?.clips[0]).toMatchObject({
      id: 'clip-scene-1',
      keyframes: [
        {
          property: 'opacity',
          keys: [
            { atMs: 0, value: 0, interp: 'linear' },
            { atMs: 500, value: 1 },
          ],
        },
      ],
    });
    expect(execution.project.history?.entries[0]).toMatchObject({
      id: 'timeline-keyframes-journal',
      op: { kind: 'timeline.batch' },
      summary: 'Fade in the opening clip',
    });
    expect(execution.entry).toMatchObject({
      id: 'timeline-keyframes-journal',
      tool: 'setKeyframes',
      result: {
        clipId: 'clip-scene-1',
        property: 'opacity',
        keyCount: 2,
        historyHead: 1,
        acceptedOpId: 'timeline-keyframes-journal',
      },
    });

    const restored = applyProjectDiff(
      execution.project,
      execution.entry.inverseDiff ?? [],
    );

    expect(restored.timeline).toEqual(project.timeline);
    expect(restored.history).toBeUndefined();
  });

  it('dry-runs timeline op proposals without changing timeline history', () => {
    const project = projectWithTimeline();
    const execution = applyVideoAgentTool(
      project,
      {
        name: 'proposeTimelineOps',
        args: {
          summary: 'Move the opening clip and shorten it',
          recipeId: 'product-reel',
          recipeVersion: 1,
          intentTurn: 3,
          applyMode: 'suggest',
          previewRange: { startMs: 0, endMs: 1500 },
          ops: [
            {
              kind: 'clip.move',
              clipId: 'clip-scene-1',
              from: { trackId: 'track-video-main', startMs: 0 },
              to: { trackId: 'track-video-main', startMs: 500 },
            },
            {
              kind: 'clip.trim',
              clipId: 'clip-scene-1',
              from: {
                startMs: 500,
                durationMs: 3000,
                trimStartMs: 0,
                trimEndMs: 3000,
              },
              to: {
                startMs: 500,
                durationMs: 2000,
                trimStartMs: 0,
                trimEndMs: 2000,
              },
            },
          ],
        },
      },
      {
        now: '2026-05-25T03:30:00.000Z',
        journalId: 'timeline-proposal-journal',
      },
    );

    expect(execution.project.timeline).toEqual(project.timeline);
    expect(execution.project.history).toBeUndefined();
    expect(execution.entry.diff).toEqual([]);
    expect(execution.entry.result).toMatchObject({
      schema: 'neuma.video.timeline-proposal.v1',
      opKinds: ['clip.move', 'clip.trim'],
      previewRange: { startMs: 0, endMs: 1500 },
      recipeId: 'product-reel',
      recipeVersion: 1,
      intentTurn: 3,
      applyMode: 'suggest',
      timelineDurationMs: 2500,
      inverses: [
        { kind: 'clip.move' },
        {
          kind: 'clip.trim',
          to: {
            startMs: 500,
            durationMs: 3000,
            trimStartMs: 0,
            trimEndMs: 3000,
          },
        },
      ],
    });
  });

  it('applies capture inserts to the timeline with an inverse patch', () => {
    const project = projectWithCapture();
    const execution = applyVideoAgentTool(
      project,
      {
        name: 'applyCaptureToTimeline',
        args: {
          captureId: 'capture-1',
          targetTrackId: 'track-video-main',
          atMs: 1250,
        },
      },
      {
        now: '2026-05-25T02:00:00.000Z',
        journalId: 'capture-insert',
      },
    );

    const clips = execution.project.timeline?.tracks[0]?.clips ?? [];
    expect(clips).toHaveLength(2);
    expect(clips[1]).toMatchObject({
      kind: 'video',
      sourceRef: { kind: 'asset', assetId: 'asset-capture-1' },
      startMs: 1250,
      durationMs: 2600,
      params: { captureId: 'capture-1', origin: 'capture' },
    });
    expect(execution.entry).toMatchObject({
      id: 'capture-insert',
      tool: 'applyCaptureToTimeline',
      args: { captureId: 'capture-1', targetTrackId: 'track-video-main' },
    });

    const restored = applyProjectDiff(
      execution.project,
      execution.entry.inverseDiff ?? [],
    );
    expect(restored.timeline).toEqual(project.timeline);
  });

  it('applies capture replacement to the selected clip target', () => {
    const execution = applyVideoAgentTool(projectWithCapture(), {
      name: 'applyCaptureToTimeline',
      args: {
        captureId: 'capture-1',
        atMs: 0,
        replaceClipId: 'clip-scene-1',
      },
    });

    const clip = execution.project.timeline?.tracks[0]?.clips[0];
    expect(clip).toMatchObject({
      kind: 'video',
      sourceRef: { kind: 'asset', assetId: 'asset-capture-1' },
      sceneId: 'scene-1',
      startMs: 0,
      durationMs: 2600,
    });
  });

  it('adds capture subtitles to a caption track at the inserted timeline offset', () => {
    const execution = applyVideoAgentTool(projectWithCaptureSubtitles(), {
      name: 'applyCaptureToTimeline',
      args: {
        captureId: 'capture-1',
        targetTrackId: 'track-video-main',
        atMs: 1200,
      },
    });

    const captionTrack = execution.project.timeline?.tracks.find(
      (track) => track.kind === 'caption',
    );
    expect(captionTrack?.clips).toHaveLength(2);
    expect(captionTrack?.clips[0]).toMatchObject({
      kind: 'caption',
      sourceRef: { kind: 'asset', assetId: 'asset-capture-1' },
      startMs: 1200,
      durationMs: 900,
      text: 'First caption',
      params: {
        origin: 'capture',
        captureId: 'capture-1',
        sourceCaptionId: 'subtitle-1',
      },
    });
    expect(captionTrack?.clips[1]).toMatchObject({
      startMs: 2100,
      durationMs: 1000,
      text: 'Second caption',
    });
  });

  it('rejects out-of-range timeline bookend durations', () => {
    expect(() =>
      applyVideoAgentTool(projectFixture(), {
        name: 'setTimelineBookend',
        args: { position: 'intro', kind: 'fade', durationMs: 5000 },
      }),
    ).toThrow();
  });

  it('verifies rendered EDL boundaries and journals failures', () => {
    const project: VideoProject = {
      ...projectFixture(),
      render: {
        status: 'done',
        outputPath: '/workspace/render.mp4',
        updatedAt: '2026-05-20T03:00:00.000Z',
      },
      timeline: {
        schema: 'neuma.video.timeline.v1',
        durationMs: 7000,
        fps: 30,
        tracks: [
          {
            id: 'track-video-main',
            kind: 'video',
            name: 'Video 1',
            muted: false,
            locked: false,
            order: 0,
            clips: [
              {
                id: 'clip-scene-1',
                kind: 'video',
                name: 'Scene 1',
                sourceRef: { kind: 'scene', sceneId: 'scene-1' },
                sceneId: 'scene-1',
                startMs: 0,
                durationMs: 3000,
                trimStartMs: 0,
                trimEndMs: 3000,
              },
              {
                id: 'clip-scene-2',
                kind: 'video',
                name: 'Scene 2',
                sourceRef: { kind: 'scene', sceneId: 'scene-2' },
                sceneId: 'scene-2',
                startMs: 3200,
                durationMs: 3800,
                trimStartMs: 0,
                trimEndMs: 3800,
              },
            ],
          },
          {
            id: 'track-audio-vo',
            kind: 'audio-vo',
            name: 'Voiceover',
            muted: false,
            locked: false,
            order: 10,
            clips: [
              {
                id: 'clip-vo-1',
                kind: 'audio',
                name: 'VO 1',
                sourceRef: { kind: 'scene', sceneId: 'scene-1' },
                sceneId: 'scene-1',
                startMs: 0,
                durationMs: 3000,
                trimStartMs: 0,
                trimEndMs: 3000,
                transcriptText: 'Meet the product',
                fadeInMs: 30,
                fadeOutMs: 0,
              },
              {
                id: 'clip-vo-2',
                kind: 'audio',
                name: 'VO 2',
                sourceRef: { kind: 'scene', sceneId: 'scene-2' },
                sceneId: 'scene-2',
                startMs: 3000,
                durationMs: 4000,
                trimStartMs: 0,
                trimEndMs: 4000,
                transcriptText: 'Built for teams',
                fadeInMs: 0,
                fadeOutMs: 30,
              },
            ],
          },
          {
            id: 'track-caption-main',
            kind: 'caption',
            name: 'Captions',
            muted: false,
            locked: false,
            order: 20,
            clips: [
              {
                id: 'clip-caption-1',
                kind: 'caption',
                name: 'Caption 1',
                sourceRef: { kind: 'scene', sceneId: 'scene-1' },
                sceneId: 'scene-1',
                startMs: 0,
                durationMs: 3600,
                trimStartMs: 0,
                trimEndMs: 3600,
                text: 'Meet the product',
              },
              {
                id: 'clip-caption-2',
                kind: 'caption',
                name: 'Caption 2',
                sourceRef: { kind: 'scene', sceneId: 'scene-2' },
                sceneId: 'scene-2',
                startMs: 3200,
                durationMs: 3800,
                trimStartMs: 0,
                trimEndMs: 3800,
                text: 'Built for teams',
              },
            ],
          },
        ],
      },
    };

    const execution = applyVideoAgentTool(
      project,
      { name: 'verifyRender', args: { maxIterations: 2 } },
      {
        now: '2026-05-20T03:01:00.000Z',
        journalId: 'verify-journal',
      },
    );

    expect(execution.entry.diff).toEqual([]);
    expect(execution.project.agentJournal?.[0]).toMatchObject({
      id: 'verify-journal',
      tool: 'verifyRender',
    });
    const result = execution.entry.result as {
      status: string;
      failures: Array<{ code: string }>;
      transcriptWer?: number;
    };
    expect(result.status).toBe('failed');
    expect(result.transcriptWer).toBe(0);
    expect(result.failures.map((failure) => failure.code)).toEqual(
      expect.arrayContaining(['visual-cut-gap', 'caption-out-of-scene']),
    );
    expect(() =>
      undoVideoAgentJournalEntry(execution.project, 'verify-journal'),
    ).toThrow('Agent journal entry cannot be undone');
  });
});

function projectFixture(): VideoProject {
  return {
    id: 'project-1',
    name: 'Launch cutdown',
    template: 'product-reel',
    prompt: 'Make a launch video',
    assets: [],
    storyboard: {
      status: 'draft',
      intent: 'Launch video',
      totalDurationMs: 7000,
      costEstimateUsd: { low: 0, high: 1 },
      scenes: [
        {
          id: 'scene-1',
          durationMs: 3000,
          intent: 'opening hero shot',
          caption: { text: 'Meet the product' },
          assetPlan: { kind: 'ai-image', prompt: 'hero product' },
        },
        {
          id: 'scene-2',
          durationMs: 4000,
          intent: 'wide product detail',
          caption: { text: 'Built for teams' },
          assetPlan: { kind: 'ai-image', prompt: 'product detail' },
        },
      ],
    },
    renderPlan: {
      scenes: [],
      totalCostUsd: 1,
      totalEtaSec: 10,
      warnings: [],
    },
    render: { status: 'idle', updatedAt: '2026-05-19T00:00:00.000Z' },
    budget: { capUsd: 5, spentUsd: 0 },
    outputs: [],
    createdAt: '2026-05-19T00:00:00.000Z',
    updatedAt: '2026-05-19T00:00:00.000Z',
  };
}

function projectWithTimeline(): VideoProject {
  const project = projectFixture();
  return {
    ...project,
    timeline: {
      schema: 'neuma.video.timeline.v1',
      durationMs: 7000,
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
              id: 'clip-scene-1',
              kind: 'video',
              name: 'Scene 1',
              sourceRef: { kind: 'scene', sceneId: 'scene-1' },
              sceneId: 'scene-1',
              startMs: 0,
              durationMs: 3000,
              trimStartMs: 0,
              trimEndMs: 3000,
              sourceDurationMs: 3000,
            },
          ],
        },
      ],
    },
  };
}

function projectWithLinkedTimeline(): VideoProject {
  const project = projectWithTimeline();
  const videoTrack = project.timeline!.tracks[0]!;
  const videoClip = videoTrack.clips[0]!;
  return {
    ...project,
    timeline: {
      ...project.timeline!,
      tracks: [
        {
          ...videoTrack,
          clips: [{ ...videoClip, linkGroupId: 'link-av-1' }],
        },
        {
          id: 'track-audio-main',
          kind: 'audio-vo',
          name: 'Voice 1',
          muted: false,
          locked: false,
          order: 1,
          clips: [
            {
              id: 'clip-audio-1',
              kind: 'audio',
              sourceRef: { kind: 'asset', assetId: 'asset-audio-1' },
              linkGroupId: 'link-av-1',
              startMs: 0,
              durationMs: 3000,
              trimStartMs: 0,
              trimEndMs: 3000,
              sourceDurationMs: 3000,
            },
          ],
        },
      ],
    },
  };
}

function projectWithAudioTimeline(): VideoProject {
  const project = projectWithLinkedTimeline();
  const audioTrack = project.timeline!.tracks[1]!;
  if (audioTrack.kind !== 'audio-vo') throw new Error('Expected audio track');
  const first = audioTrack.clips[0]!;
  return {
    ...project,
    timeline: {
      ...project.timeline!,
      durationMs: 6000,
      tracks: [
        project.timeline!.tracks[0]!,
        {
          ...audioTrack,
          clips: [
            first,
            {
              ...first,
              id: 'clip-audio-2',
              linkGroupId: undefined,
              startMs: 3000,
            },
          ],
        },
      ],
    },
  };
}

function projectWithCapture(): VideoProject {
  const project = projectWithTimeline();
  return {
    ...project,
    assets: [
      ...project.assets,
      {
        id: 'asset-capture-1',
        kind: 'video',
        source: 'user',
        path: '/workspace/capture.mp4',
        metadata: {
          durationMs: 2600,
          width: 1920,
          height: 1080,
          frameRate: 30,
          audioTrackCount: 1,
        },
      },
    ],
    sources: [
      {
        id: 'capture-1',
        mediaItemId: 'asset-capture-1',
        origin: 'capture',
        contentHash: 'hash-capture',
        rights: { userConfirmed: true },
        analysisStatus: 'idle',
        createdAt: '2026-05-25T02:00:00.000Z',
      },
    ],
  };
}

function projectWithCaptureSubtitles(): VideoProject {
  const project = projectWithCapture();
  return {
    ...project,
    assets: project.assets.map((asset) =>
      asset.id === 'asset-capture-1'
        ? {
            ...asset,
            metadata: {
              ...asset.metadata,
              subtitles: [
                {
                  id: 'subtitle-1',
                  text: 'First caption',
                  startMs: 0,
                  endMs: 900,
                },
                {
                  id: 'subtitle-2',
                  text: 'Second caption',
                  startMs: 900,
                  endMs: 1900,
                },
              ],
            },
          }
        : asset,
    ),
  };
}

function projectWithOverlayTimeline(): VideoProject {
  const project = projectWithTimeline();
  return {
    ...project,
    timeline: {
      ...project.timeline!,
      tracks: [
        ...project.timeline!.tracks,
        {
          id: 'track-overlay-1',
          kind: 'overlay',
          name: 'Overlay 1',
          muted: false,
          locked: false,
          order: 1,
          clips: [
            {
              id: 'clip-overlay-1',
              kind: 'effect',
              effectType: 'vivid-overlay',
              sourceRef: {
                kind: 'asset',
                assetId: 'vivid-overlay-preset:html.marker-highlight',
              },
              startMs: 400,
              durationMs: 2500,
              trimStartMs: 0,
              trimEndMs: 2500,
              params: {
                presetId: 'html.marker-highlight',
                backend: 'html',
                controls: { text: 'Highlight this', color: '#ffd166' },
                loop: 'hold',
              },
            },
          ],
        },
      ],
    },
  };
}

describe('setOverlayControls agent tool', () => {
  it('updates overlay controls in place, normalizes CSS color names, and undoes', () => {
    const project = projectWithOverlayTimeline();
    const execution = applyVideoAgentTool(
      project,
      {
        name: 'setOverlayControls',
        args: {
          clipId: 'clip-overlay-1',
          controls: { color: 'green' },
          loop: 'loop',
        },
        reasoning: 'User asked to make the overlay green.',
      },
      { now: '2026-07-07T01:00:00.000Z', journalId: 'journal-overlay-1' },
    );

    const overlayTrack = execution.project.timeline!.tracks.find(
      (track) => track.id === 'track-overlay-1',
    )!;
    const clip = overlayTrack.clips[0]!;
    if (clip.kind !== 'effect') throw new Error('expected effect clip');
    expect(clip.params).toEqual({
      presetId: 'html.marker-highlight',
      backend: 'html',
      controls: { text: 'Highlight this', color: '#008000' },
      loop: 'loop',
    });
    expect(execution.entry.tool).toBe('setOverlayControls');

    const undone = undoVideoAgentJournalEntry(
      execution.project,
      'journal-overlay-1',
      '2026-07-07T01:01:00.000Z',
    );
    const restoredTrack = undone.project.timeline!.tracks.find(
      (track) => track.id === 'track-overlay-1',
    )!;
    const restored = restoredTrack.clips[0]!;
    if (restored.kind !== 'effect') throw new Error('expected effect clip');
    expect(restored.params).toEqual({
      presetId: 'html.marker-highlight',
      backend: 'html',
      controls: { text: 'Highlight this', color: '#ffd166' },
      loop: 'hold',
    });
  });

  it('rejects out-of-range and unknown controls using the registry defs', () => {
    const project = projectWithOverlayTimeline();
    expect(() =>
      applyVideoAgentTool(project, {
        name: 'setOverlayControls',
        args: { clipId: 'clip-overlay-1', controls: { fontSize: 9999 } },
      }),
    ).toThrow(/above max 160/);
    expect(() =>
      applyVideoAgentTool(project, {
        name: 'setOverlayControls',
        args: { clipId: 'clip-overlay-1', controls: { mystery: true } },
      }),
    ).toThrow(/Unknown control: mystery/);
  });

  it('rejects overlay control edits on non-overlay clips', () => {
    const project = projectWithOverlayTimeline();
    expect(() =>
      applyVideoAgentTool(project, {
        name: 'setOverlayControls',
        args: { clipId: 'clip-scene-1', controls: { color: '#008000' } },
      }),
    ).toThrow(/vivid overlay/);
  });

  it('setClipParams shallow-merges and deletes keys with null', () => {
    const project = projectWithOverlayTimeline();
    const execution = applyVideoAgentTool(
      project,
      {
        name: 'setClipParams',
        args: {
          clipId: 'clip-overlay-1',
          patch: { loop: 'none' },
        },
      },
      { now: '2026-07-07T01:00:00.000Z', journalId: 'journal-overlay-2' },
    );
    const clip = execution.project.timeline!.tracks.find(
      (track) => track.id === 'track-overlay-1',
    )!.clips[0]!;
    if (clip.kind !== 'effect') throw new Error('expected effect clip');
    expect(clip.params).toMatchObject({ loop: 'none' });
    // deleting a key required by the overlay payload is rejected
    expect(() =>
      applyVideoAgentTool(project, {
        name: 'setClipParams',
        args: { clipId: 'clip-overlay-1', patch: { presetId: null } },
      }),
    ).toThrow(/not a valid vivid overlay payload/);
  });
});
