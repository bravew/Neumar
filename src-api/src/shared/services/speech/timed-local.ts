import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, unlinkSync } from 'node:fs';
import { mkdir, mkdtemp, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

import type { OfflineRecognizer } from 'sherpa-onnx-node';

import { resolveAppDir } from '@/config/app-dir';

import { loadSherpaOnnx } from './local-models';
import type { LocalModelStatus, WordTimestamp } from './types';

const execFileAsync = promisify(execFile);

export const TIMED_STT_MODEL = {
  name: 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8',
  size: '487 MB',
  sha256: '5793d0fd397c5778d2cf2126994d58e9d56b1be7c04d13c7a15bb1b4eafb16bf',
  url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2',
  languages: [
    'bg',
    'hr',
    'cs',
    'da',
    'nl',
    'en',
    'et',
    'fi',
    'fr',
    'de',
    'el',
    'hu',
    'it',
    'lv',
    'lt',
    'mt',
    'pl',
    'pt',
    'ro',
    'sk',
    'sl',
    'es',
    'sv',
    'ru',
    'uk',
  ],
} as const;

const SAMPLE_RATE = 16_000;
const CHUNK_SECONDS = 30;
const REQUIRED_FILES = [
  'encoder.int8.onnx',
  'decoder.int8.onnx',
  'joiner.int8.onnx',
  'tokens.txt',
];
let recognizer: OfflineRecognizer | null = null;
let loading: Promise<void> | null = null;
let progress: { downloadedBytes: number; totalBytes: number } | null = null;
let phase: 'downloading' | 'extracting' | 'loading' | null = null;
let error: string | null = null;

export class LocalTimingError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'local-model-not-ready'
      | 'timing-unavailable'
      | 'unsupported-language',
  ) {
    super(message);
    this.name = 'LocalTimingError';
  }
}

function cacheDir(): string {
  // New optional models are user-managed even when the desktop bundles SenseVoice.
  return join(resolveAppDir(), 'cache', 'speech');
}

function modelDir(): string {
  return join(cacheDir(), TIMED_STT_MODEL.name);
}

function installed(): boolean {
  return REQUIRED_FILES.every((file) => existsSync(join(modelDir(), file)));
}

export function getTimedSTTModelStatus(): LocalModelStatus {
  const metadata = {
    model: TIMED_STT_MODEL.name,
    size: TIMED_STT_MODEL.size,
    timing: 'word' as const,
    languages: TIMED_STT_MODEL.languages,
  };
  if (recognizer) return { ...metadata, state: 'ready' };
  if (error) return { ...metadata, state: 'error', error };
  if (progress)
    return {
      ...metadata,
      state: 'downloading',
      downloadProgress: { ...progress },
      phase: 'Downloading...',
    };
  if (phase || loading)
    return {
      ...metadata,
      state: phase === 'extracting' ? 'downloading' : 'loading',
      phase:
        phase === 'extracting' ? 'Extracting archive...' : 'Loading model...',
    };
  return { ...metadata, state: installed() ? 'ready' : 'not_downloaded' };
}

async function loadInstalled(): Promise<void> {
  if (recognizer) return;
  if (!installed()) {
    throw new LocalTimingError(
      'Local word timing requires Parakeet TDT v3 (487 MB). Download it explicitly in the local speech model manager before transcribing. SenseVoice provides text and token starts, but no word durations.',
      'local-model-not-ready',
    );
  }
  phase = 'loading';
  const sherpa = await loadSherpaOnnx();
  const config = {
    featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
    modelConfig: {
      transducer: {
        encoder: join(modelDir(), 'encoder.int8.onnx'),
        decoder: join(modelDir(), 'decoder.int8.onnx'),
        joiner: join(modelDir(), 'joiner.int8.onnx'),
      },
      tokens: join(modelDir(), 'tokens.txt'),
      modelType: 'nemo_transducer',
      numThreads: 2,
      provider: 'cpu',
    },
  };
  recognizer = sherpa.OfflineRecognizer.createAsync
    ? await sherpa.OfflineRecognizer.createAsync(config)
    : new sherpa.OfflineRecognizer(config);
}

async function ensureLoaded(): Promise<void> {
  if (recognizer) return;
  if (loading) return loading;
  loading = loadInstalled().finally(() => {
    phase = null;
    loading = null;
  });
  return loading;
}

/** Explicit model-manager action. Inference never calls this download entry point. */
export async function downloadTimedSTTModel(): Promise<void> {
  if (recognizer) return;
  if (loading) return loading;
  error = null;
  loading = (async () => {
    try {
      if (!installed()) {
        await mkdir(cacheDir(), { recursive: true });
        const staging = await mkdtemp(join(cacheDir(), '.parakeet-download-'));
        const downloaded = join(staging, `${TIMED_STT_MODEL.name}.tar.bz2`);
        try {
          // Verify the upstream archive digest before publishing model files.
          const response = await fetch(TIMED_STT_MODEL.url, {
            redirect: 'follow',
            signal: AbortSignal.timeout(15 * 60 * 1_000),
          });
          if (!response.ok || !response.body)
            throw new Error(
              `Parakeet download failed: ${response.status} ${response.statusText}`,
            );
          await mkdir(staging, { recursive: true });
          const stream = createWriteStream(downloaded);
          const digest = createHash('sha256');
          const reader = response.body.getReader();
          try {
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              digest.update(value);
              if (!stream.write(value))
                await new Promise((resolve) => stream.once('drain', resolve));
              progress = {
                downloadedBytes:
                  (progress?.downloadedBytes ?? 0) + value.byteLength,
                totalBytes: Number(response.headers.get('content-length') ?? 0),
              };
            }
            stream.end();
            await new Promise<void>((resolve, reject) => {
              stream.on('finish', resolve);
              stream.on('error', reject);
            });
          } catch (cause) {
            stream.destroy();
            throw cause;
          }
          const actual = digest.digest('hex');
          if (actual !== TIMED_STT_MODEL.sha256)
            throw new Error(
              'Parakeet archive failed integrity verification. Retry the explicit download.',
            );
          phase = 'extracting';
          await execFileAsync('tar', ['-xjf', downloaded, '-C', staging]);
          unlinkSync(downloaded);
          const extracted = join(staging, TIMED_STT_MODEL.name);
          if (
            !REQUIRED_FILES.every((file) => existsSync(join(extracted, file)))
          )
            throw new Error(
              'Parakeet download is incomplete. Retry the explicit download.',
            );
          // Preserve an existing incomplete install for inspection and recovery.
          if (existsSync(modelDir()))
            await rename(modelDir(), `${modelDir()}.incomplete-${Date.now()}`);
          await rename(extracted, modelDir());
        } finally {
          await rm(staging, { recursive: true, force: true });
        }
      }
      await loadInstalled();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
      throw cause;
    } finally {
      loading = null;
      phase = null;
      progress = null;
    }
  })();
  return loading;
}

/** Parse native TDT subwords into words using only model-provided intervals. */
interface TdtGroup {
  word: string;
  start: number;
  end: number;
  /** Native end extends past this decode window; only the window start is usable. */
  truncated: boolean;
}

function groupsFromTdtResult(
  raw: unknown,
  duration: number,
): {
  text: string;
  groups: TdtGroup[];
} {
  if (
    typeof raw !== 'object' ||
    raw === null ||
    !('text' in raw) ||
    typeof raw.text !== 'string' ||
    !('tokens' in raw) ||
    !Array.isArray(raw.tokens) ||
    !('timestamps' in raw) ||
    !Array.isArray(raw.timestamps) ||
    !('durations' in raw) ||
    !Array.isArray(raw.durations)
  ) {
    throw new LocalTimingError(
      'Local engine did not return token starts and durations.',
      'timing-unavailable',
    );
  }
  const { tokens, timestamps, durations, text } = raw;
  if (
    tokens.length !== timestamps.length ||
    tokens.length !== durations.length ||
    (text.trim() && tokens.length === 0)
  ) {
    throw new LocalTimingError(
      'Local engine returned incomplete token timing.',
      'timing-unavailable',
    );
  }
  const groups: TdtGroup[] = [];
  let current: TdtGroup | undefined;
  let previousStart = -1;
  const flush = () => {
    if (!current) return;
    groups.push(current);
    current = undefined;
  };
  for (let i = 0; i < tokens.length; i++) {
    const token: unknown = tokens[i];
    const start: unknown = timestamps[i];
    const span: unknown = durations[i];
    // Zero-duration tokens are real TDT output: subwords sharing one frame, and
    // window-edge tokens whose duration the engine could not measure. They must
    // not invent an end time, and a window-edge token must not claim an interval.
    if (
      typeof token !== 'string' ||
      typeof start !== 'number' ||
      typeof span !== 'number' ||
      !Number.isFinite(start) ||
      !Number.isFinite(span) ||
      start < 0 ||
      span < 0 ||
      start < previousStart
    ) {
      throw new LocalTimingError(
        'Local engine returned invalid token timing.',
        'timing-unavailable',
      );
    }
    previousStart = start;
    if (/^<.*>$/.test(token))
      throw new LocalTimingError(
        'Local engine returned an unsupported special token.',
        'timing-unavailable',
      );
    // SentencePiece uses ▁; sherpa may render it as an ordinary leading space.
    const pieces = token.replaceAll('▁', ' ').split(/(\s+)/u);
    if (pieces.filter((piece) => piece.trim()).length > 1)
      throw new LocalTimingError(
        'A token spans multiple words without separate timing.',
        'timing-unavailable',
      );
    const truncated = start + span > duration + 1e-6;
    for (const piece of pieces) {
      if (!piece) continue;
      if (/^\s+$/u.test(piece)) {
        flush();
        continue;
      }
      if (!current) {
        current = {
          word: piece,
          start,
          end: start + span,
          truncated,
        };
      } else {
        current.word += piece;
        current.end = Math.max(current.end, start + span);
        current.truncated ||= truncated;
      }
    }
  }
  flush();
  // Keep token grouping faithful to the recognized transcript before any drops.
  if (
    groups
      .map((group) => group.word)
      .join('')
      .replaceAll(/\s/gu, '') !== text.replaceAll(/\s/gu, '')
  ) {
    throw new LocalTimingError(
      'Local token timing does not cover the recognized transcript.',
      'timing-unavailable',
    );
  }
  return { text, groups };
}

export function wordsFromTdtResult(
  raw: unknown,
  duration: number,
  offset = 0,
): WordTimestamp[] {
  const { groups } = groupsFromTdtResult(raw, duration);
  const measured = groups.filter(
    (group) => group.end > group.start && !group.truncated,
  );
  for (let i = 1; i < measured.length; i++) {
    if (measured[i]!.start < measured[i - 1]!.end - 1e-6)
      throw new LocalTimingError(
        'Local engine returned overlapping word timing.',
        'timing-unavailable',
      );
  }
  // A word that cannot be timed without inventing an interval is omitted rather
  // than given a fabricated one; the remaining words stay editable.
  return measured.map((group) => ({
    word: group.word,
    startMs: Math.round((offset + group.start) * 1000),
    endMs: Math.round((offset + group.end) * 1000),
  }));
}

/**
 * Transcript text for the region this chunk owns, dropping the 2 s of decode
 * context on either side. The raw engine text covers the whole window, so
 * using it directly repeats the context speech at every chunk seam.
 *
 * Grouping is by group start, not word midpoint: an untimeable group (zero
 * duration or window-truncated) still owns its place in the text, so untimed
 * words are not silently dropped from the transcript.
 */
export function ownedTextFromTdtResult(
  raw: unknown,
  duration: number,
  offset: number,
  ownStartMs: number,
  ownEndMs: number,
): string {
  const { groups } = groupsFromTdtResult(raw, duration);
  return groups
    .filter((group) => {
      const absoluteStartMs = (offset + group.start) * 1000;
      return absoluteStartMs >= ownStartMs && absoluteStartMs < ownEndMs;
    })
    .map((group) => group.word)
    .join(' ')
    .trim();
}

export async function transcribeTimedLocal(
  samples: Float32Array,
  sampleRate: number,
  language?: string,
  signal?: AbortSignal,
): Promise<{ text: string; words: WordTimestamp[] }> {
  signal?.throwIfAborted();
  const hint = language?.toLowerCase().split(/[-_]/)[0];
  if (
    hint &&
    hint !== 'auto' &&
    !TIMED_STT_MODEL.languages.some((item) => item === hint)
  ) {
    throw new LocalTimingError(
      `Parakeet TDT v3 supports 25 European languages; ${language} is not supported. SenseVoice remains available for ordinary text transcription.`,
      'unsupported-language',
    );
  }
  if (sampleRate !== SAMPLE_RATE || samples.length === 0)
    throw new Error(
      'Local timed transcription requires nonempty 16 kHz mono audio.',
    );
  await ensureLoaded();
  const engine = recognizer;
  if (!engine)
    throw new LocalTimingError(
      'Local timing model is not loaded.',
      'local-model-not-ready',
    );
  const words: WordTimestamp[] = [];
  const texts: string[] = [];
  const chunkSize = CHUNK_SECONDS * sampleRate;
  const context = 2 * sampleRate;
  for (let start = 0; start < samples.length; start += chunkSize) {
    signal?.throwIfAborted();
    // Context on both sides lets the decoder hear complete words at ownership seams.
    const windowStart = Math.max(0, start - context);
    const windowEnd = Math.min(start + chunkSize + context, samples.length);
    const chunk = samples.subarray(windowStart, windowEnd);
    const stream = engine.createStream();
    stream.acceptWaveform({ samples: chunk, sampleRate });
    // Installed 1.13.8 supports nonblocking inference; bundled older runtimes may not.
    const raw: unknown =
      'decodeAsync' in engine && typeof engine.decodeAsync === 'function'
        ? await engine.decodeAsync(stream)
        : (engine.decode(stream), engine.getResult(stream));
    signal?.throwIfAborted();
    const chunkWords = wordsFromTdtResult(
      raw,
      chunk.length / sampleRate,
      windowStart / sampleRate,
    );
    // Text covers only what this chunk owns: the raw engine text spans the whole
    // decode window, so it would repeat the context speech at every seam.
    texts.push(
      ownedTextFromTdtResult(
        raw,
        chunk.length / sampleRate,
        windowStart / sampleRate,
        (start / sampleRate) * 1000,
        (Math.min(start + chunkSize, samples.length) / sampleRate) * 1000,
      ),
    );
    words.push(
      ...chunkWords.filter((word) => {
        const midpoint = (word.startMs + word.endMs) / 2;
        return (
          midpoint >= (start / sampleRate) * 1000 &&
          midpoint <
            (Math.min(start + chunkSize, samples.length) / sampleRate) * 1000
        );
      }),
    );
    // Older bundled sync runtimes must still let cancellation/HTTP work run between chunks.
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  for (let i = 1; i < words.length; i++) {
    if (words[i]!.startMs < words[i - 1]!.endMs)
      throw new LocalTimingError(
        'Local timing is inconsistent across chunk boundaries. Retry with a shorter audio range.',
        'timing-unavailable',
      );
  }
  // Each chunk's text covers only its owned region, so the joined transcript
  // contains no duplicated context speech. Untimed groups still contribute
  // their text; only their timing is unavailable.
  return { text: texts.filter(Boolean).join(' '), words };
}
