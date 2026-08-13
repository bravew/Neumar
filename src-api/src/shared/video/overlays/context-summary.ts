import {
  isVividOverlayClip,
  parseVividOverlayParams,
  vividOverlayControlDefaults,
  type TimelineClip,
  type VividOverlayControlKeyframeTrack,
  type VividOverlayControlValue,
  type VividOverlayMotionTemplateProvenance,
} from '@neumar/video-ir';

import { findVividOverlayPreset } from './registry';

export interface VividOverlayControlSummary {
  id: string;
  type?: string;
  value: VividOverlayControlValue;
  min?: number;
  max?: number;
  step?: number;
  options?: readonly string[];
  keyframes?: VividOverlayControlKeyframeTrack['keys'];
  keyframeTool?: 'video_set_overlay_control_keyframes';
}

export interface VividOverlayContextSummary {
  presetId: string;
  backend: string;
  loop: string;
  /** Editable controls with resolved current values and their value schema. */
  controls: VividOverlayControlSummary[];
  editTool: 'video_set_overlay_controls';
  motionTemplate?: VividOverlayMotionTemplateProvenance;
}

/**
 * Agent-facing summary of a vivid overlay clip's editable surface. Returned
 * for context reads (Active Editor Context, timeline windows, find results)
 * so the agent can see current control values and mutate them in place
 * instead of replacing the clip.
 */
export function vividOverlayContextSummary(
  clip: TimelineClip,
): VividOverlayContextSummary | undefined {
  if (!isVividOverlayClip(clip)) return undefined;
  const params = parseVividOverlayParams(clip.params);
  if (!params) return undefined;
  const preset = findVividOverlayPreset(params.presetId);
  const values: Record<string, VividOverlayControlValue> = preset
    ? { ...vividOverlayControlDefaults(preset.controls), ...params.controls }
    : params.controls;
  const keyframesByControlId = new Map(
    (params.controlKeyframes ?? []).map((track) => [
      track.controlId,
      track.keys,
    ]),
  );
  const controls: VividOverlayControlSummary[] = preset
    ? preset.controls.map((def) => {
        const keyframes = keyframesByControlId.get(def.id);
        return {
          id: def.id,
          type: def.type,
          value: values[def.id] ?? def.defaultValue,
          min: def.min,
          max: def.max,
          step: def.step,
          options: def.options,
          ...(def.type === 'number'
            ? {
                keyframeTool: 'video_set_overlay_control_keyframes' as const,
                ...(keyframes ? { keyframes } : {}),
              }
            : {}),
        };
      })
    : Object.entries(values).map(([id, value]) => ({ id, value }));
  return {
    presetId: params.presetId,
    backend: params.backend,
    loop: params.loop ?? 'none',
    controls,
    editTool: 'video_set_overlay_controls',
    ...(params.motionTemplate ? { motionTemplate: params.motionTemplate } : {}),
  };
}
