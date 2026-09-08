import { frameRateToNumber } from '@neumar/video-ir';

import { handoffRate } from './handoff-rate';
import type { EditorHandoffModel } from './types';

export function writeOtioJson(model: EditorHandoffModel): string {
  const rate = handoffRate(model);
  // OTIO's `rate` is a real number of frames per second, so 30000/1001 is
  // emitted as 29.97002997..., not as a rounded 30.
  const rateValue = frameRateToNumber(rate);
  return JSON.stringify(
    {
      OTIO_SCHEMA: 'Timeline.1',
      metadata: {
        schema: 'neuma.video.editor-handoff.otio-json.v1',
        projectId: model.projectId,
        packageVersion: model.packageVersion,
        frameRate: { num: rate.num, den: rate.den },
        ...(model.outputRange ? { outputRange: model.outputRange } : {}),
      },
      name: model.projectName,
      tracks: {
        OTIO_SCHEMA: 'Stack.1',
        children: model.tracks.map((track) => ({
          OTIO_SCHEMA: 'Track.1',
          name: track.name,
          kind: track.kind,
          metadata: { trackId: track.id },
          children: track.clips.map((clip) => ({
            OTIO_SCHEMA: 'Clip.2',
            name: clip.name,
            metadata: {
              clipId: clip.id,
              mediaId: clip.mediaId,
              sourceRef: clip.sourceRef,
              keyframes: clip.keyframes,
              conformance: clip.params,
            },
            source_range: {
              OTIO_SCHEMA: 'TimeRange.1',
              start_time: {
                OTIO_SCHEMA: 'RationalTime.1',
                value: Math.round(
                  (clip.sourceStartMs * rate.num) / (1000 * rate.den),
                ),
                rate: rateValue,
              },
              duration: {
                OTIO_SCHEMA: 'RationalTime.1',
                value: Math.round(
                  (clip.durationMs * rate.num) / (1000 * rate.den),
                ),
                rate: rateValue,
              },
            },
          })),
        })),
      },
    },
    null,
    2,
  );
}
