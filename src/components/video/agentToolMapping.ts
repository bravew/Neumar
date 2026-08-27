import {
  isVideoTransitionKind,
  normalizeVideoTransition,
  type VideoAgentToolCallInput,
  type VideoTimelineTransition,
  type VideoTransitionDirection,
} from '@/shared/types/video';
import { randomUUID } from '@/shared/utils/uuid';

import type { AgentActionName, AgentActionRecord } from './useAgentDock';

const VIDEO_TOOL_ACTIONS: Record<string, AgentActionName> = {
  video_regenerate_scene: 'regenerateScene',
  video_add_scene: 'addScene',
  video_remove_scene: 'removeScene',
  video_set_transition: 'setTransition',
  video_set_timeline_transition: 'applyTimelineOp',
  video_update_timeline_transition: 'applyTimelineOp',
  video_remove_timeline_transition: 'applyTimelineOp',
  video_suggest_timeline_transitions: 'applyTimelineOps',
  video_set_timeline_bookend: 'setTimelineBookend',
  video_clear_timeline_bookend: 'clearTimelineBookend',
  video_set_clip_audio_seam: 'setClipAudioSeam',
  video_apply_timeline_op: 'applyTimelineOp',
  video_apply_timeline_ops: 'applyTimelineOps',
  video_cut_clip: 'applyTimelineOps',
  video_cut_range: 'applyTimelineOps',
  video_duplicate_clips: 'applyTimelineOps',
  video_delete_clips: 'applyTimelineOps',
  video_move_clips: 'applyTimelineOps',
  video_set_clip_speed: 'applyTimelineOps',
  video_reverse_clip: 'applyTimelineOps',
  video_rotate_clip: 'applyTimelineOps',
  video_flip_clip: 'applyTimelineOps',
  video_set_clip_transform: 'applyTimelineOps',
  video_apply_overlay_motion_template: 'applyTimelineOps',
  video_close_gap: 'applyTimelineOps',
  video_set_audio_clip_gain: 'applyTimelineOps',
  video_set_audio_clip_mute: 'applyTimelineOps',
  video_set_audio_clip_fade: 'applyTimelineOps',
  video_set_audio_track_volume: 'applyTimelineOps',
  video_set_audio_track_mute: 'applyTimelineOps',
  video_set_audio_transition: 'applyTimelineOps',
  video_crossfade_audio_clips: 'applyTimelineOps',
  video_set_audio_volume_keyframes: 'applyTimelineOps',
  video_replace_audio_clip_source: 'applyTimelineOps',
  video_duck_audio: 'applyTimelineOps',
  video_set_keyframes: 'setKeyframes',
  video_set_caption: 'setCaption',
  media_generate_image: 'generateImage',
  media_generate_video: 'generateVideo',
  video_generate_music: 'generateMusic',
  video_generate_voiceover: 'addNarration',
  video_render: 'render',
  video_cancel_render: 'cancelRender',
  video_verify_render: 'verifyRender',
  video_get_handoff_conformance: 'getHandoffConformance',
  video_export_editor_handoff: 'exportEditorHandoff',
  video_search_assets: 'searchLinkedAssets',
  video_attach_asset: 'attachAsset',
};

export function agentActionToToolCall(
  action: AgentActionRecord,
): VideoAgentToolCallInput | null {
  const reasoning = action.reasoning?.rationale ?? action.summary;
  switch (action.name) {
    case 'addScene': {
      const plan = getRecord(action.args, 'plan') ?? {};
      const caption = getRecord(plan, 'caption');
      return {
        name: 'addScene',
        reasoning,
        args: {
          afterSceneId: getString(action.args, 'afterSceneId'),
          intent: getString(plan, 'intent') ?? action.summary,
          durationMs: getNumber(plan, 'durationMs') ?? 3000,
          captionText: caption ? getString(caption, 'text') : undefined,
        },
      };
    }
    case 'removeScene':
      return {
        name: 'removeScene',
        reasoning,
        args: { sceneId: requireString(action, 'sceneId') },
      };
    case 'setTransition':
      return {
        name: 'setTransition',
        reasoning,
        args: {
          sceneId: requireString(action, 'sceneId'),
          transition: readTransition(action),
        },
      };
    case 'setTimelineBookend':
      return {
        name: 'setTimelineBookend',
        reasoning,
        args: {
          position: readBookendPosition(action),
          kind: 'fade',
          durationMs: getNumber(action.args, 'durationMs') ?? 500,
        },
      };
    case 'clearTimelineBookend':
      return {
        name: 'clearTimelineBookend',
        reasoning,
        args: { position: readBookendPosition(action) },
      };
    case 'setClipAudioSeam':
      return {
        name: 'setClipAudioSeam',
        reasoning,
        args: {
          clipId: requireString(action, 'clipId'),
          mode: readAudioSeamMode(action),
        },
      };
    case 'applyTimelineOp':
      return {
        name: 'applyTimelineOp',
        reasoning,
        args: {
          op: getRecord(action.args, 'op') ?? action.args,
          summary: getString(action.args, 'summary') ?? action.summary,
        },
      };
    case 'applyTimelineOps':
      return {
        name: 'applyTimelineOps',
        reasoning,
        args: {
          ops: getRecordArray(action.args, 'ops') ?? [],
          summary: getString(action.args, 'summary') ?? action.summary,
        },
      };
    case 'setKeyframes':
      return {
        name: 'setKeyframes',
        reasoning,
        args: {
          clipId: requireString(action, 'clipId'),
          property: requireString(action, 'property'),
          keys: getRecordArray(action.args, 'keys') ?? [],
          summary: getString(action.args, 'summary') ?? action.summary,
        },
      };
    case 'setCaption':
      return {
        name: 'setCaption',
        reasoning,
        args: {
          sceneId: requireString(action, 'sceneId'),
          text: requireString(action, 'text'),
        },
      };
    case 'verifyRender':
      return {
        name: 'verifyRender',
        reasoning,
        args: {
          outputPath: getString(action.args, 'outputPath'),
          maxIterations: getNumber(action.args, 'maxIterations') ?? 3,
        },
      };
    default:
      return null;
  }
}

export function toolCallToAgentAction(
  toolName: string,
  args: unknown,
  result: unknown,
  options: { id?: string; status?: AgentActionRecord['status'] } = {},
): AgentActionRecord | null {
  const normalizedToolName = normalizeToolName(toolName);
  const actionName = VIDEO_TOOL_ACTIONS[normalizedToolName];
  if (!actionName) return null;
  const resultRecord = isRecord(result) ? result : undefined;
  const entry = getRecord(resultRecord ?? {}, 'entry');
  const summary =
    getString(entry ?? {}, 'diffSummary') ??
    getString(resultRecord ?? {}, 'summary') ??
    getString(resultRecord ?? {}, 'message') ??
    actionSummary(actionName);
  const resolvedArgs = actionArgsFromToolResult(
    normalizedToolName,
    actionName,
    args,
    resultRecord,
    summary,
  );
  return {
    id: options.id ?? randomUUID(),
    type: 'action',
    name: actionName,
    args: resolvedArgs,
    summary,
    requiresApproval: false,
    status:
      resultRecord?.committed === true &&
      (resultRecord.error || resultRecord.isError)
        ? 'partial'
        : (options.status ??
          (resultRecord?.error || resultRecord?.isError
            ? 'failed'
            : 'completed')),
    error: getString(resultRecord ?? {}, 'error'),
  };
}

function actionArgsFromToolResult(
  toolName: string,
  actionName: AgentActionName,
  args: unknown,
  result: Record<string, unknown> | undefined,
  summary: string,
): Record<string, unknown> {
  const baseArgs = isRecord(args) ? args : {};
  if (actionName === 'applyTimelineOp' && isTimelineTransitionTool(toolName)) {
    const op = getRecord(result ?? {}, 'op');
    return op ? { ...baseArgs, op, summary } : baseArgs;
  }
  if (toolName === 'video_suggest_timeline_transitions') {
    const ops =
      getRecordArray(result ?? {}, 'suggestions')
        ?.map((suggestion) => getRecord(suggestion, 'op'))
        .filter(isRecord) ?? [];
    return ops.length > 0 ? { ...baseArgs, ops, summary } : baseArgs;
  }
  return baseArgs;
}

function isTimelineTransitionTool(toolName: string): boolean {
  return (
    toolName === 'video_set_timeline_transition' ||
    toolName === 'video_update_timeline_transition' ||
    toolName === 'video_remove_timeline_transition'
  );
}

function requireString(action: AgentActionRecord, key: string): string {
  const value = getString(action.args, key);
  if (!value) throw new Error(`${key} required`);
  return value;
}

function readTransition(action: AgentActionRecord): VideoTimelineTransition {
  const value =
    getString(action.args, 'transition') ??
    getString(action.args, 'kind') ??
    getString(action.args, 'transitionKind');
  const kind = isVideoTransitionKind(value) ? value : 'cut';
  const direction = readTransitionDirection(action.args);
  const durationMs = getNumber(action.args, 'durationMs');
  if (!direction && durationMs == null) return kind;
  return normalizeVideoTransition({
    kind,
    direction,
    durationMs,
  } satisfies VideoTimelineTransition);
}

function readTransitionDirection(
  args: Record<string, unknown>,
): VideoTransitionDirection | undefined {
  const value = getString(args, 'direction');
  return value === 'from-left' ||
    value === 'from-right' ||
    value === 'from-top' ||
    value === 'from-bottom'
    ? value
    : undefined;
}

function readBookendPosition(action: AgentActionRecord): 'intro' | 'outro' {
  const value = getString(action.args, 'position');
  if (value === 'intro' || value === 'outro') return value;
  throw new Error('position required');
}

function readAudioSeamMode(action: AgentActionRecord): 'follow' | 'cut' {
  const value = getString(action.args, 'mode');
  return value === 'cut' ? value : 'follow';
}

function getString(
  value: Record<string, unknown>,
  key: string,
): string | undefined {
  const item = value[key];
  return typeof item === 'string' ? item : undefined;
}

function getNumber(
  value: Record<string, unknown>,
  key: string,
): number | undefined {
  const item = value[key];
  return typeof item === 'number' && Number.isFinite(item) ? item : undefined;
}

function getRecord(
  value: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const item = value[key];
  return Boolean(item) && typeof item === 'object' && !Array.isArray(item)
    ? (item as Record<string, unknown>)
    : undefined;
}

function getRecordArray(
  value: Record<string, unknown>,
  key: string,
): Record<string, unknown>[] | undefined {
  const item = value[key];
  if (!Array.isArray(item)) return undefined;
  const records = item.filter(isRecord);
  return records.length === item.length ? records : undefined;
}

function normalizeToolName(toolName: string): string {
  if (toolName.startsWith('mcp__video-edit__')) {
    return toolName.slice('mcp__video-edit__'.length);
  }
  return toolName;
}

function actionSummary(name: AgentActionName): string {
  return name.replace(/([A-Z])/g, ' $1').trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
