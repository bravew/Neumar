import type { EditorHandoffModel } from './types';

export function writeOtioJson(model: EditorHandoffModel): string {
  return JSON.stringify(
    {
      OTIO_SCHEMA: 'Timeline.1',
      metadata: {
        schema: 'neuma.video.editor-handoff.otio-json.v1',
        projectId: model.projectId,
        packageVersion: model.packageVersion,
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
                value: Math.round((clip.sourceStartMs * model.fps) / 1000),
                rate: model.fps,
              },
              duration: {
                OTIO_SCHEMA: 'RationalTime.1',
                value: Math.round((clip.durationMs * model.fps) / 1000),
                rate: model.fps,
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
