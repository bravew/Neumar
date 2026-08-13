import type { EditorHandoffModel } from './types';

export interface EditorHandoffCutList {
  schema: 'neuma.video.editor-handoff.cut-list.v1';
  projectId: string;
  fps: number;
  durationMs: number;
  cuts: Array<{
    trackId: string;
    clipId: string;
    name: string;
    kind: string;
    startMs: number;
    endMs: number;
    sourceStartMs: number;
    sourceEndMs: number;
    mediaId?: string;
  }>;
}

export function buildCutList(model: EditorHandoffModel): EditorHandoffCutList {
  return {
    schema: 'neuma.video.editor-handoff.cut-list.v1',
    projectId: model.projectId,
    fps: model.fps,
    durationMs: model.durationMs,
    cuts: model.tracks
      .flatMap((track) =>
        track.clips.map((clip) => ({
          trackId: track.id,
          clipId: clip.id,
          name: clip.name,
          kind: clip.kind,
          startMs: clip.startMs,
          endMs: clip.endMs,
          sourceStartMs: clip.sourceStartMs,
          sourceEndMs: clip.sourceEndMs,
          mediaId: clip.mediaId,
        })),
      )
      .sort(
        (a, b) => a.startMs - b.startMs || a.clipId.localeCompare(b.clipId),
      ),
  };
}
