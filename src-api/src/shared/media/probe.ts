import fs from 'node:fs/promises';
import path from 'node:path';

import { probeFile, type ProbeResult } from '@/shared/services/ffmpeg';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('MediaProbe');

export interface MediaMetadata {
  durationMs: number;
  width?: number;
  height?: number;
  frameRate?: number;
  codec?: string;
  pixelFormat?: string;
  colorTransfer?: string;
  colorPrimaries?: string;
  colorSpace?: string;
  sampleRate?: number;
  channels?: number;
  fileSize?: number;
  audioTrackCount?: number;
  /**
   * When the media was originally captured (ISO 8601), from the container's
   * `creation_time` tag. Used to order a montage chronologically rather than
   * by attach order. Absent when the tag is missing or obviously bogus.
   */
  capturedAt?: string;
  /**
   * Capture location (decimal degrees) parsed from the container's ISO-6709
   * `location` tag, when present. Used for location-based montage grouping.
   */
  gps?: { lat: number; lng: number };
}

export async function readMediaMetadata(
  filePath: string,
  workspaceRoot: string,
): Promise<MediaMetadata> {
  try {
    return probeToMediaMetadata(await probeFile(filePath, workspaceRoot));
  } catch (error) {
    const stat = await fs.stat(filePath);
    logger.warn('media.probe_failed', {
      file: path.basename(filePath),
      error: error instanceof Error ? error.message : String(error),
    });
    return { durationMs: 0, fileSize: stat.size };
  }
}

export function probeToMediaMetadata(probe: ProbeResult): MediaMetadata {
  const video = probe.streams.find((stream) => stream.codecType === 'video');
  const audio = probe.streams.find((stream) => stream.codecType === 'audio');
  return {
    durationMs: Math.round(probe.duration * 1000),
    width: video?.width,
    height: video?.height,
    frameRate: video?.fps,
    codec: video?.codecName ?? audio?.codecName ?? probe.formatName,
    pixelFormat: video?.pixelFormat,
    colorTransfer: video?.colorTransfer,
    colorPrimaries: video?.colorPrimaries,
    colorSpace: video?.colorSpace,
    sampleRate: audio?.sampleRate,
    channels: audio?.channels,
    fileSize: probe.size,
    audioTrackCount: probe.audioStreamCount,
    capturedAt: extractCreationTime(probe),
    gps: extractGps(probe),
  };
}

// Parse the ISO-6709 `location` tag muxers (notably QuickTime/iPhone) write,
// e.g. `+37.7858-122.4064/` or `+27.5916+086.5640+8850/`. Returns the first
// lat/lng pair; altitude and trailing components are ignored.
const ISO6709 = /^([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)/;

function extractGps(
  probe: ProbeResult,
): { lat: number; lng: number } | undefined {
  const raw = probe.raw as
    | { format?: { tags?: Record<string, string> }; streams?: unknown[] }
    | undefined;
  const tagSets: (Record<string, string> | undefined)[] = [raw?.format?.tags];
  for (const stream of raw?.streams ?? []) {
    tagSets.push((stream as { tags?: Record<string, string> }).tags);
  }
  for (const tags of tagSets) {
    if (!tags) continue;
    const value =
      tags.location ??
      tags['com.apple.quicktime.location.ISO6709'] ??
      tags['location-eng'];
    const match = value ? ISO6709.exec(value.trim()) : null;
    if (!match) continue;
    const lat = Number(match[1]);
    const lng = Number(match[2]);
    if (
      Number.isFinite(lat) &&
      Number.isFinite(lng) &&
      Math.abs(lat) <= 90 &&
      Math.abs(lng) <= 180
    ) {
      return { lat, lng };
    }
  }
  return undefined;
}

// Pull a usable capture timestamp out of the ffprobe `creation_time` tag
// (container format tag first, then any stream tag). ffmpeg frequently
// stamps a placeholder epoch (1970) on remuxed files, so anything at or
// before 1971 is treated as missing.
function extractCreationTime(probe: ProbeResult): string | undefined {
  const raw = probe.raw as
    | { format?: { tags?: Record<string, string> }; streams?: unknown[] }
    | undefined;
  const candidates: (string | undefined)[] = [raw?.format?.tags?.creation_time];
  for (const stream of raw?.streams ?? []) {
    const tags = (stream as { tags?: Record<string, string> }).tags;
    if (tags?.creation_time) candidates.push(tags.creation_time);
  }
  for (const value of candidates) {
    if (!value) continue;
    const ms = Date.parse(value);
    if (Number.isNaN(ms)) continue;
    // Reject the 1970/1971 placeholder ffmpeg writes for missing dates.
    if (new Date(ms).getUTCFullYear() <= 1971) continue;
    return new Date(ms).toISOString();
  }
  return undefined;
}
