import type { Timeline } from './timeline-types.js';

export interface SnapTarget {
  ms: number;
  kind:
    | 'playhead'
    | 'clip-start'
    | 'clip-end'
    | 'range-edge'
    | 'marker'
    | 'beat';
  refId?: string;
}

export function computeSnapTargets(
  timeline: Timeline,
  ctx: {
    playheadMs?: number;
    rangeMs?: [number, number];
    beats?: Array<{ ms: number; refId?: string }>;
  },
): SnapTarget[] {
  const targets: SnapTarget[] = [];
  if (typeof ctx.playheadMs === 'number') {
    targets.push({ ms: ctx.playheadMs, kind: 'playhead' });
  }
  if (ctx.rangeMs) {
    targets.push({ ms: ctx.rangeMs[0], kind: 'range-edge' });
    targets.push({ ms: ctx.rangeMs[1], kind: 'range-edge' });
  }
  for (const beat of ctx.beats ?? []) {
    targets.push({ ms: beat.ms, kind: 'beat', refId: beat.refId });
  }
  for (const marker of timeline.markers ?? []) {
    targets.push({ ms: marker.timeMs, kind: 'marker', refId: marker.id });
  }
  for (const track of timeline.tracks) {
    for (const clip of track.clips) {
      targets.push({ ms: clip.startMs, kind: 'clip-start', refId: clip.id });
      targets.push({
        ms: clip.startMs + clip.durationMs,
        kind: 'clip-end',
        refId: clip.id,
      });
    }
  }
  return dedupeTargets(targets).sort(compareSnapTargets);
}

export function snapMs(
  value: number,
  targets: readonly SnapTarget[],
  toleranceMs: number,
): { ms: number; snappedTo?: SnapTarget } {
  let best: { target: SnapTarget; distance: number } | undefined;
  for (const target of targets) {
    const distance = Math.abs(target.ms - value);
    if (distance > toleranceMs) continue;
    if (
      !best ||
      distance < best.distance ||
      (distance === best.distance &&
        compareSnapTargets(target, best.target) < 0)
    ) {
      best = { target, distance };
    }
  }
  return best ? { ms: best.target.ms, snappedTo: best.target } : { ms: value };
}

function dedupeTargets(targets: readonly SnapTarget[]): SnapTarget[] {
  const seen = new Set<string>();
  const deduped: SnapTarget[] = [];
  for (const target of targets) {
    const key = `${target.ms}:${target.kind}:${target.refId ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(target);
  }
  return deduped;
}

function compareSnapTargets(left: SnapTarget, right: SnapTarget): number {
  return (
    left.ms - right.ms ||
    kindRank(left.kind) - kindRank(right.kind) ||
    (left.refId ?? '').localeCompare(right.refId ?? '')
  );
}

function kindRank(kind: SnapTarget['kind']): number {
  switch (kind) {
    case 'playhead':
      return 0;
    case 'range-edge':
      return 1;
    case 'marker':
      return 2;
    case 'beat':
      return 3;
    case 'clip-start':
      return 4;
    case 'clip-end':
      return 5;
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}
