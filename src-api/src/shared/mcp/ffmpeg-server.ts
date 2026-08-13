/**
 * FFmpeg MCP Server
 *
 * Inline MCP server that exposes local media processing tools to the AI agent.
 * All operations use FFmpeg via child_process.spawn with:
 *  - Workspace-confined path validation
 *  - Real-time progress tracking via FFmpeg's -progress pipe
 *  - Structured probe results for intelligent decision-making
 *
 * Tools:
 *   - ffmpeg_probe           — Probe media file for metadata (duration, codecs, resolution)
 *   - ffmpeg_transcode       — Convert between formats with quality presets
 *   - ffmpeg_trim            — Cut a segment from a media file
 *   - ffmpeg_concat          — Merge multiple files into one
 *   - ffmpeg_add_subtitles   — Burn-in or embed subtitle tracks
 *   - ffmpeg_extract_audio   — Extract audio track from video
 *   - ffmpeg_resize          — Scale video to target resolution
 *   - ffmpeg_speed           — Change playback speed
 *   - ffmpeg_extract_frames  — Extract frames/thumbnails from video
 *   - ffmpeg_watermark       — Add text or image watermark
 *   - ffmpeg_normalize_audio — Normalize audio loudness (EBU R128)
 *   - ffmpeg_create_gif      — Create optimized GIF from video
 *   - ffmpeg_check           — Check FFmpeg availability and version
 *
 * @module mcp/ffmpeg-server
 */

import { unlinkSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

import {
  detectBinaries,
  executeFFmpegOperation,
  probeFile,
  resolveOutputPath,
  validateInputFile,
} from '@/shared/services/ffmpeg';

// ============================================================================
// Helpers
// ============================================================================

/** Format bytes to human-readable string */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** Format seconds to HH:MM:SS.s */
function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = (seconds % 60).toFixed(1);
  if (h > 0)
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(4, '0')}`;
  return `${m}:${String(s).padStart(4, '0')}`;
}

/**
 * Escape a string for use inside an FFmpeg filter expression.
 * FFmpeg filter syntax uses : ; ' \ [ ] = as delimiters.
 */
function escapeFilterValue(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/:/g, '\\:')
    .replace(/;/g, '\\;')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]');
}

/**
 * Escape a file path for use in an FFmpeg concat demuxer list.
 * The concat format uses `file 'path'` where single quotes must be escaped.
 */
function escapeConcatPath(filePath: string): string {
  return filePath.replace(/'/g, "'\\''");
}

/** MCP text result helper */
function textResult(text: string, isError = false) {
  return {
    content: [{ type: 'text' as const, text }],
    ...(isError ? { isError: true } : {}),
  };
}

/** CRF values for quality presets (H.264) */
const QUALITY_CRF: Record<string, number> = {
  high: 18,
  standard: 23,
  web: 28,
  mobile: 32,
};

/** Encoder preset speed for quality presets */
const QUALITY_PRESET: Record<string, string> = {
  high: 'slow',
  standard: 'medium',
  web: 'fast',
  mobile: 'veryfast',
};

/** Resolution scale filters */
const RESOLUTION_SCALE: Record<string, string> = {
  '4k': 'scale=3840:-2',
  '1080p': 'scale=1920:-2',
  '720p': 'scale=1280:-2',
  '480p': 'scale=854:-2',
  vertical:
    'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2',
  square:
    'scale=1080:1080:force_original_aspect_ratio=decrease,pad=1080:1080:(ow-iw)/2:(oh-ih)/2',
};

// ============================================================================
// Tool Definitions
// ============================================================================

export const ffmpegTools = [
  // ======================================================================
  // ffmpeg_check — Verify FFmpeg installation
  // ======================================================================
  tool(
    'ffmpeg_check',
    `Check if FFmpeg is installed and available. Returns version info and capabilities.
Call this before performing any media processing to verify the environment is ready.
\nReturns: { binary, version, source, ffprobePath? } or install instructions if not found.`,
    {},
    async () => {
      try {
        const bins = detectBinaries();
        if (!bins) {
          return textResult(
            'FFmpeg is NOT installed.\n\n' +
              'Install instructions:\n' +
              '  macOS:   brew install ffmpeg\n' +
              '  Linux:   sudo apt install ffmpeg\n' +
              '  Windows: choco install ffmpeg',
            true,
          );
        }

        const lines = [
          '**FFmpeg is available**',
          '',
          `  Binary: \`${bins.ffmpegPath}\``,
          `  Version: ${bins.version}`,
          `  Source: ${bins.source}`,
          `  FFprobe: ${bins.ffprobePath ? `\`${bins.ffprobePath}\`` : 'not found (some features limited)'}`,
        ];

        return textResult(lines.join('\n'));
      } catch (error) {
        return textResult(
          `Error checking FFmpeg: ${error instanceof Error ? error.message : String(error)}`,
          true,
        );
      }
    },
  ),

  // ======================================================================
  // ffmpeg_probe — Inspect media file metadata
  // ======================================================================
  tool(
    'ffmpeg_probe',
    `Probe a media file to get detailed metadata: duration, resolution, codecs, bitrate, streams.
ALWAYS call this before any processing operation to understand the input file properties.
This helps choose the right output settings and estimate processing time.
\nReturns: { format, duration, size, bitRate, streams: [{ codecType, codecName, width?, height?, fps?, sampleRate?, channels? }] }`,
    {
      input_file: z
        .string()
        .describe(
          'Path to the media file to probe (relative to workspace or absolute)',
        ),
      work_dir: z.string().describe('Workspace directory for path validation'),
    },
    async ({ input_file, work_dir }) => {
      try {
        const result = await probeFile(input_file, work_dir);
        const videoStream = result.streams.find((s) => s.codecType === 'video');
        const audioStream = result.streams.find((s) => s.codecType === 'audio');

        const lines = [
          `**Media Info: ${input_file}**`,
          '',
          `  Format: ${result.formatName}`,
          `  Duration: ${formatDuration(result.duration)} (${result.duration.toFixed(2)}s)`,
          `  Size: ${formatBytes(result.size)}`,
          `  Bitrate: ${Math.round(result.bitRate / 1000)} kbps`,
          '',
        ];

        if (videoStream) {
          lines.push('  **Video Stream:**');
          lines.push(
            `    Codec: ${videoStream.codecName} (${videoStream.codecLongName || 'N/A'})`,
          );
          if (videoStream.width && videoStream.height) {
            lines.push(
              `    Resolution: ${videoStream.width}x${videoStream.height}`,
            );
          }
          if (videoStream.fps) lines.push(`    FPS: ${videoStream.fps}`);
          if (videoStream.bitRate)
            lines.push(
              `    Bitrate: ${Math.round(videoStream.bitRate / 1000)} kbps`,
            );
          lines.push('');
        }

        if (audioStream) {
          lines.push('  **Audio Stream:**');
          lines.push(
            `    Codec: ${audioStream.codecName} (${audioStream.codecLongName || 'N/A'})`,
          );
          if (audioStream.sampleRate)
            lines.push(`    Sample rate: ${audioStream.sampleRate} Hz`);
          if (audioStream.channels)
            lines.push(`    Channels: ${audioStream.channels}`);
          if (audioStream.language)
            lines.push(`    Language: ${audioStream.language}`);
          lines.push('');
        }

        if (result.subtitleStreamCount > 0) {
          const subs = result.streams.filter((s) => s.codecType === 'subtitle');
          lines.push(`  **Subtitle Streams (${subs.length}):**`);
          for (const sub of subs) {
            lines.push(
              `    [${sub.index}] ${sub.codecName} ${sub.language ? `(${sub.language})` : ''} ${sub.title || ''}`,
            );
          }
          lines.push('');
        }

        lines.push(
          `  Total streams: ${result.streams.length} (${result.videoStreamCount}V / ${result.audioStreamCount}A / ${result.subtitleStreamCount}S)`,
        );

        return textResult(lines.join('\n'));
      } catch (error) {
        return textResult(
          `Probe failed: ${error instanceof Error ? error.message : String(error)}`,
          true,
        );
      }
    },
  ),

  // ======================================================================
  // ffmpeg_transcode — Format conversion with quality presets
  // ======================================================================
  tool(
    'ffmpeg_transcode',
    `Convert a media file to a different format/codec with quality presets.

Quality presets:
  - "high"     (CRF 18, slow)     — Archival, master copy
  - "standard" (CRF 23, medium)   — General purpose (default)
  - "web"      (CRF 28, fast)     — Web delivery, smaller files
  - "mobile"   (CRF 32, veryfast) — Mobile, bandwidth-constrained

Supported output formats: mp4, webm, mov, mkv, mp3, wav, aac, flac
\nReturns: { outputPath, outputSize, outputDuration?, elapsedMs }`,
    {
      input_file: z.string().describe('Path to input media file'),
      output_file: z
        .string()
        .optional()
        .describe('Output file path. Auto-generated if omitted.'),
      work_dir: z.string().describe('Workspace directory for path validation'),
      format: z
        .enum(['mp4', 'webm', 'mov', 'mkv', 'mp3', 'wav', 'aac', 'flac'])
        .optional()
        .describe(
          'Target format. Inferred from output extension if not specified.',
        ),
      quality: z
        .enum(['high', 'standard', 'web', 'mobile'])
        .optional()
        .describe('Quality preset (default: "standard")'),
      video_codec: z
        .string()
        .optional()
        .describe(
          'Video codec override (e.g. "libx264", "libx265", "libvpx-vp9")',
        ),
      audio_codec: z
        .string()
        .optional()
        .describe('Audio codec override (e.g. "aac", "libopus", "libmp3lame")'),
      audio_bitrate: z
        .string()
        .optional()
        .describe('Audio bitrate (e.g. "128k", "192k", "256k")'),
    },
    async ({
      input_file,
      output_file,
      work_dir,
      format,
      quality,
      video_codec,
      audio_codec,
      audio_bitrate,
    }) => {
      try {
        const preset = quality || 'standard';
        const ext = format || 'mp4';
        const outputPath = resolveOutputPath(
          input_file,
          work_dir,
          output_file,
          'transcoded',
          ext,
        );

        const result = await executeFFmpegOperation(
          input_file,
          outputPath,
          work_dir,
          (resolvedInput, resolvedOutput) => {
            const args: string[] = ['-i', resolvedInput];

            // Choose codecs based on target format
            switch (ext) {
              case 'webm':
                args.push(
                  '-c:v',
                  video_codec || 'libvpx-vp9',
                  '-crf',
                  String(QUALITY_CRF[preset]),
                  '-b:v',
                  '0',
                );
                args.push('-c:a', audio_codec || 'libopus');
                break;
              case 'mov':
                args.push(
                  '-c:v',
                  video_codec || 'prores_ks',
                  '-profile:v',
                  '3',
                );
                args.push('-c:a', audio_codec || 'pcm_s16le');
                break;
              case 'mp3':
              case 'wav':
              case 'aac':
              case 'flac':
                // Audio-only formats
                args.push('-vn');
                if (ext === 'mp3')
                  args.push('-c:a', audio_codec || 'libmp3lame', '-q:a', '2');
                else if (ext === 'wav')
                  args.push('-c:a', audio_codec || 'pcm_s16le');
                else if (ext === 'aac')
                  args.push(
                    '-c:a',
                    audio_codec || 'aac',
                    '-b:a',
                    audio_bitrate || '192k',
                  );
                else if (ext === 'flac')
                  args.push('-c:a', audio_codec || 'flac');
                break;
              default:
                // MP4 / MKV — H.264 + AAC
                args.push(
                  '-c:v',
                  video_codec || 'libx264',
                  '-preset',
                  QUALITY_PRESET[preset] ?? 'medium',
                  '-crf',
                  String(QUALITY_CRF[preset] ?? 23),
                );
                args.push(
                  '-c:a',
                  audio_codec || 'aac',
                  '-b:a',
                  audio_bitrate || '128k',
                );
                // Add web streaming optimization for MP4
                if (ext === 'mp4') args.push('-movflags', '+faststart');
                break;
            }

            args.push(resolvedOutput);
            return args;
          },
        );

        if (!result.success)
          return textResult(`Transcode failed: ${result.error}`, true);

        return textResult(
          [
            `Transcoded to **${ext}** (${preset} quality)`,
            `  Output: \`${result.outputPath}\``,
            `  Size: ${formatBytes(result.outputSize || 0)}`,
            result.outputDuration
              ? `  Duration: ${formatDuration(result.outputDuration)}`
              : '',
            `  Time: ${(result.elapsedMs / 1000).toFixed(1)}s`,
          ]
            .filter(Boolean)
            .join('\n'),
        );
      } catch (error) {
        return textResult(
          `Transcode error: ${error instanceof Error ? error.message : String(error)}`,
          true,
        );
      }
    },
  ),

  // ======================================================================
  // ffmpeg_trim — Cut a segment from a media file
  // ======================================================================
  tool(
    'ffmpeg_trim',
    `Cut/trim a segment from a media file by specifying start and/or end times.
Uses stream copy (-c copy) for instant processing when possible.

Time format: seconds (e.g. "90") or HH:MM:SS (e.g. "00:01:30")
\nReturns: { outputPath, outputSize, outputDuration?, elapsedMs }`,
    {
      input_file: z.string().describe('Path to input media file'),
      output_file: z
        .string()
        .optional()
        .describe('Output file path. Auto-generated if omitted.'),
      work_dir: z.string().describe('Workspace directory'),
      start: z
        .string()
        .optional()
        .describe('Start time (e.g. "00:01:30" or "90"). Default: beginning.'),
      end: z
        .string()
        .optional()
        .describe('End time (e.g. "00:03:45" or "225"). Default: end of file.'),
      duration: z
        .string()
        .optional()
        .describe(
          'Duration from start (e.g. "30" for 30 seconds). Alternative to end.',
        ),
      precise: z
        .boolean()
        .optional()
        .describe(
          'Frame-accurate cut (slower, re-encodes). Default: false (fast keyframe cut).',
        ),
    },
    async ({
      input_file,
      output_file,
      work_dir,
      start,
      end,
      duration,
      precise,
    }) => {
      try {
        const outputPath = resolveOutputPath(
          input_file,
          work_dir,
          output_file,
          'trimmed',
        );

        const result = await executeFFmpegOperation(
          input_file,
          outputPath,
          work_dir,
          (ri, ro) => {
            const args: string[] = [];

            if (!precise) {
              // Fast seek: -ss before -i for keyframe-based seeking
              if (start) args.push('-ss', start);
              args.push('-i', ri);
              if (end) args.push('-to', end);
              if (duration) args.push('-t', duration);
              args.push('-c', 'copy');
            } else {
              // Precise seek: -ss after -i for frame-accurate cut (requires re-encode)
              args.push('-i', ri);
              if (start) args.push('-ss', start);
              if (end) args.push('-to', end);
              if (duration) args.push('-t', duration);
              args.push('-c:v', 'libx264', '-crf', '23', '-c:a', 'aac');
            }

            args.push(ro);
            return args;
          },
        );

        if (!result.success)
          return textResult(`Trim failed: ${result.error}`, true);

        return textResult(
          [
            `Trimmed${precise ? ' (frame-accurate)' : ' (fast keyframe cut)'}`,
            `  Output: \`${result.outputPath}\``,
            `  Size: ${formatBytes(result.outputSize || 0)}`,
            result.outputDuration
              ? `  Duration: ${formatDuration(result.outputDuration)}`
              : '',
            `  Time: ${(result.elapsedMs / 1000).toFixed(1)}s`,
          ]
            .filter(Boolean)
            .join('\n'),
        );
      } catch (error) {
        return textResult(
          `Trim error: ${error instanceof Error ? error.message : String(error)}`,
          true,
        );
      }
    },
  ),

  // ======================================================================
  // ffmpeg_concat — Merge multiple files
  // ======================================================================
  tool(
    'ffmpeg_concat',
    `Concatenate/merge multiple media files into one.
If all files have the same codec, uses stream copy (instant). Otherwise re-encodes.
\nReturns: { outputPath, outputSize, outputDuration?, elapsedMs }`,
    {
      input_files: z
        .array(z.string())
        .min(2)
        .describe('Array of file paths to concatenate (in order)'),
      output_file: z
        .string()
        .optional()
        .describe('Output file path. Auto-generated if omitted.'),
      work_dir: z.string().describe('Workspace directory'),
      reencode: z
        .boolean()
        .optional()
        .describe('Force re-encode even if codecs match. Default: false.'),
    },
    async ({ input_files, output_file, work_dir, reencode }) => {
      let concatListPath: string | undefined;
      try {
        // Validate all input files exist
        const resolvedInputs = input_files.map((f) =>
          validateInputFile(f, work_dir),
        );
        const firstInput = resolvedInputs[0]!;
        const outputPath = resolveOutputPath(
          firstInput,
          work_dir,
          output_file,
          'merged',
        );

        // Create the concat list in the current session workspace so source
        // folders from older sessions remain untouched.
        concatListPath = join(work_dir, '.ffmpeg_concat_list.txt');
        const concatContent = resolvedInputs
          .map((f) => `file '${escapeConcatPath(f)}'`)
          .join('\n');
        await writeFile(concatListPath, concatContent, 'utf-8');

        const result = await executeFFmpegOperation(
          concatListPath,
          outputPath,
          work_dir,
          (_ri, ro) => {
            const args = ['-f', 'concat', '-safe', '0', '-i', concatListPath!];
            if (reencode) {
              args.push(
                '-c:v',
                'libx264',
                '-crf',
                '23',
                '-c:a',
                'aac',
                '-b:a',
                '128k',
              );
            } else {
              args.push('-c', 'copy');
            }
            args.push(ro);
            return args;
          },
          { skipInputProbe: true },
        );

        if (!result.success)
          return textResult(`Concat failed: ${result.error}`, true);

        return textResult(
          [
            `Merged ${input_files.length} files${reencode ? ' (re-encoded)' : ' (stream copy)'}`,
            `  Output: \`${result.outputPath}\``,
            `  Size: ${formatBytes(result.outputSize || 0)}`,
            result.outputDuration
              ? `  Duration: ${formatDuration(result.outputDuration)}`
              : '',
            `  Time: ${(result.elapsedMs / 1000).toFixed(1)}s`,
          ]
            .filter(Boolean)
            .join('\n'),
        );
      } catch (error) {
        return textResult(
          `Concat error: ${error instanceof Error ? error.message : String(error)}`,
          true,
        );
      } finally {
        // Cleanup temp concat list file
        if (concatListPath) {
          try {
            unlinkSync(concatListPath);
          } catch {
            /* ignore */
          }
        }
      }
    },
  ),

  // ======================================================================
  // ffmpeg_add_subtitles — Burn-in or embed subtitles
  // ======================================================================
  tool(
    'ffmpeg_add_subtitles',
    `Add subtitles to a video. Supports:
  - "burn" mode: Permanently render subtitles into the video (works in any player)
  - "soft" mode: Embed as a toggleable track (user can enable/disable in player)

Accepts SRT and ASS/SSA subtitle files.`,
    {
      input_file: z.string().describe('Path to input video file'),
      subtitle_file: z
        .string()
        .describe('Path to subtitle file (.srt or .ass)'),
      output_file: z
        .string()
        .optional()
        .describe('Output file path. Auto-generated if omitted.'),
      work_dir: z.string().describe('Workspace directory'),
      mode: z
        .enum(['burn', 'soft'])
        .describe('"burn" = hardcoded into video, "soft" = toggleable track'),
      language: z
        .string()
        .optional()
        .describe('Language code for soft subs (e.g. "eng", "chi", "spa")'),
      title: z
        .string()
        .optional()
        .describe('Display title for the subtitle track (e.g. "English")'),
      font_size: z
        .number()
        .optional()
        .describe('Font size for burn-in subtitles (default: 24)'),
    },
    async ({
      input_file,
      subtitle_file,
      output_file,
      work_dir,
      mode,
      language,
      title,
      font_size,
    }) => {
      try {
        const resolvedSubs = validateInputFile(subtitle_file, work_dir);
        const suffix = mode === 'burn' ? 'hardsubbed' : 'softsubbed';
        const outputPath = resolveOutputPath(
          input_file,
          work_dir,
          output_file,
          suffix,
        );

        const result = await executeFFmpegOperation(
          input_file,
          outputPath,
          work_dir,
          (ri, ro) => {
            const args: string[] = [];

            if (mode === 'burn') {
              // Burn-in: use -vf subtitles filter (requires re-encode)
              const isSsa =
                resolvedSubs.endsWith('.ass') || resolvedSubs.endsWith('.ssa');
              const escapedSubPath = escapeFilterValue(resolvedSubs);
              const filter = isSsa
                ? `ass=${escapedSubPath}`
                : font_size
                  ? `subtitles=${escapedSubPath}:force_style='FontSize=${font_size}'`
                  : `subtitles=${escapedSubPath}`;
              args.push('-i', ri, '-vf', filter, '-c:a', 'copy', ro);
            } else {
              // Soft subs: embed as a track
              args.push('-i', ri, '-i', resolvedSubs);
              args.push('-c', 'copy', '-c:s', 'mov_text');
              if (language)
                args.push('-metadata:s:s:0', `language=${language}`);
              if (title) args.push('-metadata:s:s:0', `title=${title}`);
              args.push(ro);
            }

            return args;
          },
        );

        if (!result.success)
          return textResult(`Subtitle add failed: ${result.error}`, true);

        return textResult(
          [
            `Subtitles added (${mode} mode)`,
            `  Output: \`${result.outputPath}\``,
            `  Size: ${formatBytes(result.outputSize || 0)}`,
            `  Time: ${(result.elapsedMs / 1000).toFixed(1)}s`,
          ].join('\n'),
        );
      } catch (error) {
        return textResult(
          `Subtitle error: ${error instanceof Error ? error.message : String(error)}`,
          true,
        );
      }
    },
  ),

  // ======================================================================
  // ffmpeg_extract_audio — Extract audio track from video
  // ======================================================================
  tool(
    'ffmpeg_extract_audio',
    `Extract the audio track from a video file.

Supported output formats:
  - mp3  — Universal, lossy (VBR quality 2 ≈ 190 kbps)
  - aac  — Modern, efficient lossy
  - wav  — Lossless, large (good for further processing)
  - flac — Lossless, compressed (good for archival)
  - opus — Very efficient lossy (best for voice/speech)`,
    {
      input_file: z.string().describe('Path to input video file'),
      output_file: z
        .string()
        .optional()
        .describe('Output file path. Auto-generated if omitted.'),
      work_dir: z.string().describe('Workspace directory'),
      format: z
        .enum(['mp3', 'aac', 'wav', 'flac', 'opus'])
        .optional()
        .describe('Audio format (default: "mp3")'),
      quality: z
        .enum(['high', 'standard', 'voice', 'low'])
        .optional()
        .describe('Quality preset (default: "standard")'),
    },
    async ({ input_file, output_file, work_dir, format, quality }) => {
      try {
        const fmt = format || 'mp3';
        const qual = quality || 'standard';
        const outputPath = resolveOutputPath(
          input_file,
          work_dir,
          output_file,
          'audio',
          fmt,
        );

        // Audio quality settings per format and preset
        const qualityArgs: Record<string, Record<string, string[]>> = {
          mp3: {
            high: ['-c:a', 'libmp3lame', '-q:a', '0'],
            standard: ['-c:a', 'libmp3lame', '-q:a', '2'],
            voice: ['-c:a', 'libmp3lame', '-q:a', '5'],
            low: ['-c:a', 'libmp3lame', '-q:a', '7'],
          },
          aac: {
            high: ['-c:a', 'aac', '-b:a', '256k'],
            standard: ['-c:a', 'aac', '-b:a', '192k'],
            voice: ['-c:a', 'aac', '-b:a', '96k'],
            low: ['-c:a', 'aac', '-b:a', '64k'],
          },
          wav: {
            high: ['-c:a', 'pcm_s16le'],
            standard: ['-c:a', 'pcm_s16le'],
            voice: ['-c:a', 'pcm_s16le'],
            low: ['-c:a', 'pcm_s16le'],
          },
          flac: {
            high: ['-c:a', 'flac'],
            standard: ['-c:a', 'flac'],
            voice: ['-c:a', 'flac'],
            low: ['-c:a', 'flac'],
          },
          opus: {
            high: ['-c:a', 'libopus', '-b:a', '192k'],
            standard: ['-c:a', 'libopus', '-b:a', '128k'],
            voice: ['-c:a', 'libopus', '-b:a', '64k'],
            low: ['-c:a', 'libopus', '-b:a', '32k'],
          },
        };

        const result = await executeFFmpegOperation(
          input_file,
          outputPath,
          work_dir,
          (ri, ro) => {
            const codecArgs = qualityArgs[fmt]?.[qual] ?? [
              '-c:a',
              'libmp3lame',
              '-q:a',
              '2',
            ];
            const args = ['-i', ri, '-vn', ...codecArgs, ro];
            return args;
          },
        );

        if (!result.success)
          return textResult(`Audio extraction failed: ${result.error}`, true);

        return textResult(
          [
            `Audio extracted as **${fmt}** (${qual} quality)`,
            `  Output: \`${result.outputPath}\``,
            `  Size: ${formatBytes(result.outputSize || 0)}`,
            result.outputDuration
              ? `  Duration: ${formatDuration(result.outputDuration)}`
              : '',
            `  Time: ${(result.elapsedMs / 1000).toFixed(1)}s`,
          ]
            .filter(Boolean)
            .join('\n'),
        );
      } catch (error) {
        return textResult(
          `Audio extraction error: ${error instanceof Error ? error.message : String(error)}`,
          true,
        );
      }
    },
  ),

  // ======================================================================
  // ffmpeg_resize — Scale video to target resolution
  // ======================================================================
  tool(
    'ffmpeg_resize',
    `Resize/scale a video to a target resolution.

Presets: "4k", "1080p", "720p", "480p", "vertical" (9:16 for TikTok/Reels), "square" (1:1 for Instagram)
Custom: Provide width and/or height for custom dimensions.

Letterboxing (black bars) is added when using "vertical" or "square" presets to preserve aspect ratio.`,
    {
      input_file: z.string().describe('Path to input video file'),
      output_file: z
        .string()
        .optional()
        .describe('Output file path. Auto-generated if omitted.'),
      work_dir: z.string().describe('Workspace directory'),
      resolution: z
        .enum(['4k', '1080p', '720p', '480p', 'vertical', 'square'])
        .optional()
        .describe('Resolution preset'),
      width: z
        .number()
        .optional()
        .describe('Custom width in pixels (height auto-calculated)'),
      height: z
        .number()
        .optional()
        .describe('Custom height in pixels (width auto-calculated)'),
    },
    async ({
      input_file,
      output_file,
      work_dir,
      resolution,
      width,
      height,
    }) => {
      try {
        const suffix = resolution || `${width || ''}x${height || ''}`;
        const outputPath = resolveOutputPath(
          input_file,
          work_dir,
          output_file,
          suffix,
        );

        const result = await executeFFmpegOperation(
          input_file,
          outputPath,
          work_dir,
          (ri, ro) => {
            let scaleFilter: string;

            if (resolution) {
              scaleFilter = RESOLUTION_SCALE[resolution] ?? 'scale=1920:-2';
            } else if (width && height) {
              scaleFilter = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`;
            } else if (width) {
              scaleFilter = `scale=${width}:-2`;
            } else if (height) {
              scaleFilter = `scale=-2:${height}`;
            } else {
              scaleFilter = 'scale=1920:-2'; // Default to 1080p
            }

            return ['-i', ri, '-vf', scaleFilter, '-c:a', 'copy', ro];
          },
        );

        if (!result.success)
          return textResult(`Resize failed: ${result.error}`, true);

        return textResult(
          [
            `Resized to **${resolution || `${width || 'auto'}x${height || 'auto'}`}**`,
            `  Output: \`${result.outputPath}\``,
            `  Size: ${formatBytes(result.outputSize || 0)}`,
            `  Time: ${(result.elapsedMs / 1000).toFixed(1)}s`,
          ].join('\n'),
        );
      } catch (error) {
        return textResult(
          `Resize error: ${error instanceof Error ? error.message : String(error)}`,
          true,
        );
      }
    },
  ),

  // ======================================================================
  // ffmpeg_speed — Change playback speed
  // ======================================================================
  tool(
    'ffmpeg_speed',
    `Change the playback speed of a video (with audio pitch adjustment).
Supports 0.25x to 4x speed. Audio tempo is automatically adjusted.`,
    {
      input_file: z.string().describe('Path to input media file'),
      output_file: z
        .string()
        .optional()
        .describe('Output file path. Auto-generated if omitted.'),
      work_dir: z.string().describe('Workspace directory'),
      speed: z
        .number()
        .min(0.25)
        .max(4.0)
        .describe(
          'Speed multiplier (e.g. 2.0 = double speed, 0.5 = half speed)',
        ),
      keep_audio: z
        .boolean()
        .optional()
        .describe('Keep and adjust audio. Default: true.'),
    },
    async ({ input_file, output_file, work_dir, speed, keep_audio }) => {
      try {
        const suffix = speed > 1 ? `${speed}x_fast` : `${speed}x_slow`;
        const outputPath = resolveOutputPath(
          input_file,
          work_dir,
          output_file,
          suffix,
        );

        const result = await executeFFmpegOperation(
          input_file,
          outputPath,
          work_dir,
          (ri, ro) => {
            const pts = 1 / speed; // setpts multiplier
            const includeAudio = keep_audio !== false;

            if (!includeAudio) {
              return ['-i', ri, '-vf', `setpts=${pts}*PTS`, '-an', ro];
            }

            // Build atempo chain: atempo only supports 0.5-2.0, so chain for larger factors
            const buildAtempoChain = (factor: number): string => {
              const filters: string[] = [];
              let remaining = factor;
              while (remaining > 2.0) {
                filters.push('atempo=2.0');
                remaining /= 2.0;
              }
              while (remaining < 0.5) {
                filters.push('atempo=0.5');
                remaining /= 0.5;
              }
              filters.push(`atempo=${remaining.toFixed(4)}`);
              return filters.join(',');
            };

            const atempoChain = buildAtempoChain(speed);
            return [
              '-i',
              ri,
              '-filter_complex',
              `[0:v]setpts=${pts}*PTS[v];[0:a]${atempoChain}[a]`,
              '-map',
              '[v]',
              '-map',
              '[a]',
              ro,
            ];
          },
        );

        if (!result.success)
          return textResult(`Speed change failed: ${result.error}`, true);

        return textResult(
          [
            `Speed changed to **${speed}x**`,
            `  Output: \`${result.outputPath}\``,
            `  Size: ${formatBytes(result.outputSize || 0)}`,
            result.outputDuration
              ? `  Duration: ${formatDuration(result.outputDuration)}`
              : '',
            `  Time: ${(result.elapsedMs / 1000).toFixed(1)}s`,
          ]
            .filter(Boolean)
            .join('\n'),
        );
      } catch (error) {
        return textResult(
          `Speed change error: ${error instanceof Error ? error.message : String(error)}`,
          true,
        );
      }
    },
  ),

  // ======================================================================
  // ffmpeg_extract_frames — Extract frames/thumbnails
  // ======================================================================
  tool(
    'ffmpeg_extract_frames',
    `Extract frames or thumbnails from a video.

Modes:
  - "single"    — One frame at a specific timestamp
  - "periodic"  — One frame every N seconds
  - "keyframes" — Only I-frames (very fast)
  - "thumbnail" — Best-quality frame from near a timestamp
  - "contact"   — Contact sheet / thumbnail grid
\nReturns: { outputPath, elapsedMs }`,
    {
      input_file: z.string().describe('Path to input video file'),
      output_file: z
        .string()
        .optional()
        .describe(
          'Output path (for single/thumbnail). For periodic/keyframes, this is a directory.',
        ),
      work_dir: z.string().describe('Workspace directory'),
      mode: z
        .enum(['single', 'periodic', 'keyframes', 'thumbnail', 'contact'])
        .describe('Extraction mode'),
      timestamp: z
        .string()
        .optional()
        .describe(
          'Timestamp for single/thumbnail mode (e.g. "00:00:10" or "10")',
        ),
      interval: z
        .number()
        .optional()
        .describe('Seconds between frames for periodic mode (default: 1)'),
      grid: z
        .string()
        .optional()
        .describe('Grid layout for contact mode (e.g. "4x4"). Default: "4x4"'),
      format: z
        .enum(['png', 'jpg'])
        .optional()
        .describe('Image format (default: "jpg")'),
    },
    async ({
      input_file,
      output_file,
      work_dir,
      mode,
      timestamp,
      interval,
      grid,
      format,
    }) => {
      try {
        const imgExt = format || 'jpg';

        const result = await executeFFmpegOperation(
          input_file,
          // For periodic/keyframes, output_file is used as prefix pattern
          mode === 'single' || mode === 'thumbnail' || mode === 'contact'
            ? resolveOutputPath(input_file, work_dir, output_file, mode, imgExt)
            : resolveOutputPath(
                input_file,
                work_dir,
                output_file,
                `${mode}_%04d`,
                imgExt,
              ),
          work_dir,
          (ri, ro) => {
            switch (mode) {
              case 'single':
                return [
                  '-i',
                  ri,
                  '-ss',
                  timestamp || '0',
                  '-frames:v',
                  '1',
                  '-q:v',
                  '2',
                  ro,
                ];
              case 'thumbnail':
                return [
                  '-i',
                  ri,
                  '-ss',
                  timestamp || '5',
                  '-frames:v',
                  '1',
                  '-q:v',
                  '2',
                  ro,
                ];
              case 'periodic':
                return ['-i', ri, '-vf', `fps=1/${interval || 1}`, ro];
              case 'keyframes':
                return [
                  '-i',
                  ri,
                  '-vf',
                  "select='eq(pict_type,I)'",
                  '-fps_mode',
                  'vfr',
                  ro,
                ];
              case 'contact': {
                const gridLayout = grid || '4x4';
                return [
                  '-i',
                  ri,
                  '-vf',
                  `select='not(mod(n,300))',scale=320:-2,tile=${gridLayout}`,
                  '-frames:v',
                  '1',
                  ro,
                ];
              }
              default:
                return ['-i', ri, '-frames:v', '1', ro];
            }
          },
        );

        if (!result.success)
          return textResult(`Frame extraction failed: ${result.error}`, true);

        return textResult(
          [
            `Frames extracted (${mode} mode)`,
            `  Output: \`${result.outputPath}\``,
            `  Time: ${(result.elapsedMs / 1000).toFixed(1)}s`,
          ].join('\n'),
        );
      } catch (error) {
        return textResult(
          `Frame extraction error: ${error instanceof Error ? error.message : String(error)}`,
          true,
        );
      }
    },
  ),

  // ======================================================================
  // ffmpeg_watermark — Add text or image watermark
  // ======================================================================
  tool(
    'ffmpeg_watermark',
    `Add a watermark to a video. Supports text or image overlays with customizable position and opacity.`,
    {
      input_file: z.string().describe('Path to input video file'),
      output_file: z
        .string()
        .optional()
        .describe('Output file path. Auto-generated if omitted.'),
      work_dir: z.string().describe('Workspace directory'),
      text: z
        .string()
        .optional()
        .describe(
          'Text to overlay (e.g. "© 2026 Company"). Mutually exclusive with image_file.',
        ),
      image_file: z
        .string()
        .optional()
        .describe(
          'Path to watermark image (PNG recommended). Mutually exclusive with text.',
        ),
      position: z
        .enum([
          'top-left',
          'top-right',
          'bottom-left',
          'bottom-right',
          'center',
        ])
        .optional()
        .describe('Watermark position (default: "bottom-right")'),
      opacity: z
        .number()
        .min(0)
        .max(1)
        .optional()
        .describe('Opacity (0-1, default: 0.5)'),
      font_size: z
        .number()
        .optional()
        .describe('Font size for text watermark (default: 24)'),
    },
    async ({
      input_file,
      output_file,
      work_dir,
      text,
      image_file,
      position,
      opacity,
      font_size,
    }) => {
      try {
        if (!text && !image_file) {
          return textResult(
            'Either text or image_file must be provided.',
            true,
          );
        }

        const outputPath = resolveOutputPath(
          input_file,
          work_dir,
          output_file,
          'watermarked',
        );
        const alpha = opacity ?? 0.5;
        const pos = position || 'bottom-right';

        // Position coordinates mapping
        const posMap: Record<string, { x: string; y: string }> = {
          'top-left': { x: '10', y: '10' },
          'top-right': { x: 'W-w-10', y: '10' },
          'bottom-left': { x: '10', y: 'H-h-10' },
          'bottom-right': { x: 'W-w-10', y: 'H-h-10' },
          center: { x: '(W-w)/2', y: '(H-h)/2' },
        };
        // Text position uses lowercase w/h
        const textPosMap: Record<string, { x: string; y: string }> = {
          'top-left': { x: '10', y: '10' },
          'top-right': { x: 'w-tw-10', y: '10' },
          'bottom-left': { x: '10', y: 'h-th-10' },
          'bottom-right': { x: 'w-tw-10', y: 'h-th-10' },
          center: { x: '(w-tw)/2', y: '(h-th)/2' },
        };

        const result = await executeFFmpegOperation(
          input_file,
          outputPath,
          work_dir,
          (ri, ro) => {
            if (text) {
              const coords = textPosMap[pos] ?? { x: 'w-tw-10', y: 'h-th-10' };
              const size = font_size || 24;
              const escapedText = escapeFilterValue(text);
              const filter = `drawtext=text='${escapedText}':fontsize=${size}:fontcolor=white@${alpha}:x=${coords.x}:y=${coords.y}`;
              return ['-i', ri, '-vf', filter, '-c:a', 'copy', ro];
            } else {
              // Image watermark
              const resolvedImage = validateInputFile(image_file!, work_dir);
              const coords = posMap[pos] ?? { x: 'W-w-10', y: 'H-h-10' };
              const filter = `[1:v]format=rgba,colorchannelmixer=aa=${alpha}[wm];[0:v][wm]overlay=${coords.x}:${coords.y}`;
              return [
                '-i',
                ri,
                '-i',
                resolvedImage,
                '-filter_complex',
                filter,
                '-c:a',
                'copy',
                ro,
              ];
            }
          },
        );

        if (!result.success)
          return textResult(`Watermark failed: ${result.error}`, true);

        return textResult(
          [
            `Watermark added (${text ? 'text' : 'image'}, ${pos})`,
            `  Output: \`${result.outputPath}\``,
            `  Size: ${formatBytes(result.outputSize || 0)}`,
            `  Time: ${(result.elapsedMs / 1000).toFixed(1)}s`,
          ].join('\n'),
        );
      } catch (error) {
        return textResult(
          `Watermark error: ${error instanceof Error ? error.message : String(error)}`,
          true,
        );
      }
    },
  ),

  // ======================================================================
  // ffmpeg_normalize_audio — EBU R128 loudness normalization
  // ======================================================================
  tool(
    'ffmpeg_normalize_audio',
    `Normalize audio loudness using the EBU R128 standard (-16 LUFS).
Good for making audio levels consistent across different media files.`,
    {
      input_file: z.string().describe('Path to input media file'),
      output_file: z
        .string()
        .optional()
        .describe('Output file path. Auto-generated if omitted.'),
      work_dir: z.string().describe('Workspace directory'),
      target_lufs: z
        .number()
        .optional()
        .describe('Target loudness in LUFS (default: -16, broadcast standard)'),
      volume: z
        .number()
        .optional()
        .describe(
          'Simple volume multiplier as alternative (e.g. 1.5 = 50% louder). Overrides LUFS normalization.',
        ),
    },
    async ({ input_file, output_file, work_dir, target_lufs, volume }) => {
      try {
        const outputPath = resolveOutputPath(
          input_file,
          work_dir,
          output_file,
          'normalized',
        );
        const lufs = target_lufs ?? -16;

        const result = await executeFFmpegOperation(
          input_file,
          outputPath,
          work_dir,
          (ri, ro) => {
            if (volume !== undefined) {
              return ['-i', ri, '-af', `volume=${volume}`, '-c:v', 'copy', ro];
            }
            return [
              '-i',
              ri,
              '-af',
              `loudnorm=I=${lufs}:TP=-1.5:LRA=11`,
              '-c:v',
              'copy',
              ro,
            ];
          },
        );

        if (!result.success)
          return textResult(
            `Audio normalization failed: ${result.error}`,
            true,
          );

        return textResult(
          [
            volume !== undefined
              ? `Volume adjusted (${volume}x)`
              : `Audio normalized to **${lufs} LUFS** (EBU R128)`,
            `  Output: \`${result.outputPath}\``,
            `  Size: ${formatBytes(result.outputSize || 0)}`,
            `  Time: ${(result.elapsedMs / 1000).toFixed(1)}s`,
          ].join('\n'),
        );
      } catch (error) {
        return textResult(
          `Audio normalization error: ${error instanceof Error ? error.message : String(error)}`,
          true,
        );
      }
    },
  ),

  // ======================================================================
  // ffmpeg_create_gif — Create optimized GIF from video
  // ======================================================================
  tool(
    'ffmpeg_create_gif',
    `Create an optimized GIF from a video file or segment.
Uses palette optimization for high-quality, reasonable-size GIFs.
\nReturns: { outputPath, outputSize, elapsedMs }`,
    {
      input_file: z.string().describe('Path to input video file'),
      output_file: z
        .string()
        .optional()
        .describe('Output GIF path. Auto-generated if omitted.'),
      work_dir: z.string().describe('Workspace directory'),
      start: z
        .string()
        .optional()
        .describe('Start time (e.g. "00:00:05" or "5")'),
      duration: z
        .string()
        .optional()
        .describe('Duration in seconds (e.g. "3")'),
      fps: z
        .number()
        .optional()
        .describe('Frames per second (default: 15, max: 30)'),
      width: z
        .number()
        .optional()
        .describe(
          'Output width in pixels (default: 480, height auto-calculated)',
        ),
    },
    async ({
      input_file,
      output_file,
      work_dir,
      start,
      duration,
      fps,
      width,
    }) => {
      try {
        const outputPath = resolveOutputPath(
          input_file,
          work_dir,
          output_file,
          'gif',
          'gif',
        );
        const gifFps = Math.min(fps || 15, 30);
        const gifWidth = width || 480;

        const result = await executeFFmpegOperation(
          input_file,
          outputPath,
          work_dir,
          (ri, ro) => {
            const args: string[] = [];
            if (start) args.push('-ss', start);
            if (duration) args.push('-t', duration);
            args.push(
              '-i',
              ri,
              '-vf',
              `fps=${gifFps},scale=${gifWidth}:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse`,
              ro,
            );
            return args;
          },
        );

        if (!result.success)
          return textResult(`GIF creation failed: ${result.error}`, true);

        return textResult(
          [
            `GIF created (${gifFps}fps, ${gifWidth}px wide)`,
            `  Output: \`${result.outputPath}\``,
            `  Size: ${formatBytes(result.outputSize || 0)}`,
            `  Time: ${(result.elapsedMs / 1000).toFixed(1)}s`,
          ].join('\n'),
        );
      } catch (error) {
        return textResult(
          `GIF creation error: ${error instanceof Error ? error.message : String(error)}`,
          true,
        );
      }
    },
  ),
];

// ============================================================================
// Export
// ============================================================================

/** All FFmpeg tool names for allowedTools registration */
export const FFMPEG_TOOL_NAMES = ffmpegTools.map((t) => t.name);

/** Create the FFmpeg MCP server instance */
export function createFFmpegMcpServer() {
  return createSdkMcpServer({
    name: 'ffmpeg-processing',
    version: '1.0.0',
    tools: ffmpegTools,
  });
}
