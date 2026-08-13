/**
 * FFmpeg Service — Public API
 *
 * Re-exports all public types and functions for the FFmpeg service.
 *
 * @module services/ffmpeg
 */

export type {
  AudioFormat,
  AudioQualityPreset,
  FFmpegBinaryInfo,
  FFmpegProgress,
  FFmpegResult,
  ProbeResult,
  QualityPreset,
  ResolutionPreset,
  StreamInfo,
  SubtitleMode,
} from './types';

export {
  clearBinaryCache,
  detectBinaries,
  executeFFmpegOperation,
  probeFile,
  resolveOutputPath,
  runFFmpeg,
  validateInputFile,
  validatePath,
} from './executor';
