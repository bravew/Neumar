import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import type {
  AnalysisArtifact,
  SourceMedia,
  SubtitleWord,
  TranscriptData,
} from '../types';

const MAX_PHRASE_GAP_MS = 800;
const MAX_PHRASE_DURATION_MS = 12_000;
const MAX_PHRASE_WORDS = 18;

export interface PackedTranscriptPhrase {
  id: string;
  sourceMediaId: string;
  startMs: number;
  endMs: number;
  text: string;
  wordStartIndex: number;
  wordEndIndex: number;
  speaker?: string;
}

export interface PackedTranscriptPayload {
  version: 1;
  sourceMediaId: string;
  contentHash: string;
  engine: string;
  language?: string;
  text: string;
  phrases: PackedTranscriptPhrase[];
}

export interface PackedTranscriptArtifactResult {
  artifact: AnalysisArtifact;
  payload: PackedTranscriptPayload;
}

export function packTranscript(input: {
  source: SourceMedia;
  transcript: TranscriptData;
}): PackedTranscriptPayload {
  const words = normalizeWords(input.transcript.words);
  const phrases: PackedTranscriptPhrase[] = [];
  let current: SubtitleWord[] = [];
  let currentStartIndex = 0;

  const flush = () => {
    if (current.length === 0) return;
    const first = current[0]!;
    const last = current[current.length - 1]!;
    phrases.push({
      id: `${input.source.id}:p${phrases.length + 1}`,
      sourceMediaId: input.source.id,
      startMs: first.startMs,
      endMs: last.endMs,
      text: current.map((word) => word.text).join(' '),
      wordStartIndex: currentStartIndex,
      wordEndIndex: currentStartIndex + current.length - 1,
    });
    current = [];
  };

  words.forEach((word, index) => {
    const previous = current[current.length - 1];
    const shouldSplit =
      current.length > 0 &&
      previous &&
      (word.startMs - previous.endMs > MAX_PHRASE_GAP_MS ||
        word.endMs - current[0]!.startMs > MAX_PHRASE_DURATION_MS ||
        current.length >= MAX_PHRASE_WORDS);
    if (shouldSplit) flush();
    if (current.length === 0) currentStartIndex = index;
    current.push(word);
  });
  flush();

  const text =
    phrases.length > 0
      ? phrases.map((phrase) => phrase.text).join('\n')
      : input.transcript.segments.map((segment) => segment.text).join('\n');

  return {
    version: 1,
    sourceMediaId: input.source.id,
    contentHash: input.source.contentHash,
    engine: input.transcript.engine,
    language: input.transcript.language,
    text,
    phrases,
  };
}

export async function createPackedTranscriptArtifact(input: {
  source: SourceMedia;
  transcript: TranscriptData;
  cacheDir: string;
  providerKey: string;
  generatedAt: string;
}): Promise<PackedTranscriptArtifactResult> {
  const payload = packTranscript({
    source: input.source,
    transcript: input.transcript,
  });
  await fs.mkdir(input.cacheDir, { recursive: true });
  const cachePath = path.join(
    input.cacheDir,
    `packed-transcript-${input.source.id}-${input.providerKey}.json`,
  );
  await fs.writeFile(cachePath, `${JSON.stringify(payload, null, 2)}\n`);

  const artifact: AnalysisArtifact = {
    id: stableArtifactId(
      'packed-transcript',
      input.source.id,
      input.source.contentHash,
      input.providerKey,
    ),
    kind: 'packed-transcript',
    sourceMediaId: input.source.id,
    contentHash: input.source.contentHash,
    cachePath,
    summary:
      payload.phrases.length > 0
        ? `${payload.phrases.length} transcript phrases packed for editing context.`
        : 'Transcript has no word-level phrases available.',
    ranges: payload.phrases.map((phrase) => ({
      id: phrase.id,
      startMs: phrase.startMs,
      endMs: phrase.endMs,
      label: phrase.text,
    })),
    metadata: {
      version: payload.version,
      engine: payload.engine,
      language: payload.language,
      phraseCount: payload.phrases.length,
      textLength: payload.text.length,
    },
    generatedAt: input.generatedAt,
  };

  return { artifact, payload };
}

function normalizeWords(words: SubtitleWord[]): SubtitleWord[] {
  return words
    .filter(
      (word) =>
        word.text.trim().length > 0 &&
        Number.isFinite(word.startMs) &&
        Number.isFinite(word.endMs) &&
        word.endMs >= word.startMs,
    )
    .map((word) => ({
      ...word,
      text: word.text.trim(),
      startMs: Math.max(0, Math.round(word.startMs)),
      endMs: Math.max(0, Math.round(word.endMs)),
    }))
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
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
