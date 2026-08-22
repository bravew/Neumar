import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildVideoToolCapabilityReference,
  buildVideoToolClassifications,
  getVideoToolCapabilityMetadata,
} from '@/extensions/agent/video/permissions';

import {
  createVideoEditTools,
  VIDEO_EDIT_TOOL_NAMES,
} from '@/shared/mcp/video-edit-server';
import { writeProject } from '@/shared/video/store';
import type { TimelineTransition, VideoProject } from '@/shared/video/types';

describe('video-edit MCP server', () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'video-edit-mcp-'));
    vi.stubEnv('NEUMA_VIDEO_WORKDIR', workDir);
    await writeProject(projectFixture());
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(workDir, { recursive: true, force: true });
  });

  it('exposes read-only and reducer-backed video project tools', () => {
    expect(
      createVideoEditTools({ projectId: 'project-1' }).map((tool) => tool.name),
    ).toEqual(VIDEO_EDIT_TOOL_NAMES);
    expect(VIDEO_EDIT_TOOL_NAMES).toEqual(
      expect.arrayContaining([
        'video_get_project_summary',
        'video_get_current_context',
        'video_get_scene',
        'video_get_timeline',
        'video_get_timeline_window',
        'video_inspect_timeline_frames',
        'video_find_clips',
        'video_list_assets',
        'video_describe_scene',
        'video_list_transition_presets',
        'video_list_effect_presets',
        'video_get_html_selection',
        'video_get_transition_seams',
        'video_add_scene',
        'video_set_keyframes',
        'video_set_overlay_control_keyframes',
        'video_apply_overlay_motion_template',
        'video_save_overlay_style_from_template',
        'video_save_user_overlay_document',
        'video_set_timeline_transition',
        'video_update_timeline_transition',
        'video_remove_timeline_transition',
        'video_suggest_timeline_transitions',
        'video_set_audio_clip_gain',
        'video_set_clip_effects',
        'video_analyze_clip_grade',
        'video_detect_beats',
        'video_snap_cuts_to_beats',
        'video_crossfade_audio_clips',
        'video_apply_timeline_op',
        'video_apply_timeline_ops',
        'video_undo_timeline_op',
        'video_redo_timeline_op',
        'video_list_custom_templates',
        'video_save_as_template',
        'video_record_research_brief',
        'video_search_frames',
      ]),
    );
  });

  it('classifies every registered video-edit MCP tool', () => {
    const classifications = buildVideoToolClassifications();
    const missing = VIDEO_EDIT_TOOL_NAMES.map(
      (name) => `mcp__video-edit__${name}`,
    ).filter((name) => !classifications[name]);

    expect(missing).toEqual([]);
    expect(
      classifications['mcp__video-edit__video_inspect_timeline_frames'],
    ).toBe('read');
    expect(classifications['mcp__video-edit__video_search_frames']).toBe(
      'read',
    );
    expect(
      classifications[
        'mcp__video-edit__video_save_overlay_style_from_template'
      ],
    ).toBe('write');
    expect(
      classifications['mcp__video-edit__video_save_user_overlay_document'],
    ).toBe('write');
    expect(classifications['mcp__video-edit__video_get_transition_seams']).toBe(
      'read',
    );
    expect(
      classifications['mcp__video-edit__video_set_timeline_transition'],
    ).toBe('write');
    expect(classifications['mcp__video-edit__video_set_audio_clip_gain']).toBe(
      'destructive',
    );
    expect(classifications['mcp__video-edit__video_detect_beats']).toBe(
      'write',
    );
    expect(classifications['mcp__video-edit__video_snap_cuts_to_beats']).toBe(
      'destructive',
    );
    expect(
      Object.keys(classifications)
        .filter((name) => name.startsWith('mcp__video-edit__'))
        .map((name) => name.slice('mcp__video-edit__'.length))
        .sort(),
    ).toEqual([...VIDEO_EDIT_TOOL_NAMES].sort());
    for (const name of VIDEO_EDIT_TOOL_NAMES) {
      expect(getVideoToolCapabilityMetadata(name)).toEqual({
        classification: expect.stringMatching(
          /^(read|write|execute|destructive|network)$/,
        ),
        costClass: expect.stringMatching(/^(free|metered)$/),
      });
    }
  });

  it('generates capability flags from the active tool registry', () => {
    const tools = createVideoEditTools({ projectId: 'project-1' });
    const reference = buildVideoToolCapabilityReference(tools);
    const entries = reference
      .split('\n')
      .filter((line) => line.startsWith('- ['));

    expect(entries).toHaveLength(VIDEO_EDIT_TOOL_NAMES.length);
    expect(reference).toContain('[read/free] video_get_project_summary');
    expect(reference).toContain('[destructive/free] video_render');
    expect(() =>
      buildVideoToolCapabilityReference([tools[0]!, tools[0]!]),
    ).toThrow('Duplicate video tool registration');
  });

  it('approves the storyboard from chat for first-party clients', async () => {
    const tool = findTool('video_approve_storyboard');

    const result = await tool.handler({}, {});
    const payload = JSON.parse(result.content[0]?.text ?? '{}');

    expect(payload).toMatchObject({
      projectId: 'project-1',
      status: 'approved',
      approvedBy: 'user',
      queuedJobs: 0,
    });
    expect(payload.nextStep).toContain('video_render');
    expect(payload.approvedAt).toEqual(expect.any(String));

    const { getProject } = await import('@/shared/video/store');
    const project = await getProject('project-1');
    expect(project.storyboard?.status).toBe('approved');
  });

  it('returns a proposal instead of approving for external MCP clients', async () => {
    const tool = findTool('video_approve_storyboard', {
      clientKind: 'external-mcp',
    });

    const result = await tool.handler({}, {});
    const payload = JSON.parse(result.content[0]?.text ?? '{}');

    expect(payload).toMatchObject({
      schema: 'neuma.video.mcp-proposal-required.v1',
      mode: 'proposal-only',
      tool: 'video_approve_storyboard',
    });

    const { getProject } = await import('@/shared/video/store');
    const project = await getProject('project-1');
    expect(project.storyboard?.status).toBe('draft');
  });

  it('classifies video_approve_storyboard as a reversible write', () => {
    expect(
      buildVideoToolClassifications()[
        'mcp__video-edit__video_approve_storyboard'
      ],
    ).toBe('write');
  });

  it('exposes every MCP name used by migrated built-in recipes', () => {
    expect(VIDEO_EDIT_TOOL_NAMES).toEqual(
      expect.arrayContaining([
        'video_describe_scene',
        'video_add_captions',
        'video_propose_timeline_ops',
        'video_generate_music',
        'video_generate_broll',
        'video_restyle',
        'video_reframe',
        'video_set_transition',
        'video_set_timeline_transition',
        'video_rank_moments',
      ]),
    );
  });

  it('lists transition presets with richer catalog metadata', async () => {
    const tool = findTool('video_list_transition_presets');

    const result = await tool.handler({}, {});
    const payload = JSON.parse(result.content[0]?.text ?? '{}');

    expect(payload).toMatchObject({
      schema: 'neuma.video.transition-presets.v1',
      projectId: 'project-1',
    });
    expect(payload.presets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'cube',
          group: 'stylized',
          defaultDurationMs: 600,
          maxDurationMs: 1500,
          webglPreview: 'native',
          quality: {
            ffmpeg: { fallbackKind: 'fade', support: 'fallback' },
            remotion: { support: 'custom' },
            webgl: { support: 'native' },
          },
          recommendedUse: 'social',
        }),
      ]),
    );
  });

  it('lists the installed clip-effect catalog', async () => {
    const result = await findTool('video_list_effect_presets').handler({}, {});
    const payload = JSON.parse(result.content[0]?.text ?? '{}');

    expect(payload).toMatchObject({
      schema: 'neuma.video.effect-presets.v1',
      projectId: 'project-1',
    });
    expect(payload.presets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'white-balance' }),
        expect.objectContaining({ kind: 'blur' }),
      ]),
    );
  });

  it('proposes an invertible clip-effect stack without applying it', async () => {
    const result = await findTool('video_set_clip_effects').handler(
      {
        clipId: 'timeline-clip-1',
        effects: [
          { kind: 'white-balance', params: { temperature: 0.15, tint: 0 } },
          { kind: 'contrast', params: { amount: 0.9 } },
        ],
        applyMode: 'propose',
      },
      {},
    );
    const payload = JSON.parse(result.content[0]?.text ?? '{}');

    expect(payload).toMatchObject({
      schema: 'neuma.video.mcp-proposal.v1',
      ops: [
        expect.objectContaining({
          kind: 'clip.setEffects',
          clipId: 'timeline-clip-1',
          before: null,
        }),
      ],
    });
    const { getProject } = await import('@/shared/video/store');
    const project = await getProject('project-1');
    expect(project.timeline?.tracks[0]?.clips[0]).not.toHaveProperty('effects');
  });

  it('returns timeline transition seams with constraints and adjacent clip context', async () => {
    await writeProject(projectWithTransitionSeam());
    const tool = findTool('video_get_transition_seams');

    const result = await tool.handler({}, {});
    const payload = JSON.parse(result.content[0]?.text ?? '{}');

    expect(payload).toMatchObject({
      schema: 'neuma.video.transition-seams.v1',
      projectId: 'project-1',
      seamCount: 1,
      seams: [
        expect.objectContaining({
          seamId: 'seam:track-video-main:timeline-clip-1:timeline-clip-2',
          fromClipId: 'timeline-clip-1',
          toClipId: 'timeline-clip-2',
          canAcceptTransition: true,
          constraints: expect.objectContaining({
            minDurationMs: 33,
            neighborMaxDurationMs: 250,
          }),
          fromClip: expect.objectContaining({
            label: 'Show the product in motion',
            startMs: 0,
            endMs: 500,
          }),
          toClip: expect.objectContaining({
            label: 'Show the payoff',
            startMs: 500,
            endMs: 1000,
          }),
        }),
      ],
    });
  });

  it('applies timeline seam transitions through clip.setTransition with clamped duration context', async () => {
    await writeProject(projectWithTransitionSeam());
    const tool = findTool('video_set_timeline_transition');

    const result = await tool.handler(
      {
        seamId: 'seam:track-video-main:timeline-clip-1:timeline-clip-2',
        transition: {
          kind: 'cube',
          durationMs: 2000,
          direction: 'from-left',
        },
      },
      {},
    );
    const payload = JSON.parse(result.content[0]?.text ?? '{}');

    expect(payload).toMatchObject({
      schema: 'neuma.video.timeline-transition-edit.v1',
      approvalState: 'applied',
      seamId: 'seam:track-video-main:timeline-clip-1:timeline-clip-2',
      requestedDurationMs: 2000,
      effectiveDurationMs: 250,
      clamped: true,
      effectiveTransition: {
        kind: 'cube',
        durationMs: 250,
        direction: 'from-left',
      },
      fallbackWarnings: [
        expect.objectContaining({
          requestedKind: 'cube',
          fallbackKind: 'fade',
          renderer: 'ffmpeg',
        }),
      ],
      op: expect.objectContaining({ kind: 'clip.setTransition' }),
      mutation: expect.objectContaining({
        tool: 'applyTimelineOp',
      }),
    });

    const { getProject } = await import('@/shared/video/store');
    const project = await getProject('project-1');
    expect(project.timeline?.tracks[0]?.clips[0]).toMatchObject({
      transitionToNext: {
        kind: 'cube',
        durationMs: 250,
        direction: 'from-left',
      },
    });
  });

  it('returns proposals for external timeline seam transition edits', async () => {
    await writeProject(
      projectWithTransitionSeam({
        transitionToNext: { kind: 'fade', durationMs: 250 },
      }),
    );
    const tool = findTool('video_remove_timeline_transition', {
      clientKind: 'external-mcp',
    });

    const result = await tool.handler(
      {
        seamId: 'seam:track-video-main:timeline-clip-1:timeline-clip-2',
      },
      {},
    );
    const payload = JSON.parse(result.content[0]?.text ?? '{}');

    expect(payload).toMatchObject({
      schema: 'neuma.video.timeline-transition-edit.v1',
      approvalState: 'proposal-required',
      effectiveTransition: null,
      proposal: {
        schema: 'neuma.video.mcp-proposal.v1',
        reason: 'external_mcp_proposal_only',
        tool: 'applyTimelineOp',
        opKinds: ['clip.setTransition'],
      },
    });

    const { getProject } = await import('@/shared/video/store');
    const project = await getProject('project-1');
    expect(project.timeline?.tracks[0]?.clips[0]).toMatchObject({
      transitionToNext: { kind: 'fade', durationMs: 250 },
    });
  });

  it('suggests no transition changes when editorial grammar says to keep cuts', async () => {
    await writeProject(projectWithTransitionSeam());
    const tool = findTool('video_suggest_timeline_transitions');

    const result = await tool.handler(
      { intentText: 'Should I add transitions here?' },
      {},
    );
    const payload = JSON.parse(result.content[0]?.text ?? '{}');

    expect(payload).toMatchObject({
      schema: 'neuma.video.timeline-transition-suggestions.v1',
      approvalState: 'no-change',
      suggestions: [
        expect.objectContaining({
          seamId: 'seam:track-video-main:timeline-clip-1:timeline-clip-2',
          action: 'no-change',
        }),
      ],
    });
  });

  it('suggests smoother montage transitions as timeline proposals', async () => {
    await writeProject(projectWithTransitionSeam());
    const tool = findTool('video_suggest_timeline_transitions');

    const result = await tool.handler(
      { intentText: 'Make the montage smoother, but show me before applying.' },
      {},
    );
    const payload = JSON.parse(result.content[0]?.text ?? '{}');

    expect(payload).toMatchObject({
      schema: 'neuma.video.timeline-transition-suggestions.v1',
      approvalState: 'proposed',
      proposal: expect.objectContaining({
        schema: 'neuma.video.timeline-proposal.v1',
        opKinds: ['clip.setTransition'],
        applyMode: 'suggest',
      }),
      suggestions: [
        expect.objectContaining({
          action: 'set',
          effectiveTransition: { kind: 'fade', durationMs: 250 },
        }),
      ],
    });

    const { getProject } = await import('@/shared/video/store');
    const project = await getProject('project-1');
    expect(project.timeline?.tracks[0]?.clips[0]).not.toHaveProperty(
      'transitionToNext',
    );
    expect(project.agentJournal?.[0]).toMatchObject({
      tool: 'proposeTimelineOps',
    });
  });

  it('suggests dissolve for same-scene montage smoothing', async () => {
    await writeProject(projectWithTransitionSeam({ toSceneId: 'scene-1' }));
    const tool = findTool('video_suggest_timeline_transitions');

    const result = await tool.handler(
      { intentText: 'Make the montage smoother, but show me before applying.' },
      {},
    );
    const payload = JSON.parse(result.content[0]?.text ?? '{}');

    expect(payload).toMatchObject({
      schema: 'neuma.video.timeline-transition-suggestions.v1',
      approvalState: 'proposed',
      suggestions: [
        expect.objectContaining({
          action: 'set',
          reason: expect.stringContaining('Montage smoothing'),
          requestedTransition: { kind: 'dissolve' },
          effectiveTransition: { kind: 'dissolve', durationMs: 250 },
        }),
      ],
    });
  });

  it('applies reducer-backed edits through the MCP handler', async () => {
    const tool = findTool('video_set_caption');

    const result = await tool.handler(
      { sceneId: 'scene-1', text: 'A sharper launch line' },
      {},
    );
    const payload = JSON.parse(result.content[0]?.text ?? '{}');

    // mutationResult returns the narrow ack shape, not the full project.
    // Verify the mutation actually persisted by reading the project file.
    expect(payload).toMatchObject({
      projectId: 'project-1',
      tool: 'setCaption',
    });
    expect(payload.entryId).toEqual(expect.any(String));

    const { getProject } = await import('@/shared/video/store');
    const project = await getProject('project-1');
    expect(project.storyboard?.scenes[0]?.caption?.text).toBe(
      'A sharper launch line',
    );
  });

  it('proposes an invertible batch for snapping touching cuts to beats', async () => {
    await writeProject(projectWithBeatGrid());
    const result = await findTool('video_snap_cuts_to_beats').handler(
      { sourceClipId: 'music-clip', toleranceMs: 100 },
      {},
    );
    const payload = JSON.parse(result.content[0]?.text ?? '{}');
    expect(payload).toMatchObject({
      schema: 'neuma.video.mcp-proposal.v1',
      mode: 'proposal-only',
      tool: 'video_snap_cuts_to_beats',
      opCount: 2,
      opKinds: ['clip.trim', 'clip.trim'],
    });
    expect(payload.ops).toEqual([
      expect.objectContaining({
        clipId: 'timeline-clip-2',
        to: expect.objectContaining({ startMs: 550, trimStartMs: 550 }),
      }),
      expect.objectContaining({
        clipId: 'timeline-clip-1',
        to: expect.objectContaining({ durationMs: 550, trimEndMs: 550 }),
      }),
    ]);
    expect(payload.inverses).toHaveLength(2);
  });

  it('keeps clips touching when one clip sits on two snapped boundaries', async () => {
    await writeProject(projectWithTwoBeatBoundaries());
    const result = await findTool('video_snap_cuts_to_beats').handler(
      { sourceClipId: 'music-clip', toleranceMs: 100 },
      {},
    );
    const payload = JSON.parse(result.content[0]?.text ?? '{}');
    expect(payload.opCount).toBe(4);

    // The middle clip is trimmed twice; the second op must start from the
    // state the first left behind, not from the clip's original timing.
    const { applyTimelineOps } = await import('@neumar/video-ir');
    const project = projectWithTwoBeatBoundaries();
    const applied = applyTimelineOps(project.timeline!, payload.ops).timeline;
    const clips = [...applied.tracks[0]!.clips].sort(
      (left, right) => left.startMs - right.startMs,
    );
    expect(
      clips.map((clip) => [clip.startMs, clip.startMs + clip.durationMs]),
    ).toEqual([
      [0, 550],
      [550, 1_050],
      [1_050, 1_500],
    ]);
  });

  it('makes the selected overlay green end-to-end: selection resolve, apply, context read, undo', async () => {
    await writeProject(projectWithOverlayClip());
    const editorSelection = {
      playheadMs: 1000,
      selectedClipIds: ['clip-overlay-1'],
      activePanel: {
        kind: 'clip-inspector' as const,
        clipId: 'clip-overlay-1',
      },
    };

    // "make the overlay color green" → the agent targets the selection
    const setTool = findTool('video_set_overlay_controls', {
      editorSelection,
    });
    const result = await setTool.handler(
      {
        clipId: 'selection',
        controls: { color: 'green' },
        summary: 'Make the overlay green',
      },
      {},
    );
    const payload = JSON.parse(result.content[0]?.text ?? '{}');
    expect(payload).toMatchObject({
      projectId: 'project-1',
      tool: 'setOverlayControls',
    });

    const { getProject } = await import('@/shared/video/store');
    const updated = await getProject('project-1');
    const overlayClip = updated.timeline?.tracks
      .find((track) => track.id === 'track-overlay-1')
      ?.clips.find((clip) => clip.id === 'clip-overlay-1');
    expect(overlayClip?.kind).toBe('effect');
    expect(
      (overlayClip?.params as { controls: Record<string, unknown> }).controls,
    ).toEqual({ text: 'Highlight this', color: '#008000' });

    // the timeline read surfaces the updated editable controls
    const windowTool = findTool('video_get_timeline_window', {
      editorSelection,
    });
    const windowResult = await windowTool.handler(
      { startMs: 0, endMs: 4000 },
      {},
    );
    const windowPayload = JSON.parse(windowResult.content[0]?.text ?? '{}');
    const overlaySummaries = JSON.stringify(windowPayload);
    expect(overlaySummaries).toContain('"presetId":"html.marker-highlight"');
    expect(overlaySummaries).toContain(
      '"editTool":"video_set_overlay_controls"',
    );
    expect(overlaySummaries).toContain('#008000');

    // undo restores the previous color
    const undoTool = findTool('video_undo_timeline_op', { editorSelection });
    await undoTool.handler({ entryId: payload.entryId }, {});
    const restored = await getProject('project-1');
    const restoredClip = restored.timeline?.tracks
      .find((track) => track.id === 'track-overlay-1')
      ?.clips.find((clip) => clip.id === 'clip-overlay-1');
    expect(
      (restoredClip?.params as { controls: Record<string, unknown> }).controls,
    ).toEqual({ text: 'Highlight this', color: '#ffd166' });
  });

  it('prefers the inspected clip over a multi-selection when resolving "selection"', async () => {
    await writeProject(projectWithOverlayClip());
    const setTool = findTool('video_set_overlay_controls', {
      editorSelection: {
        selectedClipIds: ['timeline-clip-1', 'clip-overlay-1'],
        activePanel: {
          kind: 'clip-inspector' as const,
          clipId: 'clip-overlay-1',
        },
      },
    });
    const result = await setTool.handler(
      { clipId: 'selection', controls: { color: '#112233' } },
      {},
    );
    const payload = JSON.parse(result.content[0]?.text ?? '{}');
    expect(payload.tool).toBe('setOverlayControls');

    const { getProject } = await import('@/shared/video/store');
    const project = await getProject('project-1');
    const overlayClip = project.timeline?.tracks
      .find((track) => track.id === 'track-overlay-1')
      ?.clips.find((clip) => clip.id === 'clip-overlay-1');
    expect(
      (overlayClip?.params as { controls: Record<string, unknown> }).controls,
    ).toMatchObject({ color: '#112233' });
  });

  it('surfaces a clear error for invalid overlay control values', async () => {
    await writeProject(projectWithOverlayClip());
    const setTool = findTool('video_set_overlay_controls', {});
    const result = await setTool.handler(
      { clipId: 'clip-overlay-1', controls: { fontSize: 9999 } },
      {},
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/above max 160/);
  });

  it('sets numeric overlay control keyframes and rejects nonnumeric controls', async () => {
    await writeProject(projectWithOverlayClip());
    const editorSelection = {
      selectedClipIds: ['clip-overlay-1'],
      activePanel: {
        kind: 'clip-inspector' as const,
        clipId: 'clip-overlay-1',
      },
    };
    const tool = findTool('video_set_overlay_control_keyframes', {
      editorSelection,
    });

    const result = await tool.handler(
      {
        clipId: 'selection',
        controlId: 'fontSize',
        keys: [
          { atMs: 0, value: 48, interp: 'linear' },
          { atMs: 500, value: 96, interp: 'smooth' },
        ],
        summary: 'Pulse overlay font size',
      },
      {},
    );
    const payload = JSON.parse(result.content[0]?.text ?? '{}');
    expect(payload).toMatchObject({
      projectId: 'project-1',
      tool: 'setOverlayControlKeyframes',
    });

    const { getProject } = await import('@/shared/video/store');
    const project = await getProject('project-1');
    const overlayClip = project.timeline?.tracks
      .find((track) => track.id === 'track-overlay-1')
      ?.clips.find((clip) => clip.id === 'clip-overlay-1');
    expect(
      (overlayClip?.params as { controlKeyframes?: unknown }).controlKeyframes,
    ).toEqual([
      {
        controlId: 'fontSize',
        keys: [
          { atMs: 0, value: 48, interp: 'linear' },
          { atMs: 500, value: 96, interp: 'smooth' },
        ],
      },
    ]);

    const windowTool = findTool('video_get_timeline_window', {
      editorSelection,
    });
    const windowResult = await windowTool.handler(
      { startMs: 0, endMs: 4000 },
      {},
    );
    const windowPayload = JSON.parse(windowResult.content[0]?.text ?? '{}');
    const overlaySummaries = JSON.stringify(windowPayload);
    expect(overlaySummaries).toContain(
      '"keyframeTool":"video_set_overlay_control_keyframes"',
    );
    expect(overlaySummaries).toContain('"keyframes":[{"atMs":0,"value":48');

    const rejected = await tool.handler(
      {
        clipId: 'clip-overlay-1',
        controlId: 'color',
        keys: [{ atMs: 0, value: 1 }],
      },
      {},
    );
    expect(rejected.isError).toBe(true);
    expect(rejected.content[0]?.text).toMatch(
      /Control color does not support keyframes/,
    );
  });

  it('applies overlay motion templates with provenance through the MCP handler', async () => {
    await writeProject(projectWithOverlayClip());
    const editorSelection = {
      selectedClipIds: ['clip-overlay-1'],
      activePanel: {
        kind: 'clip-inspector' as const,
        clipId: 'clip-overlay-1',
      },
    };
    const tool = findTool('video_apply_overlay_motion_template', {
      editorSelection,
    });

    const result = await tool.handler(
      {
        clipId: 'selection',
        templateId: 'entrance.fade-up',
        strength: 'subtle',
        summary: 'Give the overlay a soft entrance',
      },
      {},
    );
    const payload = JSON.parse(result.content[0]?.text ?? '{}');
    expect(payload).toMatchObject({
      projectId: 'project-1',
      tool: 'applyOverlayMotionTemplate',
    });

    const { getProject } = await import('@/shared/video/store');
    const project = await getProject('project-1');
    const overlayClip = project.timeline?.tracks
      .find((track) => track.id === 'track-overlay-1')
      ?.clips.find((clip) => clip.id === 'clip-overlay-1');
    expect(overlayClip?.keyframes?.map((track) => track.property)).toEqual([
      'opacity',
      'positionY',
    ]);
    expect(
      (overlayClip?.params as { motionTemplate?: { templateId?: string } })
        .motionTemplate,
    ).toMatchObject({
      source: 'motion-template',
      templateId: 'entrance.fade-up',
      strength: 'subtle',
      affectedProperties: ['opacity', 'positionY'],
    });

    const windowTool = findTool('video_get_timeline_window', {
      editorSelection,
    });
    const windowResult = await windowTool.handler(
      { startMs: 0, endMs: 4000 },
      {},
    );
    expect(
      JSON.stringify(JSON.parse(windowResult.content[0]?.text ?? '{}')),
    ).toContain('"templateId":"entrance.fade-up"');

    const rejected = await tool.handler(
      {
        clipId: 'clip-overlay-1',
        templateId: 'ambient.float',
      },
      {},
    );
    expect(rejected.isError).toBe(true);
    expect(rejected.content[0]?.text).toMatch(/not compatible/);
  });

  it('returns a proposal instead of applying timeline ops for external MCP clients', async () => {
    const tool = findTool('video_apply_timeline_op', {
      clientKind: 'external-mcp',
    });

    const result = await tool.handler(
      {
        summary: 'Move the clip later',
        op: {
          kind: 'clip.move',
          clipId: 'timeline-clip-1',
          from: { trackId: 'track-video-main', startMs: 0 },
          to: { trackId: 'track-video-main', startMs: 500 },
        },
      },
      {},
    );
    const payload = JSON.parse(result.content[0]?.text ?? '{}');

    expect(payload).toMatchObject({
      schema: 'neuma.video.mcp-proposal.v1',
      mode: 'proposal-only',
      reason: 'external_mcp_proposal_only',
      tool: 'applyTimelineOp',
      opKinds: ['clip.move'],
      conflicts: [],
      agentApplyFlag: false,
    });

    const { getProject } = await import('@/shared/video/store');
    const project = await getProject('project-1');
    expect(project.timeline?.tracks[0]?.clips[0]?.startMs).toBe(0);
  });

  it('returns concrete proposals for named timeline edit tools', async () => {
    const tool = findTool('video_set_clip_speed', {
      clientKind: 'external-mcp',
    });

    const result = await tool.handler(
      {
        clipIds: ['timeline-clip-1'],
        speed: 2,
        timingPolicy: 'preserve-source-span',
        summary: 'Double the opening clip speed',
      },
      {},
    );
    const payload = JSON.parse(result.content[0]?.text ?? '{}');

    expect(payload).toMatchObject({
      schema: 'neuma.video.mcp-proposal.v1',
      mode: 'proposal-only',
      tool: 'setClipSpeed',
      opKinds: ['clip.setPlayback', 'clip.trim'],
      conflicts: [],
      metadata: {
        changedClipIds: ['timeline-clip-1'],
        inspectClipIds: ['timeline-clip-1'],
      },
    });

    const { getProject } = await import('@/shared/video/store');
    const project = await getProject('project-1');
    expect(project.timeline?.tracks[0]?.clips[0]).toMatchObject({
      id: 'timeline-clip-1',
      durationMs: 4000,
    });
    expect(project.timeline?.tracks[0]?.clips[0]?.playback).toBeUndefined();
  });

  it('returns concrete proposals for named audio edit tools', async () => {
    await writeProject(projectWithAudioTimeline());
    const tool = findTool('video_set_audio_clip_gain', {
      clientKind: 'external-mcp',
    });

    const result = await tool.handler(
      {
        clipIds: ['timeline-audio-1'],
        gainDb: -4,
        summary: 'Lower the narration',
      },
      {},
    );
    const payload = JSON.parse(result.content[0]?.text ?? '{}');

    expect(payload).toMatchObject({
      schema: 'neuma.video.mcp-proposal.v1',
      mode: 'proposal-only',
      tool: 'setAudioClipGain',
      opKinds: ['clip.setAudio'],
      conflicts: [],
      metadata: {
        changedClipIds: ['timeline-audio-1'],
        inspectClipIds: ['timeline-audio-1'],
      },
    });

    const { getProject } = await import('@/shared/video/store');
    const project = await getProject('project-1');
    const audioTrack = project.timeline?.tracks.find(
      (track) => track.id === 'track-audio-main',
    );
    expect(audioTrack?.clips[0]).not.toHaveProperty('gainDb');
  });

  it('applies clip keyframes through the MCP handler', async () => {
    const tool = findTool('video_set_keyframes');

    const result = await tool.handler(
      {
        clipId: 'timeline-clip-1',
        property: 'opacity',
        keys: [
          { atMs: 0, value: 0, interp: 'linear' },
          { atMs: 500, value: 1 },
        ],
        summary: 'Fade in the opening clip',
      },
      {},
    );
    const payload = JSON.parse(result.content[0]?.text ?? '{}');

    expect(payload).toMatchObject({
      projectId: 'project-1',
      tool: 'setKeyframes',
      result: {
        clipId: 'timeline-clip-1',
        property: 'opacity',
        keyCount: 2,
        historyHead: 1,
      },
    });

    const { getProject } = await import('@/shared/video/store');
    const project = await getProject('project-1');
    expect(project.timeline?.tracks[0]?.clips[0]?.keyframes).toEqual([
      {
        property: 'opacity',
        keys: [
          { atMs: 0, value: 0, interp: 'linear' },
          { atMs: 500, value: 1 },
        ],
      },
    ]);
  });

  it('requires proposals for external MCP keyframe edits', async () => {
    const tool = findTool('video_set_keyframes', {
      clientKind: 'external-mcp',
    });

    const result = await tool.handler(
      {
        clipId: 'timeline-clip-1',
        property: 'opacity',
        keys: [{ atMs: 0, value: 0.5 }],
      },
      {},
    );
    const payload = JSON.parse(result.content[0]?.text ?? '{}');

    expect(payload).toMatchObject({
      schema: 'neuma.video.mcp-proposal-required.v1',
      mode: 'proposal-only',
      reason: 'external_mcp_proposal_only',
      tool: 'setKeyframes',
      agentApplyFlag: false,
    });

    const { getProject } = await import('@/shared/video/store');
    const project = await getProject('project-1');
    expect(project.timeline?.tracks[0]?.clips[0]?.keyframes).toBeUndefined();
  });

  it('applies newly added migrated recipe tools through the reducer', async () => {
    const tool = findTool('video_generate_broll');

    const result = await tool.handler(
      {
        sceneId: 'scene-1',
        query: 'hands using the product',
        rangeMs: [0, 3000],
      },
      {},
    );
    const payload = JSON.parse(result.content[0]?.text ?? '{}');

    expect(payload).toMatchObject({
      projectId: 'project-1',
      tool: 'generateBRoll',
    });

    const { getProject } = await import('@/shared/video/store');
    const project = await getProject('project-1');
    expect(project.storyboard?.scenes[0]?.assetPlan).toMatchObject({
      kind: 'broll-search',
      query: 'hands using the product',
    });
  });

  it('applies atomic timeline op batches with resolver refs', async () => {
    const tool = findTool('video_apply_timeline_ops');

    const result = await tool.handler(
      {
        summary: 'Move and tighten the selected clip',
        resolverRefs: { selectionClipIds: ['timeline-clip-1'] },
        ops: [
          {
            kind: 'clip.move',
            clipId: '$selection',
            from: { trackId: 'track-video-main', startMs: 0 },
            to: { trackId: 'track-video-main', startMs: 500 },
          },
          {
            kind: 'clip.trim',
            clipId: '$selection',
            from: {
              startMs: 500,
              durationMs: 4000,
              trimStartMs: 0,
              trimEndMs: 4000,
            },
            to: {
              startMs: 500,
              durationMs: 2500,
              trimStartMs: 0,
              trimEndMs: 2500,
            },
          },
        ],
      },
      {},
    );
    const payload = JSON.parse(result.content[0]?.text ?? '{}');

    expect(payload).toMatchObject({
      projectId: 'project-1',
      tool: 'applyTimelineOps',
      result: {
        opCount: 2,
        opKinds: ['clip.move', 'clip.trim'],
        historyHead: 1,
      },
    });

    const { getProject } = await import('@/shared/video/store');
    const project = await getProject('project-1');
    expect(project.timeline?.tracks[0]?.clips[0]).toMatchObject({
      id: 'timeline-clip-1',
      startMs: 500,
      durationMs: 2500,
    });
    expect(project.history?.entries).toHaveLength(1);
    expect(project.agentJournal).toHaveLength(1);
  });

  it('resolves transcript selections into timeline range edits', async () => {
    const tool = findTool('video_apply_timeline_ops');

    const result = await tool.handler(
      {
        summary: 'Cut the selected transcript span',
        resolverRefs: {
          transcriptSelection: {
            startMs: 0,
            endMs: 500,
            text: 'pause',
          },
        },
        ops: [
          {
            kind: 'clip.removeTimeRange',
            rangeRef: 'transcript_selection',
            magnetic: true,
          },
        ],
      },
      {},
    );
    const payload = JSON.parse(result.content[0]?.text ?? '{}');

    expect(payload).toMatchObject({
      projectId: 'project-1',
      tool: 'applyTimelineOps',
      result: {
        opCount: 1,
        opKinds: ['clip.removeTimeRange'],
      },
    });

    const { getProject } = await import('@/shared/video/store');
    const project = await getProject('project-1');
    expect(project.timeline?.tracks[0]?.clips[0]).toMatchObject({
      id: 'timeline-clip-1',
      startMs: 0,
      durationMs: 3500,
      trimStartMs: 500,
      trimEndMs: 4000,
    });
  });

  it('reports frame search as disabled by default', async () => {
    const tool = findTool('video_search_frames');

    const result = await tool.handler(
      { query: 'product hero', refreshIndex: true },
      {},
    );
    const payload = JSON.parse(result.content[0]?.text ?? '{}');

    expect(payload).toMatchObject({
      schema: 'neuma.video.frame-search.v1',
      projectId: 'project-1',
      query: 'product hero',
      index: { indexed: 0, embedded: 0, skippedVector: 0 },
      results: [],
      capability: {
        enabled: false,
        degraded: true,
        reason: 'video.frameSearch disabled',
      },
    });
  });

  it('rejects invalid frame inspection ranges before rendering', async () => {
    const result = await findTool('video_inspect_timeline_frames').handler(
      {
        startMs: 1000,
        endMs: 1000,
      },
      {},
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('endMs must be after startMs');
  });

  it('does not persist partial timeline batches when a later op fails', async () => {
    const tool = findTool('video_apply_timeline_ops');

    const result = await tool.handler(
      {
        summary: 'Invalid batch',
        ops: [
          {
            kind: 'clip.move',
            clipId: 'timeline-clip-1',
            from: { trackId: 'track-video-main', startMs: 0 },
            to: { trackId: 'track-video-main', startMs: 500 },
          },
          {
            kind: 'clip.trim',
            clipId: 'missing-clip',
            from: {
              startMs: 0,
              durationMs: 1000,
              trimStartMs: 0,
              trimEndMs: 1000,
            },
            to: {
              startMs: 0,
              durationMs: 500,
              trimStartMs: 0,
              trimEndMs: 500,
            },
          },
        ],
      },
      {},
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Clip not found');

    const { getProject } = await import('@/shared/video/store');
    const project = await getProject('project-1');
    expect(project.timeline?.tracks[0]?.clips[0]).toMatchObject({
      id: 'timeline-clip-1',
      startMs: 0,
      durationMs: 4000,
    });
    expect(project.history).toBeUndefined();
    expect(project.agentJournal).toBeUndefined();
  });

  it('keeps the original read-only tool names available', () => {
    expect(VIDEO_EDIT_TOOL_NAMES).toEqual(
      expect.arrayContaining([
        'video_get_project_summary',
        'video_get_current_context',
        'video_get_scene',
        'video_get_timeline',
        'video_get_timeline_window',
        'video_find_clips',
        'video_list_assets',
        'video_describe_scene',
      ]),
    );
  });

  it('returns compact timeline windows and clip search results', async () => {
    const windowResult = await findTool('video_get_timeline_window').handler(
      { startMs: 0, endMs: 1000 },
      {},
    );
    const windowPayload = JSON.parse(windowResult.content[0]?.text ?? '{}');

    expect(windowPayload).toMatchObject({
      schema: 'neuma.video.timeline-window.v1',
      projectId: 'project-1',
      range: [0, 1000],
      tracks: [
        {
          id: 'track-video-main',
          k: 'video',
          clips: [
            {
              id: 'timeline-clip-1',
              k: 'video',
              s: 0,
              d: 4000,
              src: 'asset:asset-video',
            },
          ],
        },
      ],
    });

    const searchResult = await findTool('video_find_clips').handler(
      { query: 'asset-video' },
      {},
    );
    const searchPayload = JSON.parse(searchResult.content[0]?.text ?? '{}');

    expect(searchPayload).toMatchObject({
      schema: 'neuma.video.timeline-clip-search.v1',
      clips: [
        {
          track: { id: 'track-video-main', k: 'video' },
          clip: { id: 'timeline-clip-1' },
        },
      ],
    });
  });

  it('clears timeout handles after successful timed tool calls', async () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    try {
      await findTool('video_get_timeline_window').handler(
        { startMs: 0, endMs: 1000 },
        {},
      );

      expect(clearTimeoutSpy).toHaveBeenCalled();
    } finally {
      clearTimeoutSpy.mockRestore();
    }
  });

  it('returns a bounded project summary', async () => {
    const tool = findTool('video_get_project_summary');

    const result = await tool.handler({}, {});
    const payload = JSON.parse(result.content[0]?.text ?? '{}');

    expect(payload).toMatchObject({
      id: 'project-1',
      name: 'Launch clip',
      assets: { total: 2, byKind: { image: 1, video: 1, audio: 0 } },
      storyboard: { status: 'draft', sceneCount: 1 },
      timeline: { trackCount: 1, clipCount: 1 },
      activeContext: { projectId: 'project-1', selectedSceneId: 'scene-1' },
    });
    expect(payload.scriptPreview).toBeUndefined();
  });

  it('returns current editor context for selected clips and preview frame', async () => {
    const tool = findTool('video_get_current_context', {
      selectedSceneId: 'scene-1',
      editorSelection: {
        playheadMs: 1000,
        selectedClipIds: ['timeline-clip-1'],
        previewFrame: {
          atMs: 1000,
          sceneId: 'scene-1',
          clipId: 'timeline-clip-1',
          aspectRatio: '16:9',
          source: 'timeline-preview',
        },
      },
    });

    const result = await tool.handler(
      { include: ['scene', 'selection', 'previewFrame', 'assets'] },
      {},
    );
    const payload = JSON.parse(result.content[0]?.text ?? '{}');

    expect(payload).toMatchObject({
      schema: 'neuma.video.current-context.v1',
      active: {
        selectedSceneId: 'scene-1',
        playheadMs: 1000,
        selectedClipIds: ['timeline-clip-1'],
      },
      selectedScene: {
        id: 'scene-1',
        intent: 'Show the product in motion',
      },
      previewFrame: {
        atMs: 1000,
        clip: {
          clip: {
            id: 'timeline-clip-1',
            activeAtPlayhead: true,
            sourceTimeMs: 1000,
          },
        },
      },
    });
    expect(payload.selection.selectedClips[0].asset).toMatchObject({
      id: 'asset-video',
      path: 'videos/project-1/assets/demo.mp4',
    });
    expect(payload.assets).toHaveLength(1);
  });

  it('uses the selected scene fallback for scene reads', async () => {
    const tool = findTool('video_get_scene');

    const result = await tool.handler({}, {});
    const payload = JSON.parse(result.content[0]?.text ?? '{}');

    expect(payload.sceneId).toBe('scene-1');
    expect(payload.storyboardScene.intent).toBe('Show the product in motion');
    expect(payload.timelineClips).toHaveLength(1);
  });

  it('lists assets with filtering and pagination', async () => {
    const tool = findTool('video_list_assets');

    const result = await tool.handler({ kind: 'image', limit: 1 }, {});
    const payload = JSON.parse(result.content[0]?.text ?? '{}');

    expect(payload.total).toBe(1);
    expect(payload.assets).toEqual([
      expect.objectContaining({
        id: 'asset-image',
        kind: 'image',
        path: 'videos/project-1/assets/hero.png',
      }),
    ]);
  });

  it('returns a descriptive scene summary', async () => {
    const tool = findTool('video_describe_scene');

    const result = await tool.handler({ sceneId: 'scene-1' }, {});

    expect(result.content[0]?.text).toContain('Scene scene-1');
    expect(result.content[0]?.text).toContain('Show the product in motion');
    expect(result.content[0]?.text).toContain('Referenced assets: asset-video');
  });

  it('reports missing scenes as tool errors', async () => {
    const tool = findTool('video_describe_scene');

    const result = await tool.handler({ sceneId: 'missing' }, {});

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Scene missing was not found');
  });

  it('reads the persisted content-graph via video_get_content_graph', async () => {
    const { writeContentGraph } =
      await import('@/shared/video/content-graph/persistence');
    // Null before anything is written.
    const empty = JSON.parse(
      (await findTool('video_get_content_graph').handler({}, {})).content[0]
        ?.text ?? '{}',
    );
    expect(empty).toMatchObject({ projectId: 'project-1', graph: null });

    await writeContentGraph('project-1', {
      schemaVersion: 1,
      intent: 'explainer',
      nodes: [{ id: 'a', kind: 'text', text: 'hello' }],
      edges: [],
    });
    const result = await findTool('video_get_content_graph').handler({}, {});
    const payload = JSON.parse(result.content[0]?.text ?? '{}');
    expect(payload.graph.nodes).toHaveLength(1);
    expect(payload.graph.nodes[0]).toMatchObject({ id: 'a', kind: 'text' });
  });

  it('records research briefs through the MCP tool', async () => {
    const tool = findTool('video_record_research_brief');

    const result = await tool.handler(
      {
        topic: 'Launch audience research',
        depth: 'standard',
        findings: [
          'Technical buyers want a concrete workflow outcome.',
          'Short videos should surface proof before the final CTA.',
        ],
        facts: {
          primaryAudience: 'platform teams',
        },
        suggestedBeats: ['Open with the problem', 'Show the workflow proof'],
        citations: [
          {
            title: 'Buyer research notes',
            url: 'https://example.com/research',
            fetchedAt: '2026-06-16T00:00:00.000Z',
          },
        ],
      },
      {},
    );
    const payload = JSON.parse(result.content[0]?.text ?? '{}');

    expect(payload).toMatchObject({
      projectId: 'project-1',
      topic: 'Launch audience research',
      findingCount: 2,
      citationCount: 1,
    });

    const { getProject } = await import('@/shared/video/store');
    const project = await getProject('project-1');
    expect(project.analysisArtifacts?.[0]).toMatchObject({
      kind: 'custom',
      summary: 'Research brief: Launch audience research',
      metadata: {
        type: 'video-research-brief',
        brief: {
          topic: 'Launch audience research',
          depth: 'standard',
          findings: [
            'Technical buyers want a concrete workflow outcome.',
            'Short videos should surface proof before the final CTA.',
          ],
          facts: {
            primaryAudience: 'platform teams',
          },
          suggestedBeats: ['Open with the problem', 'Show the workflow proof'],
          citations: [
            {
              title: 'Buyer research notes',
              url: 'https://example.com/research',
              fetchedAt: '2026-06-16T00:00:00.000Z',
            },
          ],
        },
      },
    });
  });

  it('saves and lists user HTML templates through MCP tools', async () => {
    const { writeContentGraph, writeFrameHtml } =
      await import('@/shared/video/content-graph/persistence');
    await writeContentGraph('project-1', {
      schemaVersion: 1,
      intent: 'single-frame',
      nodes: [
        {
          id: 'intro',
          kind: 'text',
          text: 'Market recap',
          durationSec: 4,
        },
      ],
      edges: [],
    });
    await writeFrameHtml(
      'project-1',
      'intro',
      '<section data-hv-text="headline">Market recap</section>',
    );

    const saveResult = await findTool('video_save_as_template').handler(
      {
        displayName: 'Market recap card',
        category: 'recap',
        license: 'CC0',
      },
      {},
    );
    const saved = JSON.parse(saveResult.content[0]?.text ?? '{}');
    expect(saved.template).toMatchObject({
      displayName: 'Market recap card',
      engine: 'html',
      hasHtml: true,
    });

    const listResult = await findTool('video_list_custom_templates').handler(
      { engine: 'html' },
      {},
    );
    const listed = JSON.parse(listResult.content[0]?.text ?? '{}');
    expect(listed.templates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: saved.template.id,
          name: 'Market recap card',
          engine: 'html',
        }),
      ]),
    );
  });
});

function projectWithOverlayClip(): VideoProject {
  const project = projectFixture();
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

function findTool(
  name: string,
  options: Parameters<typeof createVideoEditTools>[0] = {},
) {
  const found = createVideoEditTools({
    projectId: 'project-1',
    selectedSceneId: 'scene-1',
    ...options,
  }).find((candidate) => candidate.name === name);
  if (!found) throw new Error(`Tool ${name} not found`);
  return found;
}

function projectFixture(): VideoProject {
  const now = '2026-05-31T00:00:00.000Z';
  return {
    schemaVersion: 2,
    id: 'project-1',
    name: 'Launch clip',
    template: 'product-reel',
    prompt: 'Make a concise product launch clip',
    assets: [
      {
        id: 'asset-video',
        kind: 'video',
        source: 'user',
        path: 'videos/project-1/assets/demo.mp4',
        metadata: { durationMs: 4000, width: 1920, height: 1080 },
      },
      {
        id: 'asset-image',
        kind: 'image',
        source: 'ai-image',
        path: 'videos/project-1/assets/hero.png',
        metadata: { durationMs: 0, width: 1024, height: 1024 },
        provenance: {
          provider: 'seedream-5-0',
          model: 'seedream-5-0',
          cost: 0.02,
          prompt: 'A crisp product hero on a clean background',
        },
      },
    ],
    sources: [],
    linkedSources: [],
    sourceAnalyses: [],
    cutPlans: [],
    storyboard: {
      status: 'draft',
      intent: 'Launch teaser',
      totalDurationMs: 4000,
      costEstimateUsd: { low: 0.02, high: 0.1 },
      scenes: [
        {
          id: 'scene-1',
          durationMs: 4000,
          intent: 'Show the product in motion',
          caption: { text: 'Built for fast launches' },
          assetPlan: { kind: 'existing', assetId: 'asset-video' },
        },
      ],
    },
    scenes: [
      {
        id: 'scene-1',
        durationMs: 4000,
        clips: [{ id: 'clip-1', mediaId: 'asset-video' }],
      },
    ],
    timeline: {
      schema: 'neuma.video.timeline.v1',
      durationMs: 4000,
      fps: 24,
      tracks: [
        {
          id: 'track-video-main',
          kind: 'video',
          name: 'Main video',
          muted: false,
          locked: false,
          order: 0,
          clips: [
            {
              id: 'timeline-clip-1',
              kind: 'video',
              sourceRef: { kind: 'asset', assetId: 'asset-video' },
              sceneId: 'scene-1',
              startMs: 0,
              durationMs: 4000,
              trimStartMs: 0,
              trimEndMs: 4000,
            },
          ],
        },
      ],
    },
    render: { status: 'idle', updatedAt: now },
    budget: { capUsd: 5, spentUsd: 0.02 },
    outputs: [],
    createdAt: now,
    updatedAt: now,
  };
}

function projectWithTransitionSeam(
  input: {
    transitionToNext?: TimelineTransition;
    toSceneId?: string;
  } = {},
): VideoProject {
  const project = projectFixture();
  return {
    ...project,
    storyboard: {
      ...project.storyboard!,
      totalDurationMs: 1000,
      scenes: [
        ...project.storyboard!.scenes.map((scene) => ({
          ...scene,
          durationMs: 500,
        })),
        {
          id: 'scene-2',
          durationMs: 500,
          intent: 'Show the payoff',
          caption: { text: 'Ready to ship' },
          assetPlan: { kind: 'existing', assetId: 'asset-video' },
        },
      ],
    },
    scenes: [
      ...(project.scenes ?? []).map((scene) => ({
        ...scene,
        durationMs: 500,
      })),
      {
        id: 'scene-2',
        durationMs: 500,
        clips: [{ id: 'clip-2', mediaId: 'asset-video' }],
      },
    ],
    timeline: {
      ...project.timeline!,
      durationMs: 1000,
      tracks: [
        {
          ...project.timeline!.tracks[0]!,
          clips: [
            {
              ...project.timeline!.tracks[0]!.clips[0]!,
              durationMs: 500,
              trimEndMs: 500,
              ...(input.transitionToNext
                ? { transitionToNext: input.transitionToNext }
                : {}),
            },
            {
              id: 'timeline-clip-2',
              kind: 'video',
              sourceRef: { kind: 'asset', assetId: 'asset-video' },
              sceneId: input.toSceneId ?? 'scene-2',
              startMs: 500,
              durationMs: 500,
              trimStartMs: 500,
              trimEndMs: 1000,
            },
          ],
        },
      ],
    },
  };
}

function projectWithAudioTimeline(): VideoProject {
  const project = projectFixture();
  return {
    ...project,
    assets: [
      ...project.assets,
      {
        id: 'asset-audio',
        kind: 'audio',
        source: 'user',
        path: 'videos/project-1/assets/narration.wav',
        metadata: { durationMs: 8000 },
      },
    ],
    timeline: {
      ...project.timeline!,
      durationMs: 8000,
      tracks: [
        ...project.timeline!.tracks,
        {
          id: 'track-audio-main',
          kind: 'audio-vo',
          name: 'Narration',
          muted: false,
          locked: false,
          order: 10,
          clips: [
            {
              id: 'timeline-audio-1',
              kind: 'audio',
              sourceRef: { kind: 'asset', assetId: 'asset-audio' },
              startMs: 0,
              durationMs: 4000,
              trimStartMs: 0,
              trimEndMs: 4000,
              sourceDurationMs: 8000,
            },
            {
              id: 'timeline-audio-2',
              kind: 'audio',
              sourceRef: { kind: 'asset', assetId: 'asset-audio' },
              startMs: 4000,
              durationMs: 4000,
              trimStartMs: 4000,
              trimEndMs: 8000,
              sourceDurationMs: 8000,
            },
          ],
        },
      ],
    },
  };
}

function projectWithBeatGrid(): VideoProject {
  const project = projectWithTransitionSeam();
  return {
    ...project,
    assets: [
      ...project.assets,
      {
        id: 'music-asset',
        kind: 'audio',
        source: 'user',
        path: 'videos/project-1/assets/music.wav',
        metadata: { durationMs: 2_000, audioTrackCount: 1 },
      },
    ],
    sources: [
      {
        id: 'music-source',
        mediaItemId: 'music-asset',
        origin: 'upload',
        contentHash: 'music-hash',
        analysisStatus: 'done',
        createdAt: project.createdAt,
      },
    ],
    analysisArtifacts: [
      {
        id: 'music-beats',
        kind: 'beat-markers',
        sourceMediaId: 'music-source',
        contentHash: 'music-hash',
        metadata: {
          beatGrid: {
            schema: 'neuma.video.beat-grid.v1',
            sourceMediaId: 'music-source',
            contentHash: 'music-hash',
            tempoBpm: 120,
            points: [{ sourceMs: 550, confidence: 0.9, bar: 1, beat: 2 }],
          },
        },
        generatedAt: project.createdAt,
      },
    ],
    timeline: {
      ...project.timeline!,
      tracks: [
        ...project.timeline!.tracks,
        {
          id: 'music-track',
          kind: 'audio-music',
          name: 'Music',
          muted: false,
          locked: false,
          order: 10,
          clips: [
            {
              id: 'music-clip',
              kind: 'audio',
              sourceRef: { kind: 'asset', assetId: 'music-asset' },
              startMs: 0,
              durationMs: 1_000,
              trimStartMs: 0,
              trimEndMs: 1_000,
            },
          ],
        },
      ],
    },
  };
}

function projectWithTwoBeatBoundaries(): VideoProject {
  const project = projectWithBeatGrid();
  const [videoTrack, musicTrack] = project.timeline!.tracks;
  return {
    ...project,
    analysisArtifacts: [
      {
        ...project.analysisArtifacts![0]!,
        metadata: {
          beatGrid: {
            schema: 'neuma.video.beat-grid.v1',
            sourceMediaId: 'music-source',
            contentHash: 'music-hash',
            tempoBpm: 120,
            points: [
              { sourceMs: 550, confidence: 0.9, bar: 1, beat: 2 },
              { sourceMs: 1_050, confidence: 0.9, bar: 1, beat: 3 },
            ],
          },
        },
      },
    ],
    timeline: {
      ...project.timeline!,
      durationMs: 1_500,
      tracks: [
        {
          ...videoTrack!,
          clips: [
            ...videoTrack!.clips,
            {
              id: 'timeline-clip-3',
              kind: 'video',
              sourceRef: { kind: 'asset', assetId: 'asset-video' },
              sceneId: 'scene-2',
              startMs: 1_000,
              durationMs: 500,
              trimStartMs: 1_000,
              trimEndMs: 1_500,
            },
          ],
        },
        {
          ...musicTrack!,
          clips: [
            { ...musicTrack!.clips[0]!, durationMs: 2_000, trimEndMs: 2_000 },
          ],
        },
      ],
    },
  } as VideoProject;
}

describe('overlay preset catalog + save tools (video-to-template MVP)', () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'video-edit-mcp-'));
    vi.stubEnv('NEUMA_VIDEO_WORKDIR', workDir);
    await writeProject(projectFixture());
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(workDir, { recursive: true, force: true });
  });

  it('lists the overlay catalog with tags and control schemas', async () => {
    const tool = findTool('video_list_overlay_presets');
    const result = await tool.handler({}, {});
    const payload = JSON.parse(result.content[0]?.text ?? '{}');
    expect(payload.schema).toBe('neuma.video.overlay-presets.v1');
    expect(payload.presets.length).toBeGreaterThanOrEqual(60);
    const marker = payload.presets.find(
      (preset: { id: string }) => preset.id === 'html.marker-highlight',
    );
    expect(marker).toMatchObject({
      category: 'callout',
      tags: ['highlight', 'marker', 'sweep', 'emphasis'],
      anchor: 'center',
      taste: {
        intent: 'annotation',
        targets: ['text', 'section'],
        reducedMotion: 'poster',
        motionTokens: { duration: 'base', easing: 'ease-out' },
      },
    });
    expect(marker.taste.bestFor).toContain(
      'highlighting one quoted phrase or key sentence',
    );
    expect(marker.taste.avoidWhen).toContain(
      'the scene already has another attention-grabbing callout',
    );
    expect(marker.controls.map((c: { id: string }) => c.id)).toEqual([
      'text',
      'color',
      'fontSize',
    ]);

    const filtered = await tool.handler({ category: 'screen' }, {});
    const screenPayload = JSON.parse(filtered.content[0]?.text ?? '{}');
    expect(
      screenPayload.presets.every(
        (preset: { category: string }) => preset.category === 'screen',
      ),
    ).toBe(true);
    expect(screenPayload.presets.length).toBeGreaterThanOrEqual(9);
  });

  it('saves a matched preset to the user library with color normalization', async () => {
    const tool = findTool('video_save_overlay_preset');
    const result = await tool.handler(
      {
        name: 'Reference lower third',
        basePresetId: 'html.lower-third-glass',
        controls: {
          title: 'Jane Doe',
          subtitle: 'Product Designer',
          accentColor: 'green',
        },
        loop: 'hold',
      },
      {},
    );
    const payload = JSON.parse(result.content[0]?.text ?? '{}');
    expect(payload.schema).toBe('neuma.video.user-overlay-preset.v1');
    expect(payload.preset).toMatchObject({
      name: 'Reference lower third',
      basePresetId: 'html.lower-third-glass',
      controls: {
        title: 'Jane Doe',
        subtitle: 'Product Designer',
        accentColor: '#008000',
      },
    });

    const { listUserOverlayPresets } =
      await import('@/shared/video/overlays/user-presets');
    expect(await listUserOverlayPresets()).toHaveLength(1);
  });

  it('saves a video-to-template overlay style with transform and provenance', async () => {
    const tool = findTool('video_save_overlay_style_from_template');
    const result = await tool.handler(
      {
        name: 'Reference callout style',
        basePresetId: 'html.marker-highlight',
        controls: {
          text: 'Important',
          color: 'green',
          fontSize: 68,
        },
        loop: 'hold',
        transform: { positionX: 0.42, positionY: 0.58, scale: 1.1 },
        tags: ['reference', 'callout', 'reference'],
        sourceId: 'clip-ref-1',
      },
      {},
    );

    const payload = JSON.parse(result.content[0]?.text ?? '{}');
    expect(payload.schema).toBe('neuma.video.user-overlay-style.v1');
    expect(payload.style).toMatchObject({
      name: 'Reference callout style',
      basePresetId: 'html.marker-highlight',
      controls: {
        text: 'Important',
        color: '#008000',
        fontSize: 68,
      },
      transform: { positionX: 0.42, positionY: 0.58, scale: 1.1 },
      tags: ['reference', 'callout'],
      provenance: {
        kind: 'video-to-template',
        sourceId: 'clip-ref-1',
        createdAt: expect.any(String),
      },
    });

    const { listUserOverlayStyles } =
      await import('@/shared/video/overlays/user-styles');
    expect(await listUserOverlayStyles()).toHaveLength(1);
  });

  it('saves an explicitly approved custom overlay document after lint', async () => {
    const tool = findTool('video_save_user_overlay_document');
    const result = await tool.handler(
      {
        name: 'Custom badge',
        userConfirmed: true,
        html: [
          '<html><head><style>',
          '@keyframes fade { from { opacity: 0; } to { opacity: 1; } }',
          '.badge { animation: fade 1000ms linear both; }',
          '</style></head><body><div class="badge">Live</div>',
          '<script>window.__overlayReady = true;</script></body></html>',
        ].join(''),
        controls: [
          {
            id: 'label',
            type: 'text',
            label: 'Label',
            defaultValue: 'Live',
          },
        ],
        provenanceKind: 'video-to-template',
        sourceId: 'clip-ref-2',
      },
      {},
    );

    const payload = JSON.parse(result.content[0]?.text ?? '{}');
    expect(payload.schema).toBe('neuma.video.user-overlay-document.v1');
    expect(payload.document).toMatchObject({
      name: 'Custom badge',
      provenance: {
        kind: 'video-to-template',
        sourceId: 'clip-ref-2',
        createdAt: expect.any(String),
      },
    });
    expect(payload.document.compiledHtml).toContain('__neumaOverlaySeek');

    const { listUserOverlayDocuments } =
      await import('@/shared/video/overlays/user-documents');
    expect(await listUserOverlayDocuments()).toHaveLength(1);
  });

  it('returns lint issues for invalid custom overlay documents', async () => {
    const tool = findTool('video_save_user_overlay_document');
    const result = await tool.handler(
      {
        name: 'Bad custom',
        userConfirmed: true,
        html: '<script>setTimeout(() => {}); window.__overlayReady = true;</script>',
      },
      {},
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('lint_failed');
    expect(result.content[0]?.text).toContain('no-timers');
  });

  it('returns a proposal instead of saving for external MCP clients', async () => {
    const tool = findTool('video_save_overlay_preset', {
      clientKind: 'external-mcp',
    });
    const result = await tool.handler(
      {
        name: 'Reference lower third',
        basePresetId: 'html.lower-third-glass',
        controls: { title: 'Jane Doe' },
      },
      {},
    );
    const payload = JSON.parse(result.content[0]?.text ?? '{}');
    expect(payload).toMatchObject({
      schema: 'neuma.video.mcp-proposal-required.v1',
      mode: 'proposal-only',
      tool: 'video_save_overlay_preset',
    });

    const { listUserOverlayPresets } =
      await import('@/shared/video/overlays/user-presets');
    expect(await listUserOverlayPresets()).toHaveLength(0);
  });

  it('rejects saves against unknown base presets', async () => {
    const tool = findTool('video_save_overlay_preset');
    const result = await tool.handler(
      { name: 'Nope', basePresetId: 'html.nope', controls: {} },
      {},
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/Unknown base preset/);
  });
});
