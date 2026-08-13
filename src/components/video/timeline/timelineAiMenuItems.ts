import { KeyRound, Music, Sparkles } from 'lucide-react';

import type {
  VideoAgentToolCallInput,
  VideoTimelineClip,
  VideoTimelineTrack,
  VideoVisualTimelineClip,
} from '@/shared/types/video';

import type { TimelineActionMenuItem } from './TimelineActionMenu';
import type { TimelineTrackLabels } from './TimelineLabels';

export function timelineAiClipMenuItems({
  clip,
  labels,
  onApplyAgentTool,
  track,
}: {
  clip: VideoTimelineClip;
  labels: TimelineTrackLabels;
  onApplyAgentTool?: (
    input: VideoAgentToolCallInput,
  ) => Promise<unknown> | unknown;
  track: VideoTimelineTrack;
}): TimelineActionMenuItem[] {
  const disabled = !onApplyAgentTool;
  return [
    {
      id: 'ai-edit-clip',
      label: labels.aiEditClip,
      icon: Sparkles,
      disabled: disabled || !isVisualClip(clip),
      onSelect: () => {
        void onApplyAgentTool?.({
          name: 'applyTimelineOps',
          reasoning: `Apply an AI-assisted visual adjustment to clip ${clip.id}.`,
          args: {
            ops: [
              {
                kind: 'clip.setTransform',
                clipId: clip.id,
                before: isVisualClip(clip) ? (clip.transforms ?? null) : null,
                after: {
                  ...(isVisualClip(clip) ? (clip.transforms ?? {}) : {}),
                  opacity: 0.92,
                },
              },
            ],
            summary: `Apply subtle visual emphasis to clip ${clip.id}`,
          },
        });
      },
    },
    {
      id: 'ai-generate-music',
      label: labels.aiGenerateMusic,
      icon: Music,
      disabled: disabled || track.kind !== 'audio-music',
      onSelect: () => {
        void onApplyAgentTool?.({
          name: 'generateMusic',
          reasoning: `Generate a music bed for ${clip.durationMs}ms.`,
          args: {
            mood: clip.name ?? 'cinematic bed',
            durationMs: clip.durationMs,
          },
        });
      },
    },
    {
      id: 'ai-set-keyframes',
      label: labels.aiSetKeyframes,
      icon: KeyRound,
      disabled,
      onSelect: () => {
        void onApplyAgentTool?.({
          name: 'setKeyframes',
          reasoning: `Add a fade keyframe pair to clip ${clip.id}.`,
          args: {
            clipId: clip.id,
            property: clip.kind === 'audio' ? 'volumeDb' : 'opacity',
            keys:
              clip.kind === 'audio'
                ? [
                    { atMs: 0, value: -12, interp: 'linear' },
                    { atMs: clip.durationMs, value: 0 },
                  ]
                : [
                    { atMs: 0, value: 0, interp: 'linear' },
                    { atMs: Math.min(500, clip.durationMs), value: 1 },
                  ],
            summary: `Set fade keyframes on clip ${clip.id}`,
          },
        });
      },
    },
  ];
}

function isVisualClip(
  clip: VideoTimelineClip,
): clip is VideoVisualTimelineClip {
  return (
    clip.kind === 'video' || clip.kind === 'image' || clip.kind === 'overlay'
  );
}
