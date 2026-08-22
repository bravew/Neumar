import {
  deriveBeatTimelinePoints,
  type BeatGridArtifact,
} from '@neumar/video-ir';

import type { VideoProject } from '@/shared/types/video';

export function deriveProjectBeatTimelineMs(project: VideoProject): number[] {
  const timeline = project.timeline;
  if (!timeline) return [];
  const grids = (project.analysisArtifacts ?? []).flatMap((artifact) => {
    if (artifact.kind !== 'beat-markers') return [];
    const grid = parseBeatGrid(artifact.metadata?.beatGrid);
    return grid ? [grid] : [];
  });
  const points = grids.flatMap((grid) => {
    const source = project.sources?.find(
      (entry) => entry.id === grid.sourceMediaId,
    );
    if (!source) return [];
    return timeline.tracks.flatMap((track) =>
      track.clips.flatMap((clip) => {
        if (
          clip.kind !== 'audio' ||
          clip.sourceRef.kind !== 'asset' ||
          clip.sourceRef.assetId !== source.mediaItemId
        ) {
          return [];
        }
        return deriveBeatTimelinePoints(grid, clip).map(
          (point) => point.timelineMs,
        );
      }),
    );
  });
  return [...new Set(points.map(Math.round))].sort((a, b) => a - b);
}

function parseBeatGrid(value: unknown): BeatGridArtifact | undefined {
  if (!isRecord(value) || value.schema !== 'neuma.video.beat-grid.v1') {
    return undefined;
  }
  if (
    typeof value.sourceMediaId !== 'string' ||
    typeof value.contentHash !== 'string' ||
    !Array.isArray(value.points)
  ) {
    return undefined;
  }
  const points = value.points.flatMap((point) => {
    if (
      !isRecord(point) ||
      typeof point.sourceMs !== 'number' ||
      typeof point.confidence !== 'number'
    ) {
      return [];
    }
    return [
      {
        sourceMs: point.sourceMs,
        confidence: point.confidence,
        ...(typeof point.bar === 'number' ? { bar: point.bar } : {}),
        ...(typeof point.beat === 'number' ? { beat: point.beat } : {}),
      },
    ];
  });
  return {
    schema: value.schema,
    sourceMediaId: value.sourceMediaId,
    contentHash: value.contentHash,
    ...(typeof value.tempoBpm === 'number' ? { tempoBpm: value.tempoBpm } : {}),
    points,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
