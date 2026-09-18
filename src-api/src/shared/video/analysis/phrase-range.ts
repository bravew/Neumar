import type { SubtitleWord } from '@/shared/video/types';

export class PhraseRangeError extends Error {
  constructor(
    message: string,
    readonly code: 'missing-phrase' | 'invalid-occurrence' = 'missing-phrase',
  ) {
    super(message);
    this.name = 'PhraseRangeError';
  }
}

export interface PhraseRange {
  startMs: number;
  endMs: number;
  occurrence: number;
  matchCount: number;
  text: string;
}

export function resolvePhraseRange(input: {
  words: SubtitleWord[];
  phrase: string;
  occurrence?: number;
  paddingMs?: number;
  durationMs: number;
}): PhraseRange {
  const needle = normalizePhrase(input.phrase);
  if (!needle) {
    throw new PhraseRangeError(
      'A spoken phrase is required.',
      'missing-phrase',
    );
  }
  const words = input.words.filter(
    (word) =>
      Number.isFinite(word.startMs) &&
      Number.isFinite(word.endMs) &&
      word.text.trim().length > 0,
  );
  const matches = findPhraseMatches(words, needle);
  if (matches.length === 0) {
    throw new PhraseRangeError(
      `The phrase "${input.phrase}" was not found in the transcript.`,
      'missing-phrase',
    );
  }
  const occurrence = input.occurrence ?? 1;
  if (!Number.isInteger(occurrence) || occurrence < 1) {
    throw new PhraseRangeError(
      'Phrase occurrence must be a 1-based integer.',
      'invalid-occurrence',
    );
  }
  const selected = matches[occurrence - 1];
  if (!selected) {
    throw new PhraseRangeError(
      `Phrase occurrence ${occurrence} is out of range (${matches.length} matches).`,
      'invalid-occurrence',
    );
  }
  const paddingMs = Math.max(0, input.paddingMs ?? 0);
  const startMs = Math.max(0, selected.startMs - paddingMs);
  const endMs = Math.min(input.durationMs, selected.endMs + paddingMs);
  return {
    startMs,
    endMs: Math.max(startMs, endMs),
    occurrence,
    matchCount: matches.length,
    text: selected.text,
  };
}

function findPhraseMatches(
  words: SubtitleWord[],
  needle: string,
): Array<{ startMs: number; endMs: number; text: string }> {
  const tokens = needle.split(' ').filter(Boolean);
  if (tokens.length === 0) return [];
  const normalized = words.map((word) => ({
    ...word,
    token: normalizePhrase(word.text),
  }));
  const matches: Array<{ startMs: number; endMs: number; text: string }> = [];
  for (let index = 0; index <= normalized.length - tokens.length; index += 1) {
    const window = normalized.slice(index, index + tokens.length);
    if (window.every((word, offset) => word.token === tokens[offset])) {
      const first = window[0]!;
      const last = window[window.length - 1]!;
      matches.push({
        startMs: first.startMs,
        endMs: last.endMs,
        text: window.map((word) => word.text).join(' '),
      });
    }
  }
  return matches;
}

function normalizePhrase(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
