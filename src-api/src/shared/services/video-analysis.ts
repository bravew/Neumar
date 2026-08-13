/**
 * Video Analysis Service
 *
 * Analyzes video content by piping it to a vision-capable LLM (Gemini via
 * OpenRouter). If the file exceeds the configurable size limit, it is
 * automatically transcoded to a smaller resolution/bitrate via FFmpeg.
 *
 * Provider priority: OpenRouter (video_url content type) > Google Gemini direct.
 *
 * @module services/video-analysis
 */

import { randomUUID } from 'node:crypto';
import { existsSync, statSync, unlinkSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';

import { getAppDir } from '@/config/constants';

import { getSetting } from '@/shared/db/operations';
import {
  probeFile,
  runFFmpeg,
  validateInputFile,
} from '@/shared/services/ffmpeg/executor';
import { createLogger } from '@/shared/utils/logger';
import { validateBaseUrlForFetch } from '@/shared/utils/url-validator';

const logger = createLogger('VideoAnalysis');

// ============================================================================
// Constants
// ============================================================================

/** Default maximum video file size in MB before transcoding is triggered */
const DEFAULT_MAX_SIZE_MB = 20;

/**
 * Pattern for vision-capable Gemini models that accept video input.
 * Gemini 2.0 Flash models shut down 2026-06-01, so they are intentionally
 * excluded — matching one would route analysis to a dead model.
 */
const VISION_MODEL_PATTERN = /gemini-2\.5|gemini-3/i;

/** Request timeout for the vision API call (3 minutes — video analysis is slow) */
const REQUEST_TIMEOUT_MS = 180_000;

/** MIME types for common video extensions */
const VIDEO_MIME_MAP: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.mkv': 'video/x-matroska',
  '.m4v': 'video/mp4',
  '.flv': 'video/x-flv',
  '.wmv': 'video/x-ms-wmv',
  '.ts': 'video/mp2t',
  '.3gp': 'video/3gpp',
};

// ============================================================================
// Types
// ============================================================================

export interface VideoAnalysisResult {
  success: boolean;
  provider?: string;
  model?: string;
  analysis?: string;
  originalSizeMB?: number;
  analyzedSizeMB?: number;
  wasTranscoded?: boolean;
  error?: string;
}

interface ProviderInfo {
  name: string;
  apiKey: string;
  baseUrl: string;
  model: string;
}

// ============================================================================
// Provider Discovery
// ============================================================================

/**
 * Discover a vision-capable provider from synced settings.
 * Priority: OpenRouter > Google Gemini direct.
 */
async function discoverVisionProvider(
  preferredProvider?: string,
  preferredModel?: string,
): Promise<ProviderInfo | null> {
  const raw = getSetting('providers');
  if (!raw) {
    logger.info('No providers setting found — cannot discover vision provider');
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
    if (typeof parsed === 'string') parsed = JSON.parse(parsed);
  } catch {
    logger.error('Invalid JSON in providers setting');
    return null;
  }

  if (!Array.isArray(parsed)) return null;

  const providers = (parsed as unknown[]).filter(
    (
      p,
    ): p is {
      id: string;
      name: string;
      apiKey: string;
      baseUrl: string;
      enabled: boolean;
      models: string[];
    } =>
      typeof p === 'object' &&
      p !== null &&
      'id' in p &&
      'apiKey' in p &&
      'baseUrl' in p &&
      typeof (p as Record<string, unknown>).apiKey === 'string' &&
      typeof (p as Record<string, unknown>).baseUrl === 'string' &&
      !!(p as Record<string, unknown>).apiKey &&
      !!(p as Record<string, unknown>).baseUrl &&
      (p as Record<string, unknown>).enabled !== false,
  );

  // If user specified a provider, try that first
  if (preferredProvider) {
    const match = providers.find(
      (p) =>
        p.id.toLowerCase() === preferredProvider.toLowerCase() ||
        p.name.toLowerCase() === preferredProvider.toLowerCase(),
    );
    if (match) {
      const model =
        preferredModel ??
        match.models.find((m) => VISION_MODEL_PATTERN.test(m));
      if (model) {
        const urlCheck = await validateBaseUrlForFetch(match.baseUrl, 'POST');
        if (urlCheck.valid) {
          return {
            name: match.name,
            apiKey: match.apiKey,
            baseUrl: match.baseUrl.replace(/\/+$/, ''),
            model,
          };
        }
      }
    }
  }

  // Auto-discover: prefer OpenRouter, then Gemini direct
  const priorityOrder = [
    /openrouter\.ai/i,
    /googleapis\.com|generativelanguage\.google/i,
  ];

  for (const urlPattern of priorityOrder) {
    for (const p of providers) {
      if (!urlPattern.test(p.baseUrl)) continue;

      const urlCheck = await validateBaseUrlForFetch(p.baseUrl, 'POST');
      if (!urlCheck.valid) continue;

      const model =
        preferredModel ?? p.models.find((m) => VISION_MODEL_PATTERN.test(m));

      if (model) {
        return {
          name: p.name,
          apiKey: p.apiKey,
          baseUrl: p.baseUrl.replace(/\/+$/, ''),
          model,
        };
      }
    }
  }

  // Last resort: any provider with a vision model
  for (const p of providers) {
    const urlCheck = await validateBaseUrlForFetch(p.baseUrl, 'POST');
    if (!urlCheck.valid) continue;

    const model =
      preferredModel ?? p.models.find((m) => VISION_MODEL_PATTERN.test(m));
    if (model) {
      return {
        name: p.name,
        apiKey: p.apiKey,
        baseUrl: p.baseUrl.replace(/\/+$/, ''),
        model,
      };
    }
  }

  return null;
}

// ============================================================================
// Transcoding
// ============================================================================

/**
 * Transcode a video to fit within the size limit.
 * Downscales to 720p and adjusts bitrate based on duration.
 */
async function transcodeForAnalysis(
  inputPath: string,
  workDir: string,
  duration: number,
  maxSizeMB: number,
): Promise<{ transcodedPath: string; sizeMB: number }> {
  // Calculate target bitrate: (maxSize in bits) / duration, with some headroom
  const targetBitsPerSecond = Math.floor(
    (maxSizeMB * 0.9 * 8 * 1_000_000) / Math.max(duration, 1),
  );
  const targetKbps = Math.max(200, Math.floor(targetBitsPerSecond / 1000));

  // Validate that the input file is within the workspace
  const resolvedInput = validateInputFile(inputPath, workDir);

  const stem = basename(resolvedInput, extname(resolvedInput));
  const outputPath = join(
    tmpdir(),
    `video_analysis_${randomUUID()}_${stem}.mp4`,
  );

  logger.info(
    `Transcoding for analysis: targetBitrate=${targetKbps}kbps, maxSize=${maxSizeMB}MB, duration=${duration}s`,
  );

  // Use runFFmpeg directly — the output goes to tmpdir (outside workspace)
  // so we bypass executeFFmpegOperation's workspace validation for the output path.
  const { exitCode, stderr } = await runFFmpeg([
    '-i',
    resolvedInput,
    '-vf',
    'scale=-2:720',
    '-c:v',
    'libx264',
    '-preset',
    'fast',
    '-b:v',
    `${targetKbps}k`,
    '-maxrate',
    `${Math.floor(targetKbps * 1.5)}k`,
    '-bufsize',
    `${targetKbps * 2}k`,
    '-c:a',
    'aac',
    '-b:a',
    '64k',
    '-movflags',
    '+faststart',
    outputPath,
  ]);

  if (exitCode !== 0) {
    throw new Error(`Transcoding failed (exit ${exitCode}): ${stderr}`);
  }

  if (!existsSync(outputPath)) {
    throw new Error('Transcoding produced no output file');
  }

  const sizeMB = statSync(outputPath).size / (1024 * 1024);
  logger.info(`Transcoded to ${sizeMB.toFixed(1)}MB (target: ${maxSizeMB}MB)`);

  return { transcodedPath: outputPath, sizeMB };
}

// ============================================================================
// Vision API Call
// ============================================================================

/**
 * Call the vision LLM with a base64-encoded video.
 */
async function callVisionAPI(
  provider: ProviderInfo,
  videoBase64: string,
  mimeType: string,
  prompt: string,
): Promise<string> {
  const url = `${provider.baseUrl}/v1/chat/completions`;

  const dataUri = `data:${mimeType};base64,${videoBase64}`;

  const requestBody = {
    model: provider.model,
    messages: [
      {
        role: 'user' as const,
        content: [
          {
            type: 'text' as const,
            text: prompt,
          },
          {
            type: 'video_url' as const,
            video_url: { url: dataUri },
          },
        ],
      },
    ],
    max_tokens: 4096,
    stream: false,
  };

  logger.info(
    `Calling vision API: provider=${provider.name}, model=${provider.model}, mimeType=${mimeType}`,
  );

  // Use a manual AbortController so the timer can be cleared when the request
  // resolves, preventing it from keeping the event loop alive unnecessarily.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${provider.apiKey}`,
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
      redirect: 'error',
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const rawText = await response.text().catch(() => '');
    const text = rawText.length > 500 ? rawText.slice(0, 500) + '…' : rawText;
    throw new Error(
      `Vision API error ${response.status}: ${text || response.statusText}`,
    );
  }

  const data = (await response.json()) as {
    choices?: Array<{
      message?: { content?: string };
    }>;
  };

  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('Vision API returned no content in response');
  }

  return content;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Analyze a video file using a vision-capable LLM.
 *
 * @param videoPath - Path to the video file (within workspace)
 * @param prompt - Question/instruction about the video content
 * @param options - Optional provider/model overrides
 */
export async function analyzeVideo(
  videoPath: string,
  prompt: string,
  options: {
    provider?: string;
    model?: string;
  } = {},
): Promise<VideoAnalysisResult> {
  let transcodedPath: string | null = null;

  try {
    // 1. Discover a vision-capable provider
    const providerInfo = await discoverVisionProvider(
      options.provider,
      options.model,
    );
    if (!providerInfo) {
      return {
        success: false,
        error:
          'No vision-capable provider found. Add an OpenRouter or Google Gemini provider with a Gemini model (e.g. gemini-2.5-flash) in Settings → Models.',
      };
    }

    // 2. Resolve workspace and validate file
    // Fall back to getAppDir() (e.g. ~/.neumar) so session folders work
    // even when the workDir setting has not been explicitly configured.
    const workDir = getSetting('workDir') ?? getAppDir();
    const resolvedPath = validateInputFile(videoPath, workDir);

    // 3. Get file size (statSync avoids reading entire file into memory)
    const originalSizeMB = statSync(resolvedPath).size / (1024 * 1024);

    // 4. Determine size limit
    const maxSizeSetting = getSetting('videoAnalysisMaxSizeMB');
    const maxSizeMB = maxSizeSetting
      ? parseInt(maxSizeSetting, 10) || DEFAULT_MAX_SIZE_MB
      : DEFAULT_MAX_SIZE_MB;

    let analyzePath = resolvedPath;
    let analyzedSizeMB = originalSizeMB;
    let wasTranscoded = false;

    // 5. Transcode if oversized
    if (originalSizeMB > maxSizeMB) {
      logger.info(
        `Video ${originalSizeMB.toFixed(1)}MB exceeds limit ${maxSizeMB}MB — transcoding`,
      );

      const probe = await probeFile(resolvedPath, workDir);
      const duration = probe.duration || 30; // fallback to 30s if unknown

      const result = await transcodeForAnalysis(
        resolvedPath,
        workDir,
        duration,
        maxSizeMB,
      );
      transcodedPath = result.transcodedPath;
      analyzePath = result.transcodedPath;
      analyzedSizeMB = result.sizeMB;
      wasTranscoded = true;
    }

    // 6. Read video and base64-encode
    const videoBuffer = await readFile(analyzePath);
    const videoBase64 = videoBuffer.toString('base64');

    // Determine MIME type from the file actually being sent (analyzePath),
    // not the original — transcoding always outputs .mp4
    const ext = analyzePath.toLowerCase().match(/\.[^.]+$/)?.[0] ?? '.mp4';
    const mimeType = VIDEO_MIME_MAP[ext] ?? 'video/mp4';

    // 7. Call vision API
    const analysis = await callVisionAPI(
      providerInfo,
      videoBase64,
      mimeType,
      prompt || 'Describe what happens in this video in detail.',
    );

    return {
      success: true,
      provider: providerInfo.name,
      model: providerInfo.model,
      analysis,
      originalSizeMB: Math.round(originalSizeMB * 10) / 10,
      analyzedSizeMB: Math.round(analyzedSizeMB * 10) / 10,
      wasTranscoded,
    };
  } catch (error) {
    logger.error('Video analysis failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    // Cleanup transcoded temp file
    if (transcodedPath) {
      try {
        unlinkSync(transcodedPath);
        logger.debug(`Cleaned up temp file: ${transcodedPath}`);
      } catch {
        logger.warn(`Failed to cleanup temp file: ${transcodedPath}`);
      }
    }
  }
}
