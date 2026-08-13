import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { packTranscript } from '@/shared/video/analysis/pack-transcript';
import { transcribeSourceMedia } from '@/shared/video/analysis/transcript';
import type {
  MediaItem,
  SourceMedia,
  VideoProject,
} from '@/shared/video/types';

describe('video source transcript analysis', () => {
  let workDir: string;
  let cacheDir: string;

  beforeEach(async () => {
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'video-transcript-'));
    cacheDir = path.join(workDir, '.cache', 'videos', 'project-1', 'analysis');
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(workDir, { recursive: true, force: true });
  });

  it('caches word-level transcripts by source and provider', async () => {
    const extractAudio = vi.fn(async () => Buffer.from([0, 0, 1, 0]));
    const transcribeAudio = vi.fn(async () => ({
      success: true,
      provider: 'Local',
      model: 'mock-whisper',
      dataEgress: 'local' as const,
      text: 'hello world',
      detectedLanguage: 'en',
      segments: [
        { text: 'hello', startMs: 100, endMs: 420 },
        { text: 'world', startMs: 500, endMs: 900 },
      ],
      duration: 0.9,
    }));

    const first = await transcribeSourceMedia({
      ...baseOptions({ workDir, cacheDir }),
      extractAudio,
      transcribeAudio,
      resolveProviderInfo: () => ({ provider: 'Local', dataEgress: 'local' }),
      now: '2026-07-01T15:10:00.000Z',
    });
    const second = await transcribeSourceMedia({
      ...baseOptions({ workDir, cacheDir }),
      extractAudio,
      transcribeAudio,
      resolveProviderInfo: () => ({ provider: 'Local', dataEgress: 'local' }),
    });

    expect(first.cacheHit).toBe(false);
    expect(second.cacheHit).toBe(true);
    expect(extractAudio).toHaveBeenCalledTimes(1);
    expect(transcribeAudio).toHaveBeenCalledTimes(1);
    expect(second.transcript.words).toEqual([
      { text: 'hello', startMs: 100, endMs: 420 },
      { text: 'world', startMs: 500, endMs: 900 },
    ]);
    expect(first.artifact).toMatchObject({
      kind: 'transcript-ranges',
      sourceMediaId: 'source-1',
      metadata: {
        dataEgress: 'local',
        wordTimestampsAvailable: true,
        wordCount: 2,
      },
    });
    await expect(fs.stat(first.artifact.cachePath!)).resolves.toBeTruthy();
  });

  it('ignores malformed transcript cache entries and refreshes analysis', async () => {
    await fs.mkdir(cacheDir, { recursive: true });
    await fs.writeFile(
      path.join(cacheDir, 'transcript-source-1-local.json'),
      '{"transcript":{"engine":"stale"}}\n',
    );
    const extractAudio = vi.fn(async () => Buffer.from([0, 0, 1, 0]));
    const transcribeAudio = vi.fn(async () => ({
      success: true,
      provider: 'Local',
      model: 'mock-whisper',
      dataEgress: 'local' as const,
      text: 'fresh transcript',
      detectedLanguage: 'en',
      segments: [{ text: 'fresh', startMs: 100, endMs: 420 }],
      duration: 0.42,
    }));

    const result = await transcribeSourceMedia({
      ...baseOptions({ workDir, cacheDir }),
      extractAudio,
      transcribeAudio,
      resolveProviderInfo: () => ({ provider: 'Local', dataEgress: 'local' }),
    });

    expect(result.cacheHit).toBe(false);
    expect(extractAudio).toHaveBeenCalledTimes(1);
    expect(transcribeAudio).toHaveBeenCalledTimes(1);
    expect(result.transcript.words).toEqual([
      { text: 'fresh', startMs: 100, endMs: 420 },
    ]);
  });

  it('marks successful providers without word timestamps as degraded', async () => {
    const result = await transcribeSourceMedia({
      ...baseOptions({ workDir, cacheDir }),
      extractAudio: vi.fn(async () => Buffer.from([0, 0])),
      transcribeAudio: vi.fn(async () => ({
        success: true,
        provider: 'Local',
        model: 'sensevoice',
        dataEgress: 'local' as const,
        text: 'timing unavailable',
        duration: 2,
      })),
      resolveProviderInfo: () => ({ provider: 'Local', dataEgress: 'local' }),
    });

    expect(result.degraded).toBe(true);
    expect(result.transcript.words).toHaveLength(0);
    expect(result.transcript.segments).toHaveLength(1);
    expect(result.artifact.metadata).toMatchObject({
      degraded: true,
      reason: 'word-timestamps-unavailable',
      wordTimestampsAvailable: false,
    });
  });

  it('does not upload to cloud ASR without project-provider egress consent', async () => {
    const extractAudio = vi.fn(async () => Buffer.from([0, 0]));
    const transcribeAudio = vi.fn(async () => ({
      success: true,
      provider: 'OpenAI',
      model: 'whisper-1',
      dataEgress: 'cloud' as const,
      text: 'consent granted',
      segments: [{ text: 'consent', startMs: 100, endMs: 500 }],
    }));

    const result = await transcribeSourceMedia({
      ...baseOptions({
        workDir,
        cacheDir,
        project: {
          ...projectFixture(),
          settings: { sourceTranscriptionProviderId: 'openai' },
        },
      }),
      extractAudio,
      transcribeAudio,
      resolveProviderInfo: () => ({ provider: 'OpenAI', dataEgress: 'cloud' }),
    });

    expect(extractAudio).not.toHaveBeenCalled();
    expect(transcribeAudio).not.toHaveBeenCalled();
    expect(result.degraded).toBe(true);
    expect(result.dataEgress).toBe('cloud');
    expect(result.artifact.metadata).toMatchObject({
      reason: 'cloud-egress-consent-required',
      estimatedCostCents: 1,
    });

    const afterConsent = await transcribeSourceMedia({
      ...baseOptions({
        workDir,
        cacheDir,
        project: {
          ...projectFixture(),
          settings: {
            sourceTranscriptionProviderId: 'openai',
            sourceTranscriptionEgressConsents: {
              openai: {
                confirmed: true,
                confirmedAt: '2026-07-01T15:30:00.000Z',
              },
            },
          },
        },
      }),
      extractAudio,
      transcribeAudio,
      resolveProviderInfo: () => ({ provider: 'OpenAI', dataEgress: 'cloud' }),
    });

    expect(extractAudio).toHaveBeenCalledTimes(1);
    expect(transcribeAudio).toHaveBeenCalledTimes(1);
    expect(afterConsent.degraded).toBe(false);
    expect(afterConsent.transcript.words).toEqual([
      { text: 'consent', startMs: 100, endMs: 500 },
    ]);
  });

  it('packs word-level transcript phrases with stable source ranges', () => {
    const packed = packTranscript({
      source: sourceFixture(),
      transcript: {
        engine: 'Local:mock',
        language: 'en',
        words: [
          { text: 'one', startMs: 0, endMs: 100 },
          { text: 'two', startMs: 200, endMs: 300 },
          { text: 'three', startMs: 1400, endMs: 1500 },
        ],
        segments: [],
      },
    });

    expect(packed.phrases).toEqual([
      {
        id: 'source-1:p1',
        sourceMediaId: 'source-1',
        startMs: 0,
        endMs: 300,
        text: 'one two',
        wordStartIndex: 0,
        wordEndIndex: 1,
      },
      {
        id: 'source-1:p2',
        sourceMediaId: 'source-1',
        startMs: 1400,
        endMs: 1500,
        text: 'three',
        wordStartIndex: 2,
        wordEndIndex: 2,
      },
    ]);
  });
});

function baseOptions(input: {
  workDir: string;
  cacheDir: string;
  project?: VideoProject;
}) {
  return {
    project: input.project ?? projectFixture(),
    source: sourceFixture(),
    asset: assetFixture(),
    workspaceRoot: input.workDir,
    cacheDir: input.cacheDir,
  };
}

function projectFixture(): VideoProject {
  return {
    id: 'project-1',
    name: 'Transcript project',
    template: 'explainer',
    prompt: '',
    assets: [],
    sources: [],
    linkedSources: [],
    sourceAnalyses: [],
    cutPlans: [],
    analysisArtifacts: [],
    render: { status: 'idle', updatedAt: '2026-07-01T00:00:00.000Z' },
    budget: { capUsd: 5, spentUsd: 0 },
    outputs: [],
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
  };
}

function sourceFixture(): SourceMedia {
  return {
    id: 'source-1',
    mediaItemId: 'asset-1',
    origin: 'upload',
    contentHash: 'hash1',
    analysisStatus: 'idle',
    createdAt: '2026-07-01T00:00:00.000Z',
  };
}

function assetFixture(): MediaItem {
  return {
    id: 'asset-1',
    kind: 'video',
    source: 'user',
    path: 'videos/project-1/sources/source.mp4',
    metadata: {
      durationMs: 30_000,
      width: 1920,
      height: 1080,
      audioTrackCount: 1,
    },
  };
}
