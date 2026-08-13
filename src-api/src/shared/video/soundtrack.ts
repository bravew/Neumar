import { z } from 'zod';

// Neuma port of html-video's ProjectSoundtrack model
// (_sample/html-video/packages/core/src/types/index.ts +
// applySoundtrack in core/src/project.ts).
//
// Field names kept verbatim so future syncs diff cleanly. This module defines
// the data shape + a Zod validator; the mux wiring lives in
// `pipeline.ts::collectSoundtrackAudioTracks` (Phase 5 mux — music + narration
// folded into the existing ffmpeg audio mix). The MiniMax router adapters
// (Music 2.6 / speech-2.6/2.8) are still to come per
// dev-doc/html-video/06-05/05-soundtrack-and-audio.md.

/** Default dB delta applied to music underneath narration. */
export const SOUNDTRACK_DEFAULT_MUSIC_DB = -18;
/** Default narration gain (0 dB = unchanged). */
export const SOUNDTRACK_DEFAULT_NARRATION_DB = 0;

export interface ProjectSoundtrack {
  musicAssetId?: string;
  narrationAssetId?: string;
  /** Music gain in dB. Default -18 (ducked under voice). */
  musicVolumeDb?: number;
  /** Narration gain in dB. Default 0. */
  narrationVolumeDb?: number;
  /** Prompt used to generate the music asset (provenance). */
  musicPrompt?: string;
  /** Stitched full narration script. */
  narrationText?: string;
  /**
   * Per-frame narration keyed by content-graph node id (see Phase 2 IR).
   * Empty string skips narration on a frame.
   */
  narrationByFrame?: Record<string, string>;
  fadeInSec?: number;
  fadeOutSec?: number;
}

export const ProjectSoundtrackSchema = z
  .object({
    musicAssetId: z.string().min(1).optional(),
    narrationAssetId: z.string().min(1).optional(),
    musicVolumeDb: z.number().min(-60).max(12).optional(),
    narrationVolumeDb: z.number().min(-60).max(12).optional(),
    musicPrompt: z.string().optional(),
    narrationText: z.string().optional(),
    narrationByFrame: z.record(z.string(), z.string()).optional(),
    fadeInSec: z.number().min(0).max(30).optional(),
    fadeOutSec: z.number().min(0).max(30).optional(),
  })
  .strict();

/**
 * Default fade-out matches html-video's applySoundtrack: min(1.5s, dur/3).
 * Returns 0 for non-positive durations.
 */
export function defaultSoundtrackFadeOutSec(durationSec: number): number {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return 0;
  return Math.min(1.5, durationSec / 3);
}

/**
 * Resolve gain levels with the model defaults filled in.
 */
export function resolveSoundtrackGains(soundtrack: ProjectSoundtrack): {
  musicVolumeDb: number;
  narrationVolumeDb: number;
} {
  return {
    musicVolumeDb: soundtrack.musicVolumeDb ?? SOUNDTRACK_DEFAULT_MUSIC_DB,
    narrationVolumeDb:
      soundtrack.narrationVolumeDb ?? SOUNDTRACK_DEFAULT_NARRATION_DB,
  };
}
