/**
 * FFmpeg Service Type Definitions
 *
 * Shared types for FFmpeg operations, probe results, and progress tracking.
 *
 * @module services/ffmpeg/types
 */

// ============================================================================
// Media Probe Types
// ============================================================================

/** Parsed stream info from ffprobe */
export interface StreamInfo {
  index: number;
  codecType: 'video' | 'audio' | 'subtitle' | 'data';
  codecName: string;
  codecLongName?: string;
  width?: number;
  height?: number;
  /** Frames per second (video only) */
  fps?: number;
  pixelFormat?: string;
  colorTransfer?: string;
  colorPrimaries?: string;
  colorSpace?: string;
  sampleRate?: number;
  channels?: number;
  bitRate?: number;
  /** Language tag (e.g. "eng", "chi") */
  language?: string;
  /** Display title metadata */
  title?: string;
}

/** Full probe result from ffprobe */
export interface ProbeResult {
  /** File path that was probed */
  filePath: string;
  /** Duration in seconds */
  duration: number;
  /** File size in bytes */
  size: number;
  /** Overall bitrate in bits/sec */
  bitRate: number;
  /** Container format name (e.g. "mov,mp4,m4a,3gp,3g2,mj2") */
  formatName: string;
  /** Container format long name */
  formatLongName?: string;
  /** Parsed stream information */
  streams: StreamInfo[];
  /** Number of video streams */
  videoStreamCount: number;
  /** Number of audio streams */
  audioStreamCount: number;
  /** Number of subtitle streams */
  subtitleStreamCount: number;
  /** Raw ffprobe JSON (for advanced use) */
  raw: Record<string, unknown>;
}

// ============================================================================
// FFmpeg Operation Types
// ============================================================================

/** Quality presets for transcoding */
export type QualityPreset = 'high' | 'standard' | 'web' | 'mobile';

/** Target resolution presets */
export type ResolutionPreset =
  | '4k'
  | '1080p'
  | '720p'
  | '480p'
  | 'vertical'
  | 'square';

/** Audio format options */
export type AudioFormat = 'mp3' | 'aac' | 'wav' | 'flac' | 'opus';

/** Audio quality presets */
export type AudioQualityPreset = 'high' | 'standard' | 'voice' | 'low';

/** Subtitle mode for embedding */
export type SubtitleMode = 'burn' | 'soft';

// ============================================================================
// FFmpeg Execution Types
// ============================================================================

/** Progress callback data emitted during long operations */
export interface FFmpegProgress {
  /** Percentage complete (0-100), null if duration unknown */
  percent: number | null;
  /** Time processed in seconds */
  timeSeconds: number;
  /** Current frame number (video) */
  frame?: number;
  /** Encoding speed relative to playback (e.g. 2.5 = 2.5x realtime) */
  speed?: number;
  /** Current file size of output in bytes */
  sizeBytes?: number;
  /** Current bitrate in kbits/s */
  bitrateKbps?: number;
}

/** Result from an FFmpeg operation */
export interface FFmpegResult {
  success: boolean;
  /** Output file path */
  outputPath?: string;
  /** Duration of output in seconds (from post-probe) */
  outputDuration?: number;
  /** Output file size in bytes */
  outputSize?: number;
  /** Error message if failed */
  error?: string;
  /** Time taken for the operation in milliseconds */
  elapsedMs: number;
}

/** FFmpeg binary info */
export interface FFmpegBinaryInfo {
  /** Path to ffmpeg binary */
  ffmpegPath: string;
  /** Path to ffprobe binary (may be empty) */
  ffprobePath: string;
  /** FFmpeg version string */
  version: string;
  /** Source of the binary: 'system' or 'ffmpeg-static' */
  source: 'system' | 'ffmpeg-static';
}
