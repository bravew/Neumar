import { describe, expect, it } from 'vitest';

import {
  agentActionToToolCall,
  toolCallToAgentAction,
} from '@/components/video/agentToolMapping';
import type { AgentActionRecord } from '@/components/video/useAgentDock';

describe('agentActionToToolCall', () => {
  it('maps legacy add scene actions to the journaled tool schema', () => {
    expect(
      agentActionToToolCall(
        action('addScene', {
          afterSceneId: 'scene-1',
          plan: {
            intent: 'Show the dashboard',
            durationMs: 2500,
            caption: { text: 'Built for operators' },
          },
        }),
      ),
    ).toEqual({
      name: 'addScene',
      reasoning: 'Add scene',
      args: {
        afterSceneId: 'scene-1',
        intent: 'Show the dashboard',
        durationMs: 2500,
        captionText: 'Built for operators',
      },
    });
  });

  it('keeps side-effect actions on the existing execution path', () => {
    expect(
      agentActionToToolCall(
        action('render', { aspectRatio: '16:9', mode: 'speed' }),
      ),
    ).toBeNull();
  });

  it('uses the action rationale as journal reasoning when present', () => {
    expect(
      agentActionToToolCall({
        ...action('setCaption', {
          sceneId: 'scene-1',
          text: 'New caption',
        }),
        reasoning: {
          rationale: 'The user asked for a shorter caption.',
          considered: ['Scene caption'],
        },
      }),
    ).toMatchObject({
      name: 'setCaption',
      reasoning: 'The user asked for a shorter caption.',
    });
  });

  it('maps advanced transition specs', () => {
    expect(
      agentActionToToolCall(
        action('setTransition', {
          sceneId: 'scene-1',
          transition: 'cube',
          direction: 'from-left',
          durationMs: 700,
        }),
      ),
    ).toEqual({
      name: 'setTransition',
      reasoning: 'Add scene',
      args: {
        sceneId: 'scene-1',
        transition: {
          kind: 'cube',
          direction: 'from-left',
          durationMs: 700,
        },
      },
    });
  });

  it('maps render verification actions to the journaled tool schema', () => {
    expect(
      agentActionToToolCall(
        action('verifyRender', {
          outputPath: '/workspace/render.mp4',
          maxIterations: 2,
        }),
      ),
    ).toEqual({
      name: 'verifyRender',
      reasoning: 'Add scene',
      args: {
        outputPath: '/workspace/render.mp4',
        maxIterations: 2,
      },
    });
  });

  it('maps timeline bookend and audio seam actions', () => {
    expect(
      agentActionToToolCall(
        action('setTimelineBookend', {
          position: 'intro',
          durationMs: 500,
        }),
      ),
    ).toEqual({
      name: 'setTimelineBookend',
      reasoning: 'Add scene',
      args: {
        position: 'intro',
        kind: 'fade',
        durationMs: 500,
      },
    });
    expect(
      agentActionToToolCall(
        action('clearTimelineBookend', { position: 'outro' }),
      ),
    ).toMatchObject({
      name: 'clearTimelineBookend',
      args: { position: 'outro' },
    });
    expect(
      agentActionToToolCall(
        action('setClipAudioSeam', { clipId: 'clip-1', mode: 'cut' }),
      ),
    ).toMatchObject({
      name: 'setClipAudioSeam',
      args: { clipId: 'clip-1', mode: 'cut' },
    });
  });

  it('maps timeline op actions to the canonical op tool', () => {
    expect(
      agentActionToToolCall(
        action('applyTimelineOp', {
          op: {
            kind: 'clip.move',
            clipId: 'clip-1',
            from: { trackId: 'track-video', startMs: 0 },
            to: { trackId: 'track-video', startMs: 500 },
          },
          summary: 'Move the hook later',
        }),
      ),
    ).toEqual({
      name: 'applyTimelineOp',
      reasoning: 'Add scene',
      args: {
        op: {
          kind: 'clip.move',
          clipId: 'clip-1',
          from: { trackId: 'track-video', startMs: 0 },
          to: { trackId: 'track-video', startMs: 500 },
        },
        summary: 'Move the hook later',
      },
    });
  });

  it('maps timeline op batch actions to the canonical batch tool', () => {
    expect(
      agentActionToToolCall(
        action('applyTimelineOps', {
          ops: [
            {
              kind: 'clip.removeTimeRange',
              trackId: 'track-video',
              startMs: 1200,
              endMs: 1800,
              magnetic: true,
            },
          ],
          summary: 'Cut selected transcript text',
          rippleImpact: { downstreamClipCount: 2, shiftMs: -600 },
        }),
      ),
    ).toEqual({
      name: 'applyTimelineOps',
      reasoning: 'Add scene',
      args: {
        ops: [
          {
            kind: 'clip.removeTimeRange',
            trackId: 'track-video',
            startMs: 1200,
            endMs: 1800,
            magnetic: true,
          },
        ],
        summary: 'Cut selected transcript text',
      },
    });
  });

  it('maps keyframe actions to the canonical keyframe tool', () => {
    expect(
      agentActionToToolCall(
        action('setKeyframes', {
          clipId: 'clip-1',
          property: 'opacity',
          keys: [
            { atMs: 0, value: 0, interp: 'linear' },
            { atMs: 500, value: 1 },
          ],
          summary: 'Fade in clip',
        }),
      ),
    ).toEqual({
      name: 'setKeyframes',
      reasoning: 'Add scene',
      args: {
        clipId: 'clip-1',
        property: 'opacity',
        keys: [
          { atMs: 0, value: 0, interp: 'linear' },
          { atMs: 500, value: 1 },
        ],
        summary: 'Fade in clip',
      },
    });
  });
});

describe('toolCallToAgentAction', () => {
  it('maps AG-UI video-edit tool results to completed action cards', () => {
    expect(
      toolCallToAgentAction(
        'mcp__video-edit__video_set_caption',
        { sceneId: 'scene-1', text: 'Shorter caption' },
        {
          entry: {
            diffSummary: 'Updated scene caption.',
          },
        },
        { id: 'tool-1' },
      ),
    ).toMatchObject({
      id: 'tool-1',
      name: 'setCaption',
      status: 'completed',
      requiresApproval: false,
      summary: 'Updated scene caption.',
      args: { sceneId: 'scene-1', text: 'Shorter caption' },
    });
  });

  it('accepts raw PTC tool names', () => {
    expect(
      toolCallToAgentAction(
        'video_apply_timeline_op',
        { op: { kind: 'clip.trim', clipId: 'clip-1' } },
        {},
      ),
    ).toMatchObject({
      name: 'applyTimelineOp',
      status: 'completed',
    });
  });

  it('maps timeline transition seam tool results to timeline op cards', () => {
    const result = toolCallToAgentAction(
      'mcp__video-edit__video_set_timeline_transition',
      {
        seamId: 'seam:track-video:clip-1:clip-2',
        transition: { kind: 'fade', durationMs: 500 },
      },
      {
        summary: 'Set fade transition between A and B',
        op: {
          kind: 'clip.setTransition',
          clipId: 'clip-1',
          before: null,
          after: { kind: 'fade', durationMs: 500 },
        },
      },
    );

    expect(result).toMatchObject({
      name: 'applyTimelineOp',
      summary: 'Set fade transition between A and B',
      args: {
        seamId: 'seam:track-video:clip-1:clip-2',
        op: {
          kind: 'clip.setTransition',
          clipId: 'clip-1',
          before: null,
          after: { kind: 'fade', durationMs: 500 },
        },
      },
    });
  });

  it('maps transition suggestion results to timeline op batch cards', () => {
    const result = toolCallToAgentAction(
      'mcp__video-edit__video_suggest_timeline_transitions',
      { intentText: 'Make this smoother' },
      {
        summary: 'Propose 1 timeline transition change',
        suggestions: [
          {
            seamId: 'seam:track-video:clip-1:clip-2',
            op: {
              kind: 'clip.setTransition',
              clipId: 'clip-1',
              before: null,
              after: { kind: 'fade', durationMs: 500 },
            },
          },
        ],
      },
    );

    expect(result).toMatchObject({
      name: 'applyTimelineOps',
      args: {
        intentText: 'Make this smoother',
        ops: [
          {
            kind: 'clip.setTransition',
            clipId: 'clip-1',
            before: null,
            after: { kind: 'fade', durationMs: 500 },
          },
        ],
      },
    });
  });

  it('maps media-generation tools for approval cards', () => {
    expect(
      toolCallToAgentAction(
        'media_generate_image',
        { prompt: 'red cow energy drink', count: 4 },
        { message: 'Execute media_generate_image' },
        { status: 'pending' },
      ),
    ).toMatchObject({
      name: 'generateImage',
      status: 'pending',
      summary: 'Execute media_generate_image',
    });
  });

  it('maps media_generate_video as a pending generative action', () => {
    expect(
      toolCallToAgentAction(
        'media_generate_video',
        { prompt: 'product reveal', duration_sec: 5 },
        { message: 'Execute media_generate_video' },
        { status: 'pending' },
      ),
    ).toMatchObject({
      name: 'generateVideo',
      status: 'pending',
    });
  });

  // Tool name → expected action name per VIDEO_TOOL_ACTIONS in
  // agentToolMapping.ts. Updating these only when the lookup table changes.
  it.each([
    ['video_generate_music', 'generateMusic'],
    ['video_generate_voiceover', 'addNarration'],
    ['video_render', 'render'],
    ['video_cancel_render', 'cancelRender'],
    ['video_search_assets', 'searchLinkedAssets'],
    ['video_attach_asset', 'attachAsset'],
    ['video_regenerate_scene', 'regenerateScene'],
    ['video_apply_timeline_ops', 'applyTimelineOps'],
    ['video_set_timeline_transition', 'applyTimelineOp'],
    ['video_update_timeline_transition', 'applyTimelineOp'],
    ['video_remove_timeline_transition', 'applyTimelineOp'],
    ['video_suggest_timeline_transitions', 'applyTimelineOps'],
    ['video_cut_clip', 'applyTimelineOps'],
    ['video_duplicate_clips', 'applyTimelineOps'],
    ['video_set_clip_speed', 'applyTimelineOps'],
    ['video_close_gap', 'applyTimelineOps'],
    ['video_set_keyframes', 'setKeyframes'],
  ])('maps %s to %s action', (toolName, expectedName) => {
    const result = toolCallToAgentAction(
      `mcp__video-edit__${toolName}`,
      {},
      {},
      { id: `tool-${toolName}` },
    );
    expect(result?.name).toBe(expectedName);
  });
});

function action(
  name: AgentActionRecord['name'],
  args: Record<string, unknown>,
): AgentActionRecord {
  return {
    id: `${name}-1`,
    type: 'action',
    name,
    args,
    summary: 'Add scene',
    requiresApproval: true,
    status: 'pending',
  };
}
