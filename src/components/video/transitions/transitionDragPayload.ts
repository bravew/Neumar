import {
  isVideoTransitionKind,
  videoTransitionRegistryEntry,
  type VideoTransitionDirection,
  type VideoTransitionKind,
} from '@/shared/types/video';

export const TRANSITION_DRAG_MIME = 'application/x-neuma-video-transition';

export interface TransitionDragPayload {
  type: 'video-transition';
  kind: VideoTransitionKind;
  durationMs?: number;
  direction?: VideoTransitionDirection;
}

export function writeTransitionDrag(
  dataTransfer: DataTransfer,
  payload: TransitionDragPayload,
) {
  dataTransfer.effectAllowed = 'copy';
  dataTransfer.setData(TRANSITION_DRAG_MIME, JSON.stringify(payload));
  dataTransfer.setData('text/plain', `transition:${payload.kind}`);
}

export function hasTransitionDragType(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.types).includes(TRANSITION_DRAG_MIME);
}

export function readTransitionDrag(
  dataTransfer: DataTransfer,
): TransitionDragPayload | null {
  const payload = readJsonPayload(dataTransfer);
  if (payload) return payload;
  const plain = dataTransfer.getData('text/plain');
  if (!plain.startsWith('transition:')) return null;
  const kind = plain.slice('transition:'.length);
  if (!isVideoTransitionKind(kind)) return null;
  return { type: 'video-transition', kind };
}

function readJsonPayload(
  dataTransfer: DataTransfer,
): TransitionDragPayload | null {
  const raw = dataTransfer.getData(TRANSITION_DRAG_MIME);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<TransitionDragPayload>;
    if (parsed.type !== 'video-transition') return null;
    if (!isVideoTransitionKind(parsed.kind)) return null;
    const entry = videoTransitionRegistryEntry(parsed.kind);
    const direction =
      parsed.direction && entry.directions.includes(parsed.direction)
        ? parsed.direction
        : undefined;
    return {
      type: 'video-transition',
      kind: parsed.kind,
      durationMs:
        typeof parsed.durationMs === 'number' ? parsed.durationMs : undefined,
      ...(direction ? { direction } : {}),
    };
  } catch {
    return null;
  }
}
