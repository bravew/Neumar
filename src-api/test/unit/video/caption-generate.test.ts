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
  SubtitleWord,
  TranscriptData,
  VideoTimeline,
} from '@/shared/video/types';

import { defined } from '../../helpers/defined';

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

  it('prepares captions from cached speech without retranscribing', async () => {
    const project = await createProject({
      name: 'Cached',
      template: 'explainer',
    });
    await writeProject({
      ...project,
      assets: [assetFixture()],
      sources: [sourceFixture('asset-source')],
      sourceAnalyses: [analysisFixture()],
      timeline: timelineFixture({ startMs: 0, trimStartMs: 0 }),
    });
    const result = await generateProjectCaptions(project.id, {
      cachedOnly: true,
    });
    expect(result.cues.map((cue) => cue.text)).toEqual(['hello', 'world']);
  });

  it('does not start transcription or register a source in cached-only mode', async () => {
    const project = await createProject({
      name: 'No cached speech',
      template: 'explainer',
    });
    await writeProject({
      ...project,
      assets: [assetFixture()],
      sources: [],
      sourceAnalyses: [],
      timeline: timelineFixture({ startMs: 0, trimStartMs: 0 }),
    });
    const result = await generateProjectCaptions(project.id, {
      cachedOnly: true,
    });
    expect(result.cues).toEqual([]);
    expect(result.project.sources).toEqual([]);
    expect(result.project.sourceAnalyses).toEqual([]);
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
    const sources = defined(stored.sources, 'sources');
    expect(sources).toHaveLength(1);
    expect(sources[0]?.mediaItemId).toBe('asset-source');
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

  it('keeps sentence endings, matched punctuation, and glued Latin runs in one cue', async () => {
    const project = await createProject({
      name: 'Boundaries',
      template: 'explainer',
    });
    const words = boundaryWords();
    await writeProject({
      ...project,
      assets: [assetFixture({ durationMs: 12_000 })],
      sources: [sourceFixture('asset-source')],
      sourceAnalyses: [analysisFixture(words, 12_000)],
      timeline: timelineFixture({
        startMs: 0,
        trimStartMs: 0,
        trimEndMs: 12_000,
        sourceDurationMs: 12_000,
        durationMs: 12_000,
      }),
    });

    const { cues } = await generateProjectCaptions(project.id, {
      cachedOnly: true,
      // The default six-word cap would otherwise cut these phrases first.
      wordsPerCue: 12,
      maxCueMs: 8_000,
    });
    const texts = cues.map((cue) => cue.text);

    expect(texts).toEqual([
      'Today I will show you how to make a motion video.',
      'A motion video is made up of shapes, words and pictures that move.',
      'Read "The Old Man and the Sea" tonight.',
      'The model is called Transformer.',
    ]);
    expect(
      cues.flatMap((cue) => cue.words ?? []).map((word) => word.text),
    ).toEqual(words.map((word) => word.text));
    // A sentence-ending mark stays at the end of its cue.
    expect(texts.some((text) => /[.!?]\s/.test(text))).toBe(false);
    // The title's quotes stay in the same cue.
    const quoted = texts.filter((text) => text.includes('"'));
    expect(quoted).toEqual(['Read "The Old Man and the Sea" tonight.']);
    // The glued Latin pieces stay one word, not "Tra" | "nsformer".
    expect(texts.some((text) => /\bTra\b|\bnsformer\b/.test(text))).toBe(false);
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

function assetFixture(overrides?: { durationMs?: number }): MediaItem {
  return {
    id: 'asset-source',
    kind: 'video',
    source: 'user',
    path: 'videos/project-1/sources/source.mp4',
    metadata: {
      durationMs: overrides?.durationMs ?? 5000,
      width: 1920,
      height: 1080,
      audioTrackCount: 1,
    },
  };
}

/**
 * Timed words a caller can already store: a zero-length word after a sentence
 * ending, a quoted title, and a Latin run the transcriber split and glued.
 * Glue is the leading "­" on the continuation, which caption text drops.
 */
function boundaryWords(): SubtitleWord[] {
  const spoken = [
    'Today',
    'I',
    'will',
    'show',
    'you',
    'how',
    'to',
    'make',
    'a',
    'motion',
    'video.',
    'A',
    'motion',
    'video',
    'is',
    'made',
    'up',
    'of',
    'shapes,',
    'words',
    'and',
    'pictures',
    'that',
    'move.',
    'Read',
    '"The',
    'Old',
    'Man',
    'and',
    'the',
    'Sea"',
    'tonight.',
    'The',
    'model',
    'is',
    'called',
    'Tra',
  ];
  const words: SubtitleWord[] = spoken.map((text, index) => {
    const startMs = index * 200;
    // "A" shares its instant with the next word, the Scribe zero-length case.
    const endMs = text === 'A' ? startMs : startMs + 180;
    return { text, startMs, endMs };
  });
  const tra = words.at(-1)!;
  words.push({
    text: '­nsformer.',
    startMs: tra.endMs,
    endMs: tra.endMs + 180,
  });
  return words;
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

function analysisFixture(
  words: SubtitleWord[] = [
    { text: 'hello', startMs: 0, endMs: 1000 },
    { text: 'world', startMs: 2000, endMs: 3000 },
  ],
  durationMs = 5000,
): SourceMediaAnalysis {
  return {
    id: 'analysis-1',
    sourceId: 'source-1',
    contentHash: 'hash1',
    durationMs,
    streams: assetFixture({ durationMs }).metadata,
    scenes: [],
    speechRanges: [],
    transcript: {
      engine: 'Local:mock',
      words,
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
  sourceDurationMs?: number;
  durationMs?: number;
}): VideoTimeline {
  const sourceDurationMs = clip.sourceDurationMs ?? 5000;
  return {
    schema: 'neuma.video.timeline.v1',
    fps: 30,
    durationMs: clip.durationMs ?? 5000,
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
            durationMs: (clip.trimEndMs ?? sourceDurationMs) - clip.trimStartMs,
            trimStartMs: clip.trimStartMs,
            trimEndMs: clip.trimEndMs ?? sourceDurationMs,
            sourceDurationMs,
          },
        ],
      },
    ],
  };
}
