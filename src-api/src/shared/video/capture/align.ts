import type {
  Storyboard,
  StoryboardScene,
  Subtitle,
} from '@/shared/video/types';

export interface CaptureSceneMarker {
  sceneId: string;
  startMs: number;
  endMs: number;
  confidence: number;
  transcriptText: string;
}

interface TimedWord {
  text: string;
  startMs: number;
  endMs: number;
}

export function alignCaptureToStoryboard(
  storyboard: Storyboard,
  subtitles: Subtitle[],
  sceneIds?: string[],
): CaptureSceneMarker[] {
  const scenes = sceneIds?.length
    ? storyboard.scenes.filter((scene) => sceneIds.includes(scene.id))
    : storyboard.scenes;
  const words = subtitlesToWords(subtitles);
  if (words.length === 0) return proportionalMarkers(storyboard, scenes);

  let cursor = 0;
  return scenes.map((scene) => {
    const targetTokens = tokenize(sceneNarrationText(storyboard, scene));
    const windowSize = Math.max(3, targetTokens.length || 3);
    const match = bestWindow(targetTokens, words, cursor, windowSize);
    cursor = Math.min(words.length, match.index + windowSize);
    const window = words.slice(
      match.index,
      Math.max(match.index + 1, match.endIndex),
    );
    return {
      sceneId: scene.id,
      startMs: window[0]?.startMs ?? 0,
      endMs: window.at(-1)?.endMs ?? window[0]?.startMs ?? 0,
      confidence: roundConfidence(match.confidence),
      transcriptText: window.map((word) => word.text).join(' '),
    };
  });
}

function bestWindow(
  targetTokens: string[],
  words: TimedWord[],
  cursor: number,
  windowSize: number,
): { index: number; endIndex: number; confidence: number } {
  if (targetTokens.length === 0) {
    return {
      index: cursor,
      endIndex: Math.min(words.length, cursor + windowSize),
      confidence: 0.35,
    };
  }

  const searchEnd = Math.max(cursor + 1, words.length - windowSize + 1);
  let best = { index: cursor, endIndex: cursor + windowSize, confidence: 0 };
  for (let index = cursor; index < searchEnd; index += 1) {
    const candidate = words.slice(index, index + windowSize);
    if (candidate.length === 0) break;
    const candidateTokens = candidate.map((word) => normalizeToken(word.text));
    const confidence = sequenceSimilarity(targetTokens, candidateTokens);
    if (confidence > best.confidence) {
      best = {
        index,
        endIndex: index + candidate.length,
        confidence,
      };
    }
  }
  return best;
}

function sequenceSimilarity(left: string[], right: string[]): number {
  const maxLength = Math.max(left.length, right.length, 1);
  const distance = levenshtein(left, right);
  const score = 1 - distance / maxLength;
  return Math.max(0, Math.min(1, score));
}

function levenshtein(left: string[], right: string[]): number {
  const previous = Array.from(
    { length: right.length + 1 },
    (_, index) => index,
  );
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost =
        left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        previous[rightIndex]! + 1,
        current[rightIndex - 1]! + 1,
        previous[rightIndex - 1]! + substitutionCost,
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length] ?? 0;
}

function subtitlesToWords(subtitles: Subtitle[]): TimedWord[] {
  return subtitles.flatMap((subtitle) => {
    if (subtitle.words?.length) {
      return subtitle.words.map((word) => ({
        text: word.text,
        startMs: word.startMs,
        endMs: word.endMs,
      }));
    }
    const tokens = tokenize(subtitle.text);
    if (tokens.length === 0) return [];
    const duration = Math.max(1, subtitle.endMs - subtitle.startMs);
    const step = Math.max(1, Math.floor(duration / tokens.length));
    return tokens.map((text, index) => ({
      text,
      startMs: subtitle.startMs + index * step,
      endMs:
        index === tokens.length - 1
          ? subtitle.endMs
          : subtitle.startMs + (index + 1) * step,
    }));
  });
}

function proportionalMarkers(
  storyboard: Storyboard,
  scenes: StoryboardScene[],
): CaptureSceneMarker[] {
  let cursor = 0;
  const sceneStarts = new Map<string, number>();
  for (const scene of storyboard.scenes) {
    sceneStarts.set(scene.id, cursor);
    cursor += scene.durationMs;
  }
  return scenes.map((scene) => {
    const startMs = sceneStarts.get(scene.id) ?? 0;
    return {
      sceneId: scene.id,
      startMs,
      endMs: startMs + scene.durationMs,
      confidence: 0.2,
      transcriptText: '',
    };
  });
}

function sceneNarrationText(
  storyboard: Storyboard,
  scene: StoryboardScene,
): string {
  const segment = storyboard.narration?.segments.find(
    (entry) => entry.sceneId === scene.id,
  );
  return segment?.text ?? scene.caption?.text ?? scene.intent;
}

function tokenize(text: string): string[] {
  return text.split(/\s+/).map(normalizeToken).filter(Boolean);
}

function normalizeToken(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

function roundConfidence(value: number): number {
  return Math.round(value * 100) / 100;
}
