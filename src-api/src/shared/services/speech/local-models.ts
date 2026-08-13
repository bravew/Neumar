/**
 * Local Speech Models
 *
 * Manages on-device speech models for offline STT and TTS:
 *   - STT: SenseVoice (sherpa-onnx) — multilingual with emotion & audio event detection
 *   - TTS: Kokoro — high-quality, multi-language neural TTS
 *   - TTS: Pocket-TTS — 100M param model with voice cloning support
 *   - TTS: Kitten TTS — 15M param ultra-lightweight model
 *
 * Model archives are streamed from GitHub releases, extracted, and cached locally.
 * sherpa-onnx-node provides the native inference runtime.
 *
 * @module speech/local-models
 */

import { execFile } from 'node:child_process';
// ---------------------------------------------------------------------------
// Per-model engine state
// ---------------------------------------------------------------------------
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import type { OfflineRecognizer, OfflineTts } from 'sherpa-onnx-node';

import { APP_SLUG } from '@/config/branding';

import { createLogger } from '@/shared/utils/logger';

import type { LocalModelStatus } from './types';

const execFileAsync = promisify(execFile);
const logger = createLogger('SpeechModels');

// ---------------------------------------------------------------------------
// Branding slug with fallback
// ---------------------------------------------------------------------------

const APP_SLUG_SAFE: string = APP_SLUG ?? 'neumar';

// ---------------------------------------------------------------------------
// TTS Model ID type
// ---------------------------------------------------------------------------

export type TtsModelId = 'kokoro' | 'pocket' | 'kitten';

// ---------------------------------------------------------------------------
// Model info constants
// ---------------------------------------------------------------------------

const STT_MODEL = {
  name: 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17',
  size: '228 MB',
  url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17.tar.bz2',
} as const;

const TTS_MODELS: Record<
  TtsModelId,
  { name: string; size: string; url: string }
> = {
  kokoro: {
    name: 'kokoro-multi-lang-v1_0',
    size: '180 MB',
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-multi-lang-v1_0.tar.bz2',
  },
  pocket: {
    name: 'sherpa-onnx-pocket-tts-int8-2026-01-26',
    size: '94 MB',
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/sherpa-onnx-pocket-tts-int8-2026-01-26.tar.bz2',
  },
  kitten: {
    name: 'kitten-nano-en-v0_1-fp16',
    size: '26 MB',
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kitten-nano-en-v0_1-fp16.tar.bz2',
  },
};

/**
 * Sample rate expected by sherpa-onnx TTS (Kokoro) output.
 * Exported so adapters can embed the correct rate into WAV headers without
 * needing to hardcode the value independently.
 */
const TTS_SAMPLE_RATE = 24_000; // Hz — Kokoro outputs at 24 kHz
const STT_SAMPLE_RATE = 16_000; // Hz — SenseVoice expects 16 kHz
const STT_FEATURE_DIM = 80;
const STT_NUM_THREADS = 2;
const TTS_NUM_THREADS = 1;

// ---------------------------------------------------------------------------
// sherpa-onnx-node loader (works in both dev and pkg binary)
// ---------------------------------------------------------------------------

type SherpaModule = {
  OfflineRecognizer: new (config: Record<string, unknown>) => OfflineRecognizer;
  OfflineTts: new (config: Record<string, unknown>) => OfflineTts;
  readWave: (path: string) => { samples: Float32Array; sampleRate: number };
};

let cachedSherpa: SherpaModule | null = null;

/**
 * Resolve the path to the bundled sherpa-onnx native module in Tauri Resources.
 * Returns null if not in a Tauri production build or the bundle doesn't exist.
 */
function resolveBundledSherpaPath(): string | null {
  const resourcesDir = process.env.RESOURCES_DIR;
  if (!resourcesDir) {
    logger.debug('RESOURCES_DIR not set, skipping bundled sherpa-onnx lookup');
    return null;
  }

  const bundledDir = join(
    resourcesDir,
    '_up_',
    'src-api',
    'dist',
    'sherpa-onnx',
  );

  if (existsSync(bundledDir)) {
    return bundledDir;
  }

  logger.warn(
    `Bundled sherpa-onnx not found at: ${bundledDir} (RESOURCES_DIR=${resourcesDir})`,
  );
  return null;
}

/**
 * Load sherpa-onnx-node with environment-aware strategy:
 *
 * - Production (Tauri/pkg binary): Load from bundled native files in Resources.
 *   The build step copies the JS + native .node/.dylib files to dist/sherpa-onnx/
 *   which Tauri bundles into Resources. We require() from that absolute path
 *   so addon.js finds sherpa-onnx.node in the same directory (./sherpa-onnx.node).
 *
 * - Development (tsx/ESM): Dynamic import() resolves via pnpm symlinks.
 */
async function loadSherpaOnnx(): Promise<SherpaModule> {
  if (cachedSherpa) return cachedSherpa;

  // Production: load from bundled native files in Tauri Resources
  const bundledPath = resolveBundledSherpaPath();
  if (bundledPath) {
    logger.info(`Loading sherpa-onnx from bundled path: ${bundledPath}`);
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require(bundledPath) as Record<string, unknown>;
      cachedSherpa = (mod.default ?? mod) as SherpaModule;
      return cachedSherpa;
    } catch (err) {
      logger.error(
        `Failed to load bundled sherpa-onnx from ${bundledPath}:`,
        err,
      );
      throw err;
    }
  }

  // Inside a pkg binary, bare require('sherpa-onnx-node') resolves from the VFS
  // snapshot where native .node addons don't exist. Fail early with a clear message.
  // @ts-expect-error - pkg specific property
  if (process.pkg) {
    throw new Error(
      `sherpa-onnx-node native addon not found in Tauri Resources. ` +
        `RESOURCES_DIR=${process.env.RESOURCES_DIR ?? '(not set)'}. ` +
        `Ensure the build step copied native files to dist/sherpa-onnx/.`,
    );
  }

  // Development: prefer require() since sherpa-onnx-node is a CJS native module.
  // Dynamic import() is kept as a fallback for ESM-only environments,
  // but it fails in pkg binary vm contexts (ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING)
  // so require() must be tried first.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('sherpa-onnx-node') as Record<string, unknown>;
    cachedSherpa = (mod.default ?? mod) as SherpaModule;
  } catch {
    // Fallback: dynamic import (works in true ESM contexts, e.g. tsx --import)
    const mod = await import('sherpa-onnx-node');
    cachedSherpa = (mod.default ?? mod) as SherpaModule;
  }

  return cachedSherpa;
}

interface TtsEngineState {
  engine: OfflineTts | null;
  loading: Promise<void> | null;
  downloadProgress: { downloadedBytes: number; totalBytes: number } | null;
  error: string | null;
  phase: 'downloading' | 'extracting' | 'loading' | null;
}

function createEmptyTtsState(): TtsEngineState {
  return {
    engine: null,
    loading: null,
    downloadProgress: null,
    error: null,
    phase: null,
  };
}

const ttsStates = new Map<TtsModelId, TtsEngineState>([
  ['kokoro', createEmptyTtsState()],
  ['pocket', createEmptyTtsState()],
  ['kitten', createEmptyTtsState()],
]);

function getTtsState(modelId: TtsModelId): TtsEngineState {
  let state = ttsStates.get(modelId);
  if (!state) {
    state = createEmptyTtsState();
    ttsStates.set(modelId, state);
  }
  return state;
}

// STT (SenseVoice OfflineRecognizer) — stays as singleton
let sttRecognizer: OfflineRecognizer | null = null;
let sttLoading: Promise<void> | null = null;
let sttDownloadProgress: {
  downloadedBytes: number;
  totalBytes: number;
} | null = null;
let sttError: string | null = null;
let sttPhase: 'downloading' | 'extracting' | 'loading' | null = null;

// ---------------------------------------------------------------------------
// Cache directory resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the speech model cache directory.
 *
 * Production (Tauri bundle): RESOURCES_DIR env var is set, pointing to the
 * app's Contents/Resources/ folder. The sidecar's bundled models live under
 * `../src-api/dist/models/speech/` relative to the resources root.
 *
 * Development / fallback: models are cached to `~/.neumar/cache/speech/`.
 */
function getModelCacheDir(): string {
  // Production: use bundled path when RESOURCES_DIR is set by Tauri
  if (process.env.RESOURCES_DIR) {
    const bundledDir = join(
      process.env.RESOURCES_DIR,
      '_up_',
      'src-api',
      'dist',
      'models',
      'speech',
    );
    if (existsSync(bundledDir)) {
      logger.info(`Using bundled speech models from: ${bundledDir}`);
      return bundledDir;
    }
  }

  // Development / fallback: download to user cache directory
  const home = homedir();
  const cacheDir = join(home, `.${APP_SLUG_SAFE}`, 'cache', 'speech');
  mkdirSync(cacheDir, { recursive: true });
  return cacheDir;
}

// ---------------------------------------------------------------------------
// Cloned voice storage directory
// ---------------------------------------------------------------------------

function getClonedVoicesDir(): string {
  const home = homedir();
  const dir = join(
    home,
    `.${APP_SLUG_SAFE}`,
    'cache',
    'speech',
    'cloned-voices',
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ---------------------------------------------------------------------------
// Download + extraction helpers
// ---------------------------------------------------------------------------

/**
 * Stream-download a tar.bz2 archive from a URL with progress tracking,
 * then extract it into the target directory.
 */
async function downloadAndExtract(
  url: string,
  cacheDir: string,
  progressRef: { downloadedBytes: number; totalBytes: number },
  setProgress: (
    p: { downloadedBytes: number; totalBytes: number } | null,
  ) => void,
  setPhase: (phase: 'downloading' | 'extracting' | 'loading' | null) => void,
): Promise<void> {
  // --- Download ---
  setPhase('downloading');
  const archiveName = url.split('/').pop()!;
  const archivePath = join(cacheDir, archiveName);

  logger.info(`Downloading ${archiveName} from ${url}`);

  const DOWNLOAD_TIMEOUT_MS = 15 * 60 * 1_000; // 15 minutes for large archives
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(
      `Download failed: ${response.status} ${response.statusText}`,
    );
  }

  const contentLength = parseInt(
    response.headers.get('content-length') ?? '0',
    10,
  );
  progressRef.downloadedBytes = 0;
  progressRef.totalBytes = contentLength || 0;
  setProgress(progressRef);

  if (!response.body) {
    throw new Error('Download returned empty response body');
  }

  const dest = createWriteStream(archivePath);
  const reader = response.body.getReader();

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      dest.write(value);
      progressRef.downloadedBytes += value.byteLength;
      setProgress(progressRef);
    }
    dest.end();

    await new Promise<void>((resolve, reject) => {
      dest.on('finish', resolve);
      dest.on('error', reject);
    });
  } catch (err) {
    dest.destroy();
    throw err;
  }

  setProgress(null);
  logger.info(`Download complete: ${archivePath}`);

  // --- Extract ---
  setPhase('extracting');
  logger.info(`Extracting ${archiveName} to ${cacheDir}`);

  await execFileAsync('tar', ['-xjf', archivePath, '-C', cacheDir]);

  // Clean up archive file
  try {
    unlinkSync(archivePath);
  } catch {
    /* best-effort cleanup */
  }

  logger.info(`Extraction complete`);
}

/**
 * Remove a corrupted model directory so the next retry triggers a fresh download.
 */
function removeCorruptedModelDir(modelDir: string, label: string): boolean {
  try {
    rmSync(modelDir, { recursive: true, force: true });
    logger.warn(`Removed corrupted ${label} model directory: ${modelDir}`);
    return true;
  } catch (err) {
    logger.error(
      `Failed to remove corrupted ${label} model directory: ${modelDir}`,
      err,
    );
    return false;
  }
}

// ---------------------------------------------------------------------------
// STT model loading
// ---------------------------------------------------------------------------

/**
 * Load the STT recognizer singleton (SenseVoice via sherpa-onnx-node).
 */
async function loadSTTRecognizer(): Promise<void> {
  if (sttRecognizer) return;

  const cacheDir = getModelCacheDir();
  const modelDir = join(cacheDir, STT_MODEL.name);

  // Download if needed
  if (!existsSync(modelDir)) {
    const progress = { downloadedBytes: 0, totalBytes: 0 };
    await downloadAndExtract(
      STT_MODEL.url,
      cacheDir,
      progress,
      (p) => {
        sttDownloadProgress = p;
      },
      (p) => {
        sttPhase = p;
      },
    );
  }

  // Verify key files — remove partial directory so Retry triggers a fresh download
  const modelFile = join(modelDir, 'model.int8.onnx');
  const tokensFile = join(modelDir, 'tokens.txt');
  if (!existsSync(modelFile) || !existsSync(tokensFile)) {
    const removed = removeCorruptedModelDir(modelDir, 'STT');
    throw new Error(
      removed
        ? 'STT model files are incomplete and have been removed. Please retry to download a fresh copy.'
        : `STT model files are incomplete but could not be cleaned up. Please manually delete "${modelDir}" and retry.`,
    );
  }

  // Load sherpa-onnx recognizer
  sttPhase = 'loading';
  logger.info('Loading STT recognizer (SenseVoice)...');

  const sherpa = await loadSherpaOnnx();
  try {
    sttRecognizer = new sherpa.OfflineRecognizer({
      featConfig: {
        sampleRate: STT_SAMPLE_RATE,
        featureDim: STT_FEATURE_DIM,
      },
      modelConfig: {
        senseVoice: {
          model: modelFile,
          language: 'auto',
          useInverseTextNormalization: 1,
        },
        tokens: tokensFile,
        numThreads: STT_NUM_THREADS,
        provider: 'cpu',
      },
    });
  } catch (loadErr) {
    logger.warn('STT model load failed, removing corrupted files', loadErr);
    const removed = removeCorruptedModelDir(modelDir, 'STT');
    throw new Error(
      removed
        ? 'STT model files are corrupted and have been removed. Please retry to download a fresh copy.'
        : `STT model files are corrupted but could not be cleaned up. Please manually delete "${modelDir}" and retry.`,
    );
  }

  sttPhase = null;
  logger.info('STT recognizer loaded successfully');
}

// ---------------------------------------------------------------------------
// TTS model loading — Kokoro
// ---------------------------------------------------------------------------

async function loadKokoroEngine(): Promise<void> {
  const state = getTtsState('kokoro');
  if (state.engine) return;

  const cacheDir = getModelCacheDir();
  const model = TTS_MODELS.kokoro;
  const modelDir = join(cacheDir, model.name);

  if (!existsSync(modelDir)) {
    const progress = { downloadedBytes: 0, totalBytes: 0 };
    await downloadAndExtract(
      model.url,
      cacheDir,
      progress,
      (p) => {
        state.downloadProgress = p;
      },
      (p) => {
        state.phase = p;
      },
    );
  }

  const modelFile = join(modelDir, 'model.onnx');
  const tokensFile = join(modelDir, 'tokens.txt');
  const voicesFile = join(modelDir, 'voices.bin');
  if (
    !existsSync(modelFile) ||
    !existsSync(tokensFile) ||
    !existsSync(voicesFile)
  ) {
    const removed = removeCorruptedModelDir(modelDir, 'Kokoro TTS');
    throw new Error(
      removed
        ? 'Kokoro TTS model files are incomplete and have been removed. Please retry to download a fresh copy.'
        : `Kokoro TTS model files are incomplete but could not be cleaned up. Please manually delete "${modelDir}" and retry.`,
    );
  }

  state.phase = 'loading';
  logger.info('Loading TTS engine (Kokoro)...');

  const sherpa = await loadSherpaOnnx();
  try {
    state.engine = new sherpa.OfflineTts({
      model: {
        kokoro: {
          model: modelFile,
          voices: voicesFile,
          tokens: tokensFile,
          dataDir: join(modelDir, 'espeak-ng-data'),
          lexicon: [
            join(modelDir, 'lexicon-us-en.txt'),
            join(modelDir, 'lexicon-zh.txt'),
          ]
            .filter((f) => existsSync(f))
            .join(','),
        },
      },
      maxNumSentences: 1,
      numThreads: TTS_NUM_THREADS,
      provider: 'cpu',
    });
  } catch (loadErr) {
    logger.warn(
      'Kokoro TTS model load failed, removing corrupted files',
      loadErr,
    );
    const removed = removeCorruptedModelDir(modelDir, 'Kokoro TTS');
    throw new Error(
      removed
        ? 'Kokoro TTS model files are corrupted and have been removed. Please retry to download a fresh copy.'
        : `Kokoro TTS model files are corrupted but could not be cleaned up. Please manually delete "${modelDir}" and retry.`,
    );
  }

  state.phase = null;
  logger.info(
    `Kokoro TTS engine loaded (speakers: ${state.engine.numSpeakers}, sampleRate: ${state.engine.sampleRate})`,
  );
}

// ---------------------------------------------------------------------------
// TTS model loading — Pocket-TTS
// ---------------------------------------------------------------------------

async function loadPocketTTSEngine(): Promise<void> {
  const state = getTtsState('pocket');
  if (state.engine) return;

  const cacheDir = getModelCacheDir();
  const model = TTS_MODELS.pocket;
  const modelDir = join(cacheDir, model.name);

  if (!existsSync(modelDir)) {
    const progress = { downloadedBytes: 0, totalBytes: 0 };
    await downloadAndExtract(
      model.url,
      cacheDir,
      progress,
      (p) => {
        state.downloadProgress = p;
      },
      (p) => {
        state.phase = p;
      },
    );
  }

  // Pocket-TTS (int8) uses flow-matching architecture with multiple ONNX files
  const lmFlow = join(modelDir, 'lm_flow.int8.onnx');
  const lmMain = join(modelDir, 'lm_main.int8.onnx');
  const encoder = join(modelDir, 'encoder.onnx');
  const decoder = join(modelDir, 'decoder.int8.onnx');
  const textConditioner = join(modelDir, 'text_conditioner.onnx');
  const vocabJson = join(modelDir, 'vocab.json');
  const tokenScoresJson = join(modelDir, 'token_scores.json');

  if (!existsSync(lmFlow) || !existsSync(encoder) || !existsSync(decoder)) {
    const removed = removeCorruptedModelDir(modelDir, 'Pocket-TTS');
    throw new Error(
      removed
        ? 'Pocket-TTS model files are incomplete and have been removed. Please retry to download a fresh copy.'
        : `Pocket-TTS model files are incomplete but could not be cleaned up. Please manually delete "${modelDir}" and retry.`,
    );
  }

  state.phase = 'loading';
  logger.info('Loading TTS engine (Pocket-TTS)...');

  const sherpa = await loadSherpaOnnx();
  try {
    state.engine = new sherpa.OfflineTts({
      model: {
        pocket: {
          lmFlow: existsSync(lmFlow) ? lmFlow : undefined,
          lmMain: existsSync(lmMain) ? lmMain : undefined,
          encoder: existsSync(encoder) ? encoder : undefined,
          decoder: existsSync(decoder) ? decoder : undefined,
          textConditioner: existsSync(textConditioner)
            ? textConditioner
            : undefined,
          vocabJson: existsSync(vocabJson) ? vocabJson : undefined,
          tokenScoresJson: existsSync(tokenScoresJson)
            ? tokenScoresJson
            : undefined,
        },
      },
      maxNumSentences: 1,
      numThreads: TTS_NUM_THREADS,
      provider: 'cpu',
    });
  } catch (loadErr) {
    logger.warn(
      'Pocket-TTS model load failed, removing corrupted files',
      loadErr,
    );
    const removed = removeCorruptedModelDir(modelDir, 'Pocket-TTS');
    throw new Error(
      removed
        ? 'Pocket-TTS model files are corrupted and have been removed. Please retry to download a fresh copy.'
        : `Pocket-TTS model files are corrupted but could not be cleaned up. Please manually delete "${modelDir}" and retry.`,
    );
  }

  state.phase = null;
  logger.info(
    `Pocket-TTS engine loaded (speakers: ${state.engine.numSpeakers}, sampleRate: ${state.engine.sampleRate})`,
  );
}

// ---------------------------------------------------------------------------
// TTS model loading — Kitten TTS
// ---------------------------------------------------------------------------

async function loadKittenTTSEngine(): Promise<void> {
  const state = getTtsState('kitten');
  if (state.engine) return;

  const cacheDir = getModelCacheDir();
  const model = TTS_MODELS.kitten;
  const modelDir = join(cacheDir, model.name);

  if (!existsSync(modelDir)) {
    const progress = { downloadedBytes: 0, totalBytes: 0 };
    await downloadAndExtract(
      model.url,
      cacheDir,
      progress,
      (p) => {
        state.downloadProgress = p;
      },
      (p) => {
        state.phase = p;
      },
    );
  }

  // Kitten nano uses FP16 model file
  const modelFile = join(modelDir, 'model.fp16.onnx');
  const voicesFile = join(modelDir, 'voices.bin');
  const tokensFile = join(modelDir, 'tokens.txt');
  const espeakDataDir = join(modelDir, 'espeak-ng-data');

  if (!existsSync(modelFile) || !existsSync(tokensFile)) {
    const removed = removeCorruptedModelDir(modelDir, 'Kitten TTS');
    throw new Error(
      removed
        ? 'Kitten TTS model files are incomplete and have been removed. Please retry to download a fresh copy.'
        : `Kitten TTS model files are incomplete but could not be cleaned up. Please manually delete "${modelDir}" and retry.`,
    );
  }

  state.phase = 'loading';
  logger.info('Loading TTS engine (Kitten)...');

  const sherpa = await loadSherpaOnnx();
  try {
    state.engine = new sherpa.OfflineTts({
      model: {
        kitten: {
          model: modelFile,
          voices: existsSync(voicesFile) ? voicesFile : undefined,
          tokens: tokensFile,
          dataDir: existsSync(espeakDataDir) ? espeakDataDir : undefined,
        },
      },
      maxNumSentences: 1,
      numThreads: TTS_NUM_THREADS,
      provider: 'cpu',
    });
  } catch (loadErr) {
    logger.warn(
      'Kitten TTS model load failed, removing corrupted files',
      loadErr,
    );
    const removed = removeCorruptedModelDir(modelDir, 'Kitten TTS');
    throw new Error(
      removed
        ? 'Kitten TTS model files are corrupted and have been removed. Please retry to download a fresh copy.'
        : `Kitten TTS model files are corrupted but could not be cleaned up. Please manually delete "${modelDir}" and retry.`,
    );
  }

  state.phase = null;
  logger.info(
    `Kitten TTS engine loaded (speakers: ${state.engine.numSpeakers}, sampleRate: ${state.engine.sampleRate})`,
  );
}

// Pocket-TTS is a pure voice-cloning model — reference audio is required for
// every synthesis call. These are the actual WAV files bundled in test_wavs/.
const POCKET_SID_TO_WAV: Record<number, string> = {
  0: 'bria.wav',
  1: 'loona.wav',
  2: 'sample_fr_hibiki_crepes.wav',
};

// ---------------------------------------------------------------------------
// Load dispatcher
// ---------------------------------------------------------------------------

const TTS_LOADERS: Record<TtsModelId, () => Promise<void>> = {
  kokoro: loadKokoroEngine,
  pocket: loadPocketTTSEngine,
  kitten: loadKittenTTSEngine,
};

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

/** Human-readable phase labels for the UI */
const PHASE_LABELS: Record<string, string> = {
  downloading: 'Downloading...',
  extracting: 'Extracting archive...',
  loading: 'Loading model...',
};

/**
 * Return the current status of the local STT model (SenseVoice).
 * Does not trigger a download.
 */
export function getSTTModelStatus(): LocalModelStatus {
  // Already loaded and ready
  if (sttRecognizer) {
    return { state: 'ready', model: STT_MODEL.name, size: STT_MODEL.size };
  }

  // Error from previous attempt
  if (sttError) {
    return {
      state: 'error',
      model: STT_MODEL.name,
      size: STT_MODEL.size,
      error: sttError,
    };
  }

  // Currently downloading with progress
  if (sttDownloadProgress) {
    return {
      state: 'downloading',
      model: STT_MODEL.name,
      size: STT_MODEL.size,
      downloadProgress: { ...sttDownloadProgress },
      phase: PHASE_LABELS[sttPhase ?? 'downloading'],
    };
  }

  // Active phase (extracting or loading)
  if (sttPhase) {
    return {
      state: sttPhase === 'loading' ? 'loading' : 'downloading',
      model: STT_MODEL.name,
      size: STT_MODEL.size,
      phase: PHASE_LABELS[sttPhase],
    };
  }

  // Loading promise active (catch-all for any in-progress state)
  if (sttLoading) {
    return {
      state: 'loading',
      model: STT_MODEL.name,
      size: STT_MODEL.size,
      phase: 'Loading model...',
    };
  }

  // Check if model files already exist on disk
  const cacheDir = getModelCacheDir();
  const modelDir = join(cacheDir, STT_MODEL.name);
  if (existsSync(modelDir)) {
    return { state: 'ready', model: STT_MODEL.name, size: STT_MODEL.size };
  }

  return {
    state: 'not_downloaded',
    model: STT_MODEL.name,
    size: STT_MODEL.size,
  };
}

/**
 * Return the current status of a local TTS model.
 * Defaults to 'kokoro' for backward compatibility.
 */
export function getTTSModelStatus(
  modelId: TtsModelId = 'kokoro',
): LocalModelStatus {
  const model = TTS_MODELS[modelId];
  const state = getTtsState(modelId);

  // Already loaded and ready
  if (state.engine) {
    return { state: 'ready', model: model.name, size: model.size };
  }

  // Error from previous attempt
  if (state.error) {
    return {
      state: 'error',
      model: model.name,
      size: model.size,
      error: state.error,
    };
  }

  // Currently downloading with progress
  if (state.downloadProgress) {
    return {
      state: 'downloading',
      model: model.name,
      size: model.size,
      downloadProgress: { ...state.downloadProgress },
      phase: PHASE_LABELS[state.phase ?? 'downloading'],
    };
  }

  // Active phase (extracting or loading)
  if (state.phase) {
    return {
      state: state.phase === 'loading' ? 'loading' : 'downloading',
      model: model.name,
      size: model.size,
      phase: PHASE_LABELS[state.phase],
    };
  }

  // Loading promise active
  if (state.loading) {
    return {
      state: 'loading',
      model: model.name,
      size: model.size,
      phase: 'Loading model...',
    };
  }

  // Check if model files already exist on disk
  const cacheDir = getModelCacheDir();
  const modelDir = join(cacheDir, model.name);
  if (existsSync(modelDir)) {
    return { state: 'ready', model: model.name, size: model.size };
  }

  return { state: 'not_downloaded', model: model.name, size: model.size };
}

/**
 * Return the status of all three TTS models at once.
 */
export function getAllTTSModelStatuses(): Record<TtsModelId, LocalModelStatus> {
  return {
    kokoro: getTTSModelStatus('kokoro'),
    pocket: getTTSModelStatus('pocket'),
    kitten: getTTSModelStatus('kitten'),
  };
}

/**
 * Return the native sample rate of the local TTS model output.
 * Adapters use this to write correct WAV headers without hardcoding the value.
 */
export function getTTSSampleRate(): number {
  return TTS_SAMPLE_RATE;
}

// ---------------------------------------------------------------------------
// Download entry points (fire-and-forget from API routes)
// ---------------------------------------------------------------------------

/**
 * Download and load the SenseVoice STT model files.
 * Safe to call multiple times — concurrent calls share the same promise.
 */
export async function downloadSTTModel(): Promise<void> {
  if (sttRecognizer) return;
  if (sttLoading) return sttLoading;

  sttError = null;
  sttLoading = (async () => {
    try {
      await loadSTTRecognizer();
    } catch (err) {
      sttRecognizer = null;
      sttPhase = null;
      sttDownloadProgress = null;
      sttError = err instanceof Error ? err.message : String(err);
      logger.error('STT model download/load failed:', err);
      throw err;
    } finally {
      sttLoading = null;
    }
  })();

  return sttLoading;
}

/**
 * Download and load a TTS model.
 * Defaults to 'kokoro' for backward compatibility.
 * Safe to call multiple times — concurrent calls share the same promise.
 */
export async function downloadTTSModel(
  modelId: TtsModelId = 'kokoro',
): Promise<void> {
  const state = getTtsState(modelId);
  if (state.engine) return;
  if (state.loading) return state.loading;

  state.error = null;
  state.loading = (async () => {
    try {
      await TTS_LOADERS[modelId]();
    } catch (err) {
      state.engine = null;
      state.phase = null;
      state.downloadProgress = null;
      state.error = err instanceof Error ? err.message : String(err);
      logger.error(`TTS model (${modelId}) download/load failed:`, err);
      throw err;
    } finally {
      state.loading = null;
    }
  })();

  return state.loading;
}

// ---------------------------------------------------------------------------
// Inference — STT
// ---------------------------------------------------------------------------

/**
 * Transcribe audio using the local SenseVoice STT model.
 *
 * Returns the transcribed text along with optional emotion and audio event
 * annotations provided by SenseVoice.
 *
 * @param audioData   Normalised float PCM samples as a Float32Array.
 *                    The caller is responsible for converting from the wire
 *                    format (e.g. 16-bit PCM) before calling this function.
 * @param sampleRate  Sample rate of the audio in Hz (e.g. 16000).
 * @param language    Optional BCP-47 language hint (e.g. 'en', 'zh').
 */
export async function transcribeLocal(
  audioData: Float32Array,
  sampleRate: number,
  language?: string,
): Promise<{
  text: string;
  emotion?: string;
  audioEvents?: string[];
  language?: string;
}> {
  void language; // SenseVoice auto-detects; hint unused for now

  // Lazy-load STT recognizer if not yet loaded
  if (!sttRecognizer) {
    await downloadSTTModel();
  }

  const recognizer = sttRecognizer!;
  const stream = recognizer.createStream();
  stream.acceptWaveform({ samples: audioData, sampleRate });
  recognizer.decode(stream);
  const result = recognizer.getResult(stream);

  // SenseVoice returns: { text, lang, emotion, event, tokens, ... }
  const audioEvents: string[] = [];
  if (result.event && result.event.trim()) {
    audioEvents.push(
      ...result.event
        .split(/[,;]/)
        .map((s: string) => s.trim())
        .filter(Boolean),
    );
  }

  return {
    text: result.text ?? '',
    emotion: result.emotion || undefined,
    audioEvents: audioEvents.length > 0 ? audioEvents : undefined,
    language: result.lang || undefined,
  };
}

// ---------------------------------------------------------------------------
// Inference — TTS
// ---------------------------------------------------------------------------

/**
 * Synthesize speech from text using a local TTS model.
 *
 * Returns raw normalised float PCM samples as a Float32Array.
 * Use `getTTSSampleRate()` to obtain the sample rate for encoding.
 *
 * @param text             Text to synthesize.
 * @param speakerId        Speaker index (default 0).
 * @param speed            Playback speed multiplier, e.g. 1.0 = normal (default 1.0).
 * @param modelId          TTS model to use (default 'kokoro').
 * @param generationConfig Optional generation config for voice cloning (Pocket-TTS).
 */
export async function synthesizeLocal(
  text: string,
  speakerId?: number,
  speed?: number,
  modelId: TtsModelId = 'kokoro',
  generationConfig?: {
    referenceAudio?: Float32Array;
    referenceSampleRate?: number;
    numSteps?: number;
  },
): Promise<Float32Array> {
  const state = getTtsState(modelId);

  // Lazy-load TTS engine if not yet loaded
  if (!state.engine) {
    await downloadTTSModel(modelId);
  }

  const engine = state.engine!;

  // Build the TTS request
  const request: {
    text: string;
    sid: number;
    speed: number;
    generationConfig?: {
      speed?: number;
      referenceAudio?: Float32Array;
      referenceSampleRate?: number;
      numSteps?: number;
    };
  } = {
    text,
    sid: speakerId ?? 0,
    speed: speed ?? 1.0,
  };

  // Pocket-TTS is a pure voice-cloning model — the C++ Generate() is not
  // implemented; only GenerateWithConfig() works. Always build a generationConfig.
  if (modelId === 'pocket') {
    if (
      generationConfig?.referenceAudio &&
      generationConfig.referenceSampleRate
    ) {
      // Caller-supplied reference audio (voice clone or predefined voice from adapter)
      request.generationConfig = {
        speed: speed ?? 1.0,
        referenceAudio: generationConfig.referenceAudio,
        referenceSampleRate: generationConfig.referenceSampleRate,
        numSteps: generationConfig.numSteps,
      };
    } else {
      // No reference audio supplied — load the bundled test WAV for this speaker
      const wavFileName = POCKET_SID_TO_WAV[speakerId ?? 0];
      if (!wavFileName) {
        throw new Error(
          `Unknown Pocket-TTS speaker ID: ${speakerId}. Valid IDs: ${Object.keys(POCKET_SID_TO_WAV).join(', ')}.`,
        );
      }
      const modelDir = join(getModelCacheDir(), TTS_MODELS.pocket.name);
      const wavPath = join(modelDir, 'test_wavs', wavFileName);
      if (!existsSync(wavPath)) {
        throw new Error(`Pocket-TTS reference WAV not found: ${wavPath}`);
      }
      const sherpa = await loadSherpaOnnx();
      const waveform = sherpa.readWave(wavPath);
      logger.debug(
        `Loaded reference WAV for Pocket sid=${speakerId ?? 0}: ${wavPath}`,
      );
      request.generationConfig = {
        speed: speed ?? 1.0,
        referenceAudio: waveform.samples,
        referenceSampleRate: waveform.sampleRate,
      };
    }
  }

  if (request.generationConfig) {
    const audio = await engine.generateAsync(request);
    return audio.samples;
  }

  const audio = engine.generate(request);
  return audio.samples;
}

// ---------------------------------------------------------------------------
// Cloned voice storage
// ---------------------------------------------------------------------------

interface ClonedVoiceMeta {
  name: string;
  createdAt: string;
  sampleRate: number;
  sampleCount: number;
}

/**
 * Save a cloned voice's reference audio for later use with Pocket-TTS.
 */
export function saveClonedVoice(
  name: string,
  audioSamples: Float32Array,
  sampleRate: number,
): string {
  const dir = getClonedVoicesDir();
  const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
  const voiceId = `pocket_clone_${safeName}`;

  // Save raw audio data as binary
  const binPath = join(dir, `${safeName}.bin`);
  const buffer = Buffer.from(
    audioSamples.buffer,
    audioSamples.byteOffset,
    audioSamples.byteLength,
  );
  writeFileSync(binPath, buffer);

  // Save metadata as JSON
  const metaPath = join(dir, `${safeName}.json`);
  const meta: ClonedVoiceMeta = {
    name,
    createdAt: new Date().toISOString(),
    sampleRate,
    sampleCount: audioSamples.length,
  };
  writeFileSync(metaPath, JSON.stringify(meta, null, 2));

  logger.info(
    `Saved cloned voice "${name}" → ${voiceId} (${audioSamples.length} samples @ ${sampleRate}Hz)`,
  );
  return voiceId;
}

/**
 * Load a cloned voice's reference audio from disk.
 */
export function loadClonedVoice(
  name: string,
): { samples: Float32Array; sampleRate: number } | null {
  const dir = getClonedVoicesDir();
  const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();

  const binPath = join(dir, `${safeName}.bin`);
  const metaPath = join(dir, `${safeName}.json`);

  if (!existsSync(binPath) || !existsSync(metaPath)) {
    return null;
  }

  const rawBuffer = readFileSync(binPath);
  const meta: ClonedVoiceMeta = JSON.parse(readFileSync(metaPath, 'utf-8'));

  // Reconstruct Float32Array from the binary file
  const samples = new Float32Array(
    rawBuffer.buffer,
    rawBuffer.byteOffset,
    rawBuffer.byteLength / Float32Array.BYTES_PER_ELEMENT,
  );

  return { samples, sampleRate: meta.sampleRate };
}

/**
 * List all saved cloned voices.
 */
export function listClonedVoices(): Array<{
  voiceId: string;
  name: string;
  createdAt: string;
}> {
  const dir = getClonedVoicesDir();
  const voices: Array<{ voiceId: string; name: string; createdAt: string }> =
    [];

  try {
    const files = readdirSync(dir);
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const safeName = file.replace('.json', '');
      const metaPath = join(dir, file);
      try {
        const meta: ClonedVoiceMeta = JSON.parse(
          readFileSync(metaPath, 'utf-8'),
        );
        voices.push({
          voiceId: `pocket_clone_${safeName}`,
          name: meta.name,
          createdAt: meta.createdAt,
        });
      } catch {
        // Skip malformed metadata files
      }
    }
  } catch {
    // Directory may not exist yet
  }

  return voices;
}

/**
 * Delete a cloned voice by its safe name.
 */
export function deleteClonedVoice(name: string): boolean {
  const dir = getClonedVoicesDir();
  const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();

  const binPath = join(dir, `${safeName}.bin`);
  const metaPath = join(dir, `${safeName}.json`);

  let deleted = false;
  try {
    if (existsSync(binPath)) {
      unlinkSync(binPath);
      deleted = true;
    }
    if (existsSync(metaPath)) {
      unlinkSync(metaPath);
      deleted = true;
    }
  } catch (err) {
    logger.error(`Failed to delete cloned voice "${name}":`, err);
  }

  if (deleted) {
    logger.info(`Deleted cloned voice "${name}"`);
  }
  return deleted;
}
