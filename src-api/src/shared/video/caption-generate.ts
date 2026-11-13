import { createLogger } from '@/shared/utils/logger';

import {
  findPrimaryCaptionTrack,
  PRIMARY_CAPTION_TRACK_ID,
  STT_CAPTION_ORIGIN,
} from './caption-retime';
import {
  analyzeSource,
  ensureSourceForAsset,
  getProject,
  getSourceAnalysis,
  updateProjectDocument,
} from './store';
import { migrateStoryboardToTimeline } from './timeline';
import type {
  CaptionTimelineClip,
  CaptionTimelineTrack,
  SourceMedia,
  SubtitleStyle,
  SubtitleWord,
  TranscriptData,
  VideoProject,
  VideoTimeline,
  VisualTimelineClip,
} from './types';

const logger = createLogger('VideoCaptionGenerate');

export { STT_CAPTION_ORIGIN } from './caption-retime';

export interface GenerateCaptionsOptions {
  /** Build cues only from saved analyses; never start transcription. */
  cachedOnly?: boolean;
  /** Look + animation applied to every generated cue. */
  style?: SubtitleStyle;
  /** Restrict generation to a single visual clip. */
  clipId?: string;
  /** Restrict generation to the clips of a single scene. */
  sceneId?: string;
  /** Words per caption cue. Defaults to a value derived from the style. */
  wordsPerCue?: number;
  /** Hard cap on a cue's on-screen duration. */
  maxCueMs?: number;
}

export type CaptionSkipReason =
  | 'no-asset'
  | 'no-audio'
  | 'no-source'
  | 'transcription-failed';

export interface GenerateCaptionsResult {
  project: VideoProject;
  cues: CaptionTimelineClip[];
  clipsTranscribed: number;
  clipsSkipped: number;
  /** Per-clip reason a clip produced no captions, so callers aren't left guessing. */
  skipped: Array<{ clipId: string; reason: CaptionSkipReason }>;
}

const DEFAULT_MAX_CUE_MS = 3_500;
const MIN_CUE_MS = 200;
// A pause longer than this between words forces a new cue — keeps captions
// reading in natural phrases rather than running silence together.
const PAUSE_BREAK_MS = 500;
// A leading soft hyphen marks a continuation glued to the previous piece.
// Caption text drops the mark and keeps the run in one word.
const GLUE_MARK = '­';
const SENTENCE_ENDING = /[.!?。！？…]["'”’)》\]]*$/u;
const MAX_PAIR_CHARS = 42;
const PAIRS = new Map<string, string>([
  ['“', '”'],
  ['‘', '’'],
  ['「', '」'],
  ['『', '』'],
  ['《', '》'],
  ['（', '）'],
  ['(', ')'],
  ['[', ']'],
  ['{', '}'],
  ['"', '"'],
]);

/**
 * Generates time-synced caption cues from the speech-to-text transcript of each
 * video clip's source, projecting the transcript's word timings onto the
 * timeline. This replaces the old behaviour of stamping the scene description as
 * the caption text — cue text and timing now come entirely from the audio.
 */
export async function generateProjectCaptions(
  projectId: string,
  options: GenerateCaptionsOptions = {},
): Promise<GenerateCaptionsResult> {
  const timeline = ensureTimeline(await getProject(projectId));
  const wordsPerCue = options.wordsPerCue ?? wordsPerCueForStyle(options.style);
  const maxCueMs = options.maxCueMs ?? DEFAULT_MAX_CUE_MS;

  const targets: VisualTimelineClip[] = [];
  for (const track of timeline.tracks) {
    if (track.kind !== 'video' || track.hidden) continue;
    for (const clip of track.clips) {
      if (clip.kind !== 'video') continue;
      if (options.clipId && clip.id !== options.clipId) continue;
      if (options.sceneId && clip.sceneId !== options.sceneId) continue;
      targets.push(clip);
    }
  }

  const cues: CaptionTimelineClip[] = [];
  const skipped: GenerateCaptionsResult['skipped'] = [];
  let clipsTranscribed = 0;

  for (const clip of targets) {
    const assetId =
      clip.sourceRef.kind === 'asset' ? clip.sourceRef.assetId : undefined;
    if (!assetId) {
      skipped.push({ clipId: clip.id, reason: 'no-asset' });
      continue;
    }
    // Re-read each iteration — a prior clip may have registered a source or
    // written an analysis for a shared asset.
    const current = await getProject(projectId);
    let source = resolveSourceForAsset(current, assetId);
    // An asset added via upload / linked-folder attach has no SourceMedia yet;
    // register one so it can be transcribed like an imported source.
    if (!source && !options.cachedOnly)
      source = await ensureSourceForAsset(projectId, assetId);
    if (!source) {
      const asset = current.assets.find((item) => item.id === assetId);
      skipped.push({
        clipId: clip.id,
        reason: asset?.metadata.audioTrackCount ? 'no-source' : 'no-audio',
      });
      continue;
    }
    const transcript = options.cachedOnly
      ? (await getSourceAnalysis(projectId, source.id))?.transcript
      : await resolveTranscript(projectId, source);
    if (!transcript) {
      skipped.push({ clipId: clip.id, reason: 'transcription-failed' });
      continue;
    }
    clipsTranscribed += 1;
    cues.push(
      ...buildClipCues({
        clip,
        source,
        assetId,
        transcript,
        wordsPerCue,
        maxCueMs,
        style: options.style,
      }),
    );
  }

  // Persist under the per-project lock, re-reading fresh so the source/analysis
  // rows written above aren't clobbered by a stale snapshot.
  const project = await updateProjectDocument(projectId, (currentProject) => ({
    ...currentProject,
    timeline: replaceSttCaptionClips(currentProject.timeline ?? timeline, cues),
    updatedAt: new Date().toISOString(),
  }));

  logger.info('video.captions.generated', {
    project_id: projectId,
    cues: cues.length,
    clips_transcribed: clipsTranscribed,
    clips_skipped: skipped.length,
  });
  return {
    project,
    cues,
    clipsTranscribed,
    clipsSkipped: skipped.length,
    skipped,
  };
}

function buildClipCues(input: {
  clip: VisualTimelineClip;
  source: SourceMedia;
  assetId: string;
  transcript: TranscriptData;
  wordsPerCue: number;
  maxCueMs: number;
  style?: SubtitleStyle;
}): CaptionTimelineClip[] {
  const { clip, source, assetId, transcript } = input;
  const words = transcriptWords(transcript).filter(
    (word) => word.endMs > clip.trimStartMs && word.startMs < clip.trimEndMs,
  );
  if (words.length === 0) return [];

  const speed = clip.playback?.speed || 1;
  const toTimeline = (sourceMs: number): number => {
    const clamped = Math.min(
      Math.max(sourceMs, clip.trimStartMs),
      clip.trimEndMs,
    );
    return clip.startMs + (clamped - clip.trimStartMs) / speed;
  };

  return chunkWords(words, input.wordsPerCue, input.maxCueMs).map(
    (chunk, index) => {
      const cueStartMs = Math.round(toTimeline(chunk[0]!.startMs));
      const cueEndMs = Math.round(toTimeline(chunk.at(-1)!.endMs));
      return {
        id: `clip-caption-stt-${clip.id}-${index + 1}`,
        kind: 'caption',
        name: 'Caption',
        sourceRef: clip.sourceRef,
        sceneId: clip.sceneId,
        startMs: cueStartMs,
        durationMs: Math.max(MIN_CUE_MS, cueEndMs - cueStartMs),
        trimStartMs: chunk[0]!.startMs,
        trimEndMs: chunk.at(-1)!.endMs,
        sourceDurationMs: clip.sourceDurationMs,
        text: cueText(chunk),
        style: input.style,
        words: chunk.map((word) => ({
          text: word.text,
          startMs: Math.round(toTimeline(word.startMs)),
          endMs: Math.round(toTimeline(word.endMs)),
        })),
        sourceAnchor: {
          sourceMediaId: assetId,
          sourceElementId: source.id,
          sourceStartMs: chunk[0]!.startMs,
          sourceEndMs: chunk.at(-1)!.endMs,
        },
        params: { origin: STT_CAPTION_ORIGIN, sourceId: source.id },
      };
    },
  );
}

/**
 * Finds the SourceMedia backing a timeline clip's asset. Matches by the
 * source's `mediaItemId` first, then falls back to content hash — assemble and
 * dedup can leave a clip pointing at a different asset record than the one the
 * source was imported as, even though they're the same underlying file.
 */
function resolveSourceForAsset(
  project: VideoProject,
  assetId: string,
): SourceMedia | undefined {
  const sources = project.sources ?? [];
  const direct = sources.find((source) => source.mediaItemId === assetId);
  if (direct) return direct;
  const assetHash = (project.assets ?? []).find((asset) => asset.id === assetId)
    ?.metadata?.contentHash;
  if (!assetHash) return undefined;
  return sources.find((source) => source.contentHash === assetHash);
}

function ensureTimeline(project: VideoProject): VideoTimeline {
  const timeline =
    project.timeline ?? migrateStoryboardToTimeline(project).timeline;
  if (!timeline) {
    throw new Error('Project has no timeline to caption');
  }
  return timeline;
}

async function resolveTranscript(
  projectId: string,
  source: SourceMedia,
): Promise<TranscriptData | undefined> {
  const existing = await getSourceAnalysis(projectId, source.id);
  if (existing?.transcript && hasTranscriptText(existing.transcript)) {
    return existing.transcript;
  }
  try {
    const { analysis } = await analyzeSource(projectId, source.id);
    return hasTranscriptText(analysis.transcript)
      ? analysis.transcript
      : undefined;
  } catch (error) {
    logger.warn('video.captions.transcribe_failed', {
      project_id: projectId,
      source_id: source.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return existing?.transcript;
  }
}

function hasTranscriptText(
  transcript?: TranscriptData,
): transcript is TranscriptData {
  if (!transcript) return false;
  if (transcript.words.some((word) => word.text.trim())) return true;
  return transcript.segments.some((segment) => segment.text.trim());
}

/**
 * Flattens a transcript into word-level cues. When the ASR engine returned
 * word-level timings we use them directly; when it only returned segment-level
 * text (e.g. the local SenseVoice model), we split each segment's text into
 * words and interpolate timings evenly across the segment's real start/end — so
 * captions are still roughly synced to speech instead of one static block.
 */
export function transcriptWords(transcript: TranscriptData): SubtitleWord[] {
  const wordLevel = transcript.words.filter((word) => word.text.trim());
  if (wordLevel.length > 0) return wordLevel;

  return transcript.segments.flatMap((segment) => {
    const tokens = segmentTokens(segment.text);
    if (tokens.length === 0) return [];
    const span = Math.max(0, segment.endMs - segment.startMs);
    const per = span / tokens.length;
    return tokens.map((token, index) => ({
      text: token,
      startMs: Math.round(segment.startMs + index * per),
      endMs: Math.round(segment.startMs + (index + 1) * per),
    }));
  });
}

/**
 * Splits a segment's text into words. Space-delimited scripts split on
 * whitespace as before; a single space-less blob (e.g. Chinese/Japanese) falls
 * back to Unicode word segmentation so it doesn't collapse into one giant word.
 */
function segmentTokens(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const spaceTokens = trimmed.split(/\s+/).filter(Boolean);
  if (spaceTokens.length > 1 || trimmed.length <= 1) return spaceTokens;
  const Segmenter = (Intl as { Segmenter?: typeof Intl.Segmenter }).Segmenter;
  if (typeof Segmenter !== 'function') return spaceTokens;
  try {
    const words = [
      ...new Segmenter(undefined, { granularity: 'word' }).segment(trimmed),
    ]
      .filter((entry) => entry.isWordLike)
      .map((entry) => entry.segment.trim())
      .filter(Boolean);
    return words.length > 1 ? words : spaceTokens;
  } catch {
    return spaceTokens;
  }
}

export function chunkWords(
  words: SubtitleWord[],
  wordsPerCue: number,
  maxCueMs: number,
): SubtitleWord[][] {
  const chunks: SubtitleWord[][] = [];
  let current: SubtitleWord[] = [];
  for (const word of words) {
    if (
      current.length > 0 &&
      breakBefore(current, word, wordsPerCue, maxCueMs)
    ) {
      chunks.push(current);
      current = [];
    }
    current.push(word);
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

function breakBefore(
  current: SubtitleWord[],
  next: SubtitleWord,
  wordsPerCue: number,
  maxCueMs: number,
): boolean {
  const previous = current.at(-1)!;
  if (gluedLatinRun(previous, next)) return false;
  // A sentence still ends the cue when its closing mark also closes the pair.
  // A period inside a pair that is still open does not.
  if (sentenceEnding(previous.text) && !hasUnclosedPair(current)) return true;
  if (insideMatchedPair(current, next)) return false;
  const start = current[0]!.startMs;
  const gap = next.startMs - previous.endMs;
  const overDuration = next.endMs - start > maxCueMs;
  const overCount = current.length >= wordsPerCue;
  const longPause = gap > PAUSE_BREAK_MS;
  // The word that ends the sentence stays with it when it still fits the
  // duration, instead of being left as its own cue by the word-count cap.
  if ((overCount || longPause) && !overDuration && sentenceEnding(next.text)) {
    return false;
  }
  return overCount || overDuration || longPause;
}

/** A transcriber-split Latin or digit run, marked by a leading glue character. */
function gluedLatinRun(previous: SubtitleWord, next: SubtitleWord): boolean {
  if (!next.text.startsWith(GLUE_MARK)) return false;
  const last = spokenText(previous.text).at(-1);
  const first = spokenText(next.text)[0];
  return (
    last !== undefined &&
    first !== undefined &&
    /[A-Za-z0-9]/.test(last) &&
    /[A-Za-z0-9]/.test(first)
  );
}

function sentenceEnding(token: string): boolean {
  return SENTENCE_ENDING.test(spokenText(token));
}

/**
 * The next word is inside punctuation opened in this cue, and the pair still
 * fits one caption line. A wider pair may break. An opener stays open until
 * its closer arrives, so a word-count cap cannot cut a title in half.
 */
function insideMatchedPair(
  current: SubtitleWord[],
  next: SubtitleWord,
): boolean {
  const currentChars = current.flatMap((word) => [...spokenText(word.text)]);
  const chars = [...currentChars, ...spokenText(next.text)];
  const nextAt = currentChars.length;
  const open: Array<{ close: string; at: number }> = [];
  let coversNext = false;
  chars.forEach((char, at) => {
    const match = lastMatchingOpen(open, char);
    if (match >= 0) {
      const opener = open[match]!;
      open.length = match;
      if (opener.at < nextAt && at >= nextAt && fitsPair(chars, opener.at)) {
        coversNext = true;
      }
      return;
    }
    const close = PAIRS.get(char);
    if (close !== undefined) open.push({ close, at });
  });
  const opener = open.at(-1);
  return coversNext || (opener !== undefined && fitsPair(chars, opener.at));
}

function hasUnclosedPair(words: SubtitleWord[]): boolean {
  const open: Array<{ close: string; at: number }> = [];
  for (const char of words.flatMap((word) => [...spokenText(word.text)])) {
    const match = lastMatchingOpen(open, char);
    if (match >= 0) {
      open.length = match;
      continue;
    }
    const close = PAIRS.get(char);
    if (close !== undefined) open.push({ close, at: open.length });
  }
  return open.length > 0;
}

function fitsPair(chars: readonly string[], openerAt: number): boolean {
  return chars.length - openerAt <= MAX_PAIR_CHARS;
}

function lastMatchingOpen(
  open: ReadonlyArray<{ close: string }>,
  char: string,
): number {
  for (let index = open.length - 1; index >= 0; index -= 1) {
    if (open[index]!.close === char) return index;
  }
  return -1;
}

function cueText(words: SubtitleWord[]): string {
  return words
    .map((word, index) => {
      const token = spokenText(word.text);
      if (!token) return '';
      if (index > 0 && !word.text.startsWith(GLUE_MARK)) return ` ${token}`;
      return token;
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

function spokenText(text: string): string {
  return text.replaceAll(GLUE_MARK, '').trim();
}

function wordsPerCueForStyle(style?: SubtitleStyle): number {
  switch (style?.animation) {
    case 'tiktok-word':
    case 'karaoke':
    case 'hormozi-bold':
      return 3;
    default:
      return 6;
  }
}

/**
 * Swaps the STT-generated cues on the primary caption track, preserving any
 * manually added or capture-origin caption clips and leaving translated tracks
 * untouched. Re-running generation is idempotent.
 */
function replaceSttCaptionClips(
  timeline: VideoTimeline,
  cues: CaptionTimelineClip[],
): VideoTimeline {
  const captionTrack = findPrimaryCaptionTrack(timeline);
  const preserved = (captionTrack?.clips ?? []).filter(
    (clip) => clip.params?.origin !== STT_CAPTION_ORIGIN,
  );
  const nextClips = [...preserved, ...cues].sort(
    (a, b) => a.startMs - b.startMs,
  );

  if (captionTrack) {
    const updated: CaptionTimelineTrack = { ...captionTrack, clips: nextClips };
    return {
      ...timeline,
      tracks: timeline.tracks.map((track) =>
        track.id === captionTrack.id ? updated : track,
      ),
    };
  }
  const newTrack: CaptionTimelineTrack = {
    id: PRIMARY_CAPTION_TRACK_ID,
    kind: 'caption',
    name: 'Captions',
    muted: false,
    locked: false,
    order: 30,
    clips: nextClips,
  };
  return { ...timeline, tracks: [...timeline.tracks, newTrack] };
}
