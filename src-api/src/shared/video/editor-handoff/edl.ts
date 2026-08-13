import { formatEdlTimecode } from './rational-time';
import type { EditorHandoffClip, EditorHandoffModel } from './types';

export function writeEdl(model: EditorHandoffModel): string {
  const primary = model.tracks
    .filter((track) => track.kind === 'video')
    .flatMap((track) => track.clips)
    .filter((clip) => clip.kind === 'video' || clip.kind === 'image')
    .sort((a, b) => a.startMs - b.startMs || a.id.localeCompare(b.id));

  const lines = [`TITLE: ${model.projectName}`, 'FCM: NON-DROP FRAME', ''];
  primary.forEach((clip, index) => {
    lines.push(formatEdlEvent(index + 1, clip, model.fps));
    lines.push(`* FROM CLIP NAME: ${clip.name}`);
  });
  return `${lines.join('\n')}\n`;
}

function formatEdlEvent(
  index: number,
  clip: EditorHandoffClip,
  fps: number,
): string {
  const event = String(index).padStart(3, '0');
  const reel = safeReelName(clip.mediaId ?? clip.id);
  const sourceIn = formatEdlTimecode(clip.sourceStartMs, fps);
  const sourceOut = formatEdlTimecode(clip.sourceEndMs, fps);
  const recordIn = formatEdlTimecode(clip.startMs, fps);
  const recordOut = formatEdlTimecode(clip.endMs, fps);
  return `${event}  ${reel} V     C        ${sourceIn} ${sourceOut} ${recordIn} ${recordOut}`;
}

function safeReelName(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 8)
    .padEnd(3, 'X');
}
