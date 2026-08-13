import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import {
  MEDIA_DATA_EGRESS,
  type MediaDataEgress,
} from '@/shared/media/data-egress';
import { runFFmpeg, validateInputFile } from '@/shared/services/ffmpeg';
import {
  getSttProviderInfo,
  transcribe as transcribeSpeech,
  type SttProviderInfo,
} from '@/shared/services/speech/router';
import type {
  STTParams,
  STTResult,
  TranscriptSegment,
} from '@/shared/services/speech/types';
import { createLogger } from '@/shared/utils/logger';

import {
  enforceVideoCostApproval,
  readVideoCostApproval,
} from '../cost-approval';
import { estimateAsrCostCents } from '../cost-estimator';
import {
  ANALYSIS_ARTIFACT_KINDS,
  type AnalysisArtifact,
  type MediaItem,
  type SourceMedia,
  type Subtitle,
  type SubtitleWord,
  type TranscriptData,
  type VideoProject,
} from '../types';

const logger = createLogger('VideoTranscript');
const DEFAULT_SOURCE_TRANSCRIPTION_PROVIDER = 'local';
const RAW_PCM_MIME_TYPE = 'audio/pcm';
const PCM_SAMPLE_RATE = 16_000;
const dataEgressCacheSchema = z.enum(MEDIA_DATA_EGRESS);
const analysisRangeCacheSchema = z.object({
  id: z.string().optional(),
  startMs: z.number().finite(),
  endMs: z.number().finite(),
  label: z.string().optional(),
  confidence: z.number().finite().optional(),
});
const subtitleWordCacheSchema = z.object({
  text: z.string(),
  startMs: z.number().finite(),
  endMs: z.number().finite(),
});
const subtitleCacheSchema = z.object({
  id: z.string(),
  text: z.string(),
  startMs: z.number().finite(),
  endMs: z.number().finite(),
  words: z.array(subtitleWordCacheSchema).optional(),
});
const transcriptDataCacheSchema = z.object({
  engine: z.string(),
  language: z.string().optional(),
  words: z.array(subtitleWordCacheSchema),
  segments: z.array(subtitleCacheSchema),
});
const analysisArtifactCacheSchema = z.object({
  id: z.string(),
  kind: z.enum(ANALYSIS_ARTIFACT_KINDS),
  sourceMediaId: z.string().optional(),
  contentHash: z.string().optional(),
  cachePath: z.string().optional(),
  summary: z.string().optional(),
  ranges: z.array(analysisRangeCacheSchema).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  generatedAt: z.string(),
});
const transcriptCacheEntrySchema = z.object({
  transcript: transcriptDataCacheSchema,
  artifact: analysisArtifactCacheSchema,
  provider: z.string(),
  providerKey: z.string(),
  model: z.string(),
  dataEgress: dataEgressCacheSchema,
  degraded: z.boolean(),
  estimatedCostCents: z.number().finite(),
});

export type SourceAudioExtractor = (input: {
  asset: MediaItem;
  workspaceRoot: string;
  cacheDir: string;
  durationMs: number;
}) => Promise<Buffer>;

export type SpeechTranscriber = (
  params: STTParams & { provider?: string },
) => Promise<STTResult>;

export interface SourceTranscriptResult {
  transcript: TranscriptData;
  artifact: AnalysisArtifact;
  provider: string;
  providerKey: string;
  model: string;
  dataEgress: MediaDataEgress;
  degraded: boolean;
  cacheHit: boolean;
  estimatedCostCents: number;
}

export interface SourceTranscriptOptions {
  project: Pick<VideoProject, 'id' | 'settings'>;
  source: SourceMedia;
  asset: MediaItem;
  workspaceRoot: string;
  cacheDir: string;
  provider?: string;
  extractAudio?: SourceAudioExtractor;
  transcribeAudio?: SpeechTranscriber;
  resolveProviderInfo?: (provider?: string) => SttProviderInfo | null;
  now?: string;
}

interface TranscriptCacheEntry {
  transcript: TranscriptData;
  artifact: AnalysisArtifact;
  provider: string;
  providerKey: string;
  model: string;
  dataEgress: MediaDataEgress;
  degraded: boolean;
  estimatedCostCents: number;
}

export async function transcribeSourceMedia(
  options: SourceTranscriptOptions,
): Promise<SourceTranscriptResult> {
  const provider = resolveSourceTranscriptionProvider(
    options.project,
    options.provider,
  );
  const providerInfo = options.resolveProviderInfo?.(provider) ??
    getSttProviderInfo(provider) ?? {
      provider,
      dataEgress:
        provider === DEFAULT_SOURCE_TRANSCRIPTION_PROVIDER ? 'local' : 'cloud',
    };
  const providerKey = safeProviderKey(providerInfo.provider);
  await fs.mkdir(options.cacheDir, { recursive: true });
  const cachePath = transcriptCachePath(options, providerKey);

  const generatedAt = options.now ?? new Date().toISOString();
  const estimatedCostCents = estimateAsrCostCents({
    durationMs: options.asset.metadata.durationMs,
    dataEgress: providerInfo.dataEgress,
  });
  const skipReason = resolveCloudSkipReason({
    project: options.project,
    providerKey,
    dataEgress: providerInfo.dataEgress,
    estimatedCostCents,
    sourceId: options.source.id,
  });
  const cached = await readTranscriptCache(cachePath);
  if (cached && shouldUseTranscriptCache(cached, skipReason)) {
    return { ...cached, cacheHit: true };
  }
  if (skipReason) {
    return writeTranscriptCache(
      cachePath,
      buildDegradedResult({
        options,
        provider: providerInfo.provider,
        providerKey,
        model: provider,
        dataEgress: providerInfo.dataEgress,
        estimatedCostCents,
        generatedAt,
        reason: skipReason,
      }),
    );
  }

  let result: STTResult;
  try {
    const audioData = await (options.extractAudio ?? extractSourceAudioPcm)({
      asset: options.asset,
      workspaceRoot: options.workspaceRoot,
      cacheDir: options.cacheDir,
      durationMs: options.asset.metadata.durationMs,
    });
    result = await (options.transcribeAudio ?? transcribeSpeech)({
      audioData,
      mimeType: RAW_PCM_MIME_TYPE,
      provider,
      timestamps: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn('video.source_transcript.exception', {
      project_id: options.project.id,
      source_id: options.source.id,
      provider: providerInfo.provider,
      error: message,
    });
    return writeTranscriptCache(
      cachePath,
      buildDegradedResult({
        options,
        provider: providerInfo.provider,
        providerKey,
        model: provider,
        dataEgress: providerInfo.dataEgress,
        estimatedCostCents,
        generatedAt,
        reason: 'transcription-exception',
        error: message,
      }),
    );
  }

  if (!result.success) {
    logger.warn('video.source_transcript.failed', {
      project_id: options.project.id,
      source_id: options.source.id,
      provider: providerInfo.provider,
      error: result.error,
    });
    return writeTranscriptCache(
      cachePath,
      buildDegradedResult({
        options,
        provider: result.provider || providerInfo.provider,
        providerKey,
        model: result.model || provider,
        dataEgress: result.dataEgress ?? providerInfo.dataEgress,
        estimatedCostCents,
        generatedAt,
        reason: 'transcription-failed',
        error: result.error,
      }),
    );
  }

  const transcript = transcriptDataFromSttResult(result);
  const degraded = transcript.words.length === 0;
  return writeTranscriptCache(cachePath, {
    transcript,
    artifact: buildTranscriptArtifact({
      source: options.source,
      transcript,
      cachePath,
      provider: result.provider,
      model: result.model,
      dataEgress: result.dataEgress ?? providerInfo.dataEgress,
      estimatedCostCents,
      degraded,
      generatedAt,
      reason: degraded ? 'word-timestamps-unavailable' : undefined,
    }),
    provider: result.provider,
    providerKey,
    model: result.model,
    dataEgress: result.dataEgress ?? providerInfo.dataEgress,
    degraded,
    estimatedCostCents,
  });
}

export async function extractSourceAudioPcm(input: {
  asset: MediaItem;
  workspaceRoot: string;
  cacheDir: string;
  durationMs: number;
}): Promise<Buffer> {
  const sourcePath = validateInputFile(input.asset.path, input.workspaceRoot);
  const outputPath = path.join(input.cacheDir, 'source-audio.s16le');
  await fs.mkdir(input.cacheDir, { recursive: true });
  if (!existsSync(outputPath)) {
    const { exitCode, stderr } = await runFFmpeg(
      [
        '-i',
        sourcePath,
        '-vn',
        '-acodec',
        'pcm_s16le',
        '-f',
        's16le',
        '-ac',
        '1',
        '-ar',
        String(PCM_SAMPLE_RATE),
        outputPath,
      ],
      { inputDuration: Math.max(input.durationMs, 0) / 1000 },
    );
    if (exitCode !== 0) {
      throw new Error(
        `Failed to extract source audio for transcription: ${stderr.slice(-500)}`,
      );
    }
  }
  return fs.readFile(outputPath);
}

export function transcriptDataFromSttResult(result: STTResult): TranscriptData {
  const segments = normalizeSegments(result.segments ?? []);
  const words = segments.map((segment): SubtitleWord => ({
    text: segment.text,
    startMs: segment.startMs,
    endMs: segment.endMs,
  }));
  const subtitles: Subtitle[] =
    segments.length > 0
      ? segments.map((segment, index) => ({
          id: `asr-${index + 1}`,
          text: segment.text,
          startMs: segment.startMs,
          endMs: segment.endMs,
          words: [
            {
              text: segment.text,
              startMs: segment.startMs,
              endMs: segment.endMs,
            },
          ],
        }))
      : result.text
        ? [
            {
              id: 'asr-1',
              text: result.text,
              startMs: 0,
              endMs: Math.round((result.duration ?? 0) * 1000),
            },
          ]
        : [];

  return {
    engine: `${result.provider}:${result.model}`,
    language: result.detectedLanguage,
    words,
    segments: subtitles,
  };
}

function resolveSourceTranscriptionProvider(
  project: Pick<VideoProject, 'settings'>,
  provider?: string,
): string {
  return (
    provider?.trim() ||
    project.settings?.sourceTranscriptionProviderId?.trim() ||
    DEFAULT_SOURCE_TRANSCRIPTION_PROVIDER
  );
}

function resolveCloudSkipReason(input: {
  project: Pick<VideoProject, 'id' | 'settings'>;
  providerKey: string;
  dataEgress: MediaDataEgress;
  estimatedCostCents: number;
  sourceId: string;
}): string | undefined {
  if (input.dataEgress === 'local') return undefined;
  const consent =
    input.project.settings?.sourceTranscriptionEgressConsents?.[
      input.providerKey
    ];
  if (consent?.confirmed !== true) {
    return 'cloud-egress-consent-required';
  }
  try {
    enforceVideoCostApproval(input.project as VideoProject, {
      estimatedCents: input.estimatedCostCents,
      scopeId: `asr:${input.sourceId}:${input.providerKey}`,
      approval: readVideoCostApproval(
        input.project.settings?.sourceTranscriptionCostApprovals?.[
          input.providerKey
        ],
      ),
    });
  } catch {
    return 'cost-approval-required';
  }
  return undefined;
}

function shouldUseTranscriptCache(
  cached: SourceTranscriptResult,
  currentSkipReason: string | undefined,
): boolean {
  const reason =
    typeof cached.artifact.metadata?.reason === 'string'
      ? cached.artifact.metadata.reason
      : undefined;
  const permissionBlocked =
    reason === 'cloud-egress-consent-required' ||
    reason === 'cost-approval-required';
  return !permissionBlocked || currentSkipReason === reason;
}

function buildDegradedResult(input: {
  options: SourceTranscriptOptions;
  provider: string;
  providerKey: string;
  model: string;
  dataEgress: MediaDataEgress;
  estimatedCostCents: number;
  generatedAt: string;
  reason: string;
  error?: string;
}): TranscriptCacheEntry {
  const transcript: TranscriptData = {
    engine: `${input.provider}:${input.model}`,
    words: [],
    segments: [],
  };
  return {
    transcript,
    artifact: buildTranscriptArtifact({
      source: input.options.source,
      transcript,
      cachePath: transcriptCachePath(input.options, input.providerKey),
      provider: input.provider,
      model: input.model,
      dataEgress: input.dataEgress,
      estimatedCostCents: input.estimatedCostCents,
      degraded: true,
      generatedAt: input.generatedAt,
      reason: input.reason,
      error: input.error,
    }),
    provider: input.provider,
    providerKey: input.providerKey,
    model: input.model,
    dataEgress: input.dataEgress,
    degraded: true,
    estimatedCostCents: input.estimatedCostCents,
  };
}

function buildTranscriptArtifact(input: {
  source: SourceMedia;
  transcript: TranscriptData;
  cachePath: string;
  provider: string;
  model: string;
  dataEgress: MediaDataEgress;
  estimatedCostCents: number;
  degraded: boolean;
  generatedAt: string;
  reason?: string;
  error?: string;
}): AnalysisArtifact {
  return {
    id: stableArtifactId(
      'transcript-ranges',
      input.source.id,
      input.source.contentHash,
      safeProviderKey(input.provider),
    ),
    kind: 'transcript-ranges',
    sourceMediaId: input.source.id,
    contentHash: input.source.contentHash,
    cachePath: input.cachePath,
    summary: input.degraded
      ? 'Transcript is degraded; word-level timestamps are unavailable.'
      : `${input.transcript.words.length} word-level transcript ranges available.`,
    ranges: input.transcript.words.map((word, index) => ({
      id: `${input.source.id}:w${index + 1}`,
      startMs: word.startMs,
      endMs: word.endMs,
      label: word.text,
    })),
    metadata: {
      provider: input.provider,
      model: input.model,
      dataEgress: input.dataEgress,
      estimatedCostCents: input.estimatedCostCents,
      degraded: input.degraded,
      reason: input.reason,
      error: input.error,
      wordTimestampsAvailable: input.transcript.words.length > 0,
      wordCount: input.transcript.words.length,
      segmentCount: input.transcript.segments.length,
    },
    generatedAt: input.generatedAt,
  };
}

async function readTranscriptCache(
  cachePath: string,
): Promise<SourceTranscriptResult | null> {
  try {
    const parsed = transcriptCacheEntrySchema.safeParse(
      JSON.parse(await fs.readFile(cachePath, 'utf8')),
    );
    if (!parsed.success) return null;
    return { ...parsed.data, cacheHit: true };
  } catch {
    return null;
  }
}

async function writeTranscriptCache(
  cachePath: string,
  entry: TranscriptCacheEntry,
): Promise<SourceTranscriptResult> {
  await fs.writeFile(cachePath, `${JSON.stringify(entry, null, 2)}\n`);
  return { ...entry, cacheHit: false };
}

function normalizeSegments(segments: TranscriptSegment[]): TranscriptSegment[] {
  return segments
    .filter(
      (segment) =>
        segment.text.trim().length > 0 &&
        Number.isFinite(segment.startMs) &&
        Number.isFinite(segment.endMs) &&
        segment.endMs >= segment.startMs,
    )
    .map((segment) => ({
      ...segment,
      text: segment.text.trim(),
      startMs: Math.max(0, Math.round(segment.startMs)),
      endMs: Math.max(0, Math.round(segment.endMs)),
    }))
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
}

function transcriptCachePath(
  options: Pick<SourceTranscriptOptions, 'cacheDir' | 'source'>,
  providerKey: string,
): string {
  return path.join(
    options.cacheDir,
    `transcript-${options.source.id}-${providerKey}.json`,
  );
}

export function safeProviderKey(provider: string): string {
  const normalized = provider
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || DEFAULT_SOURCE_TRANSCRIPTION_PROVIDER;
}

function stableArtifactId(
  kind: string,
  sourceId: string,
  contentHash: string,
  providerKey: string,
): string {
  const digest = createHash('sha1')
    .update(`${kind}:${sourceId}:${contentHash}:${providerKey}`)
    .digest('hex')
    .slice(0, 16);
  return `${kind}-${digest}`;
}
