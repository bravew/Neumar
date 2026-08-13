import { formatSrtTime } from './rational-time';
import type { EditorHandoffClip, EditorHandoffModel } from './types';

export function writeCaptionsSrt(model: EditorHandoffModel): string {
  const captions = model.tracks
    .flatMap((track) => track.clips)
    .filter(
      (clip): clip is EditorHandoffClip & { text: string } =>
        clip.kind === 'caption' && Boolean(clip.text),
    )
    .sort((a, b) => a.startMs - b.startMs || a.id.localeCompare(b.id));

  return captions
    .map((clip, index) =>
      [
        String(index + 1),
        `${formatSrtTime(clip.startMs)} --> ${formatSrtTime(clip.endMs)}`,
        clip.text,
      ].join('\n'),
    )
    .join('\n\n');
}
