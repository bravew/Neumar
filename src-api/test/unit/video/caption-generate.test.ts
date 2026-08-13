import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeDatabase } from '@/shared/db';
import {
  chunkWords,
  generateProjectCaptions,
  transcriptWords,
} from '@/shared/video/caption-generate';
import { createProject, getProject, writeProject } from '@/shared/video/store';
import type {
  MediaItem,
  SourceMedia,
  SourceMediaAnalysis,
  TranscriptData,
  VideoTimeline,
} from '@/shared/video/types';

describe('caption generation from transcript', () => {
  let workDir: string;

  beforeEach(async () => {
    closeDatabase();
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'caption-gen-'));
    vi.stubEnv('NEUMA_VIDEO_WORKDIR', workDir);
  });

  afterEach(async () => {
    closeDatabase();
    vi.unstubAllEnvs();
    await fs.rm(workDir, { recursive: true, force: true });
  });

  it('lays cues carrying the spoken words, timed to the timeline', async () => {
    const project = await createProject({
      name: 'Captions',
      template: 'explainer',
    });
    await writeProject({
      ...project,
      assets: [assetFixture()],
      sources: [sourceFixture('asset-source')],
      sourceAnalyses: [analysisFixture()],
      timeline: timelineFixture({ startMs: 0, trimStartMs: 0 }),
    });

    const { cues } = await generateProjectCaptions(project.id);

    // The gap between "hello" (ends 1000) and "world" (starts 2000) exceeds the
    // pause threshold, so they land in separate cues at the real speech times.
    expect(cues.map((cue) => cue.text)).toEqual(['hello', 'world']);
    expect(cues[0]).toMatchObject({ startMs: 0, kind: 'caption' });
    expect(cues[1]?.startMs).toBe(2000);
    // Not the scene description — the actual transcript words.
    expect(cues.every((cue) => cue.text !== project.name)).toBe(true);

    const stored = await getProject(project.id);
    const captionTrack = stored.timeline?.tracks.find(
      (track) => track.kind === 'caption',
    );
    expect(captionTrack?.clips).toHaveLength(2);
  });

  it('registers a source on the fly for an uploaded asset that has none', async () => {
    const project = await createProject({
      name: 'NoSource',
      template: 'explainer',
    });
    await writeProject({
      ...project,
      // Asset has audio + a content hash but was never imported as a source.
      assets: [
        {
          ...assetFixture(),
          metadata: { ...assetFixture().metadata, contentHash: 'hash1' },
        },
      ],
      sources: [],
      sourceAnalyses: [],
      timeline: timelineFixture({ startMs: 0, trimStartMs: 0 }),
    });

    await generateProjectCaptions(project.id);

    // A SourceMedia was registered pointing at the existing asset, so the clip
    // is no longer skipped for lack of a source.
    const stored = await getProject(project.id);
    expect(stored.sources).toHaveLength(1);
    expect(stored.sources[0]?.mediaItemId).toBe('asset-source');
  });

  it('reports a skip reason instead of silently producing nothing', async () => {
    const project = await createProject({
      name: 'NoAudio',
      template: 'explainer',
    });
    await writeProject({
      ...project,
      assets: [
        {
          ...assetFixture(),
          metadata: { durationMs: 5000, width: 1920, height: 1080 },
        },
      ],
      sources: [],
      sourceAnalyses: [],
      timeline: timelineFixture({ startMs: 0, trimStartMs: 0 }),
    });

    const result = await generateProjectCaptions(project.id);
    expect(result.cues).toHaveLength(0);
    expect(result.skipped).toEqual([
      { clipId: 'clip-video', reason: 'no-audio' },
    ]);
  });

  it('projects transcript source time through a trimmed clip', async () => {
    const project = await createProject({
      name: 'Trim',
      template: 'explainer',
    });
    await writeProject({
      ...project,
      assets: [assetFixture()],
      sources: [sourceFixture('asset-source')],
      sourceAnalyses: [analysisFixture()],
      // Clip shows source [2000,3000) placed at timeline 1000.
      timeline: timelineFixture({
        startMs: 1000,
        trimStartMs: 2000,
        trimEndMs: 3000,
      }),
    });

    const { cues } = await generateProjectCaptions(project.id);

    // Only "world" (source 2000-3000) is inside the clip; it maps to timeline
    // 1000 = clipStart + (2000 - trimStart).
    expect(cues).toHaveLength(1);
    expect(cues[0]).toMatchObject({ text: 'world', startMs: 1000 });
  });

  it('regenerating replaces prior STT cues without stacking', async () => {
    const project = await createProject({
      name: 'Rerun',
      template: 'explainer',
    });
    await writeProject({
      ...project,
      assets: [assetFixture()],
      sources: [sourceFixture('asset-source')],
      sourceAnalyses: [analysisFixture()],
      timeline: timelineFixture({ startMs: 0, trimStartMs: 0 }),
    });

    await generateProjectCaptions(project.id);
    const { cues } = await generateProjectCaptions(project.id);
    const stored = await getProject(project.id);
    const captionTrack = stored.timeline?.tracks.find(
      (track) => track.kind === 'caption',
    );
    expect(captionTrack?.clips).toHaveLength(cues.length);
  });
});

describe('transcriptWords', () => {
  it('uses word-level timings when present', () => {
    const transcript: TranscriptData = {
      engine: 'x',
      words: [{ text: 'a', startMs: 0, endMs: 100 }],
      segments: [],
    };
    expect(transcriptWords(transcript)).toEqual([
      { text: 'a', startMs: 0, endMs: 100 },
    ]);
  });

  it('interpolates words across a segment when only segment timing exists', () => {
    const transcript: TranscriptData = {
      engine: 'Local:sensevoice',
      words: [],
      segments: [{ id: 's1', text: 'one two three', startMs: 0, endMs: 3000 }],
    };
    expect(transcriptWords(transcript)).toEqual([
      { text: 'one', startMs: 0, endMs: 1000 },
      { text: 'two', startMs: 1000, endMs: 2000 },
      { text: 'three', startMs: 2000, endMs: 3000 },
    ]);
  });

  it('segments space-less scripts (CJK) into multiple words', () => {
    const transcript: TranscriptData = {
      engine: 'Local:sensevoice',
      words: [],
      segments: [{ id: 's1', text: '你好世界', startMs: 0, endMs: 2000 }],
    };
    const words = transcriptWords(transcript);
    // Must not collapse the whole segment into one giant token.
    expect(words.length).toBeGreaterThan(1);
    expect(words.map((w) => w.text).join('')).toBe('你好世界');
  });
});

describe('chunkWords', () => {
  it('breaks on word count, sentence end, and long pauses', () => {
    const words = [
      { text: 'a', startMs: 0, endMs: 100 },
      { text: 'b.', startMs: 100, endMs: 200 },
      { text: 'c', startMs: 900, endMs: 1000 },
    ];
    // "b." ends a sentence -> cut after it; the pause before "c" is its own cue.
    expect(
      chunkWords(words, 10, 5000).map((c) => c.map((w) => w.text)),
    ).toEqual([['a', 'b.'], ['c']]);
  });
});

function assetFixture(): MediaItem {
  return {
    id: 'asset-source',
    kind: 'video',
    source: 'user',
    path: 'videos/project-1/sources/source.mp4',
    metadata: {
      durationMs: 5000,
      width: 1920,
      height: 1080,
      audioTrackCount: 1,
    },
  };
}

function sourceFixture(mediaItemId: string): SourceMedia {
  return {
    id: 'source-1',
    mediaItemId,
    origin: 'upload',
    contentHash: 'hash1',
    analysisStatus: 'done',
    analysisId: 'analysis-1',
    createdAt: '2026-07-01T00:00:00.000Z',
  };
}

function analysisFixture(): SourceMediaAnalysis {
  return {
    id: 'analysis-1',
    sourceId: 'source-1',
    contentHash: 'hash1',
    durationMs: 5000,
    streams: assetFixture().metadata,
    scenes: [],
    speechRanges: [],
    transcript: {
      engine: 'Local:mock',
      words: [
        { text: 'hello', startMs: 0, endMs: 1000 },
        { text: 'world', startMs: 2000, endMs: 3000 },
      ],
      segments: [],
    },
    visualBeats: [],
    qualitySignals: [],
    duplicateCandidates: [],
    cutCandidates: [],
    generatedAt: '2026-07-01T00:00:00.000Z',
  };
}

function timelineFixture(clip: {
  startMs: number;
  trimStartMs: number;
  trimEndMs?: number;
}): VideoTimeline {
  return {
    schema: 'neuma.video.timeline.v1',
    fps: 30,
    durationMs: 5000,
    tracks: [
      {
        id: 'track-video',
        kind: 'video',
        name: 'Video',
        muted: false,
        locked: false,
        order: 0,
        clips: [
          {
            id: 'clip-video',
            kind: 'video',
            sourceRef: { kind: 'asset', assetId: 'asset-source' },
            startMs: clip.startMs,
            durationMs: (clip.trimEndMs ?? 5000) - clip.trimStartMs,
            trimStartMs: clip.trimStartMs,
            trimEndMs: clip.trimEndMs ?? 5000,
            sourceDurationMs: 5000,
          },
        ],
      },
    ],
  };
}
