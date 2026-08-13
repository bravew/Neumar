/**
 * Embedding Service
 *
 * Generates vector embeddings for memory content.
 * Default: local ONNX model (gte-multilingual-base, 768-dim) via onnxruntime-node.
 * Supports ~75 languages with 8192 token context.
 * Optional: OpenAI or Gemini cloud embeddings.
 *
 * Uses direct ONNX Runtime inference instead of @huggingface/transformers pipeline
 * because gte-multilingual-base uses a custom "NewModel" architecture class that
 * transformers.js v3 doesn't recognize. We use AutoTokenizer (which works
 * independently of model class validation) + onnxruntime-node for inference.
 */

import { createHash } from 'node:crypto';
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  unlinkSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

import { APP_DATA_DIR } from '@/config/branding';

import { logUsage } from '@/shared/services/usage-logger';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('Embedder');

const LOCAL_MODEL = 'onnx-community/gte-multilingual-base';
const LOCAL_DIM = 768;
const MAX_SEQ_LENGTH = 8192;

/** Tokenizer call signature — matches @huggingface/transformers AutoTokenizer output. */
interface TokenizerOutput {
  input_ids: { data: BigInt64Array };
  attention_mask: { data: BigInt64Array };
}
type TokenizerFn = (
  text: string,
  options: { padding: boolean; truncation: boolean; max_length: number },
) => TokenizerOutput;

type OrtModule = typeof import('onnxruntime-node');
let cachedOrt: OrtModule | null = null;

/**
 * Resolve the path to the bundled onnxruntime-node in Tauri Resources.
 * Returns null if not in a Tauri production build or the bundle doesn't exist.
 */
function resolveBundledOrtPath(): string | null {
  const resourcesDir = process.env.RESOURCES_DIR;
  if (!resourcesDir) {
    logger.debug('RESOURCES_DIR not set, skipping bundled onnxruntime lookup');
    return null;
  }

  const bundledDir = join(
    resourcesDir,
    '_up_',
    'src-api',
    'dist',
    'onnxruntime',
    'node_modules',
    'onnxruntime-node',
  );

  if (existsSync(bundledDir)) {
    return bundledDir;
  }

  logger.warn(
    `Bundled onnxruntime-node not found at: ${bundledDir} (RESOURCES_DIR=${resourcesDir})`,
  );
  return null;
}

/**
 * Load onnxruntime-node with environment-aware strategy:
 *
 * - Production (Tauri/pkg binary): Load from bundled native files in Resources.
 *   The build copies onnxruntime-node + onnxruntime-common to a self-contained
 *   node_modules tree in dist/onnxruntime/. We require() from that absolute path
 *   so the native .node + .dylib files are found on the real filesystem.
 *
 * - Development (tsx/ESM): Dynamic import() resolves via pnpm symlinks.
 */
async function loadOnnxRuntime(): Promise<OrtModule> {
  if (cachedOrt) return cachedOrt;

  // Production: load from bundled native files in Tauri Resources
  const bundledPath = resolveBundledOrtPath();
  if (bundledPath) {
    logger.info(`Loading onnxruntime from bundled path: ${bundledPath}`);
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      cachedOrt = require(bundledPath) as OrtModule;
      return cachedOrt;
    } catch (err) {
      logger.error(
        `Failed to load bundled onnxruntime from ${bundledPath}:`,
        err,
      );
      throw err;
    }
  }

  // Inside a pkg binary, bare require('onnxruntime-node') resolves from the VFS
  // snapshot where native .node addons don't exist. Fail early with a clear message.
  // @ts-expect-error - pkg specific property
  if (process.pkg) {
    throw new Error(
      `onnxruntime-node native addon not found in Tauri Resources. ` +
        `RESOURCES_DIR=${process.env.RESOURCES_DIR ?? '(not set)'}. ` +
        `Ensure the build step copied native files to dist/onnxruntime/.`,
    );
  }

  // Development: dynamic import works via pnpm symlinks
  try {
    const mod = await import('onnxruntime-node');
    cachedOrt = (mod.default ?? mod) as OrtModule;
  } catch {
    // Final fallback for standard CJS environments
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cachedOrt = require('onnxruntime-node') as OrtModule;
  }

  return cachedOrt;
}

// Singleton state for local model
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let localSession: any | null = null;
let localTokenizer: TokenizerFn | null = null;
let localModelLoading: Promise<void> | null = null;

const IMAGE_MODEL = 'Xenova/siglip-base-patch16-224';
const IMAGE_DIM = 768;
const IMAGE_IDLE_EVICT_MS = 5 * 60 * 1_000;

type SiglipTokenizerFn = (
  text: string | string[],
  options: { padding: boolean | 'max_length'; truncation: boolean },
) => Record<string, unknown>;
type SiglipProcessorFn = (image: unknown) => Promise<Record<string, unknown>>;
type SiglipModelFn = (
  inputs: Record<string, unknown>,
) => Promise<Record<string, unknown>>;
interface RawImageCtor {
  new (
    data: Uint8ClampedArray | Uint8Array,
    width: number,
    height: number,
    channels: 1 | 2 | 3 | 4,
  ): unknown;
  read(input: unknown): Promise<unknown>;
}
interface SiglipBundle {
  tokenizer: SiglipTokenizerFn;
  processor: SiglipProcessorFn;
  model: SiglipModelFn;
  RawImage: RawImageCtor;
  modelName: string;
}

let imageBundle: SiglipBundle | null = null;
let imageBundleLoading: Promise<SiglipBundle> | null = null;
let imageIdleTimer: NodeJS.Timeout | undefined;

// Download progress tracking
let downloadProgress: { downloadedBytes: number; totalBytes: number } | null =
  null;
let downloadError: string | null = null;

// Granular loading phase tracking
let loadingPhase:
  | 'downloading_tokenizer'
  | 'downloading_model'
  | 'verifying'
  | 'creating_session'
  | null = null;

/**
 * Resolve the model cache directory.
 * The ONNX embedding model is NOT bundled with the app — it downloads
 * automatically on first use to ~/.<slug>/cache/embeddings/.
 */
function getModelCacheDir(): string {
  const homeDir = process.env.HOME || process.env.USERPROFILE || '';
  const cacheDir = join(homeDir, APP_DATA_DIR, 'cache', 'embeddings');
  mkdirSync(cacheDir, { recursive: true });
  return cacheDir;
}

const ONNX_FILE = 'onnx/model_quantized.onnx';
const HF_DOWNLOAD_URL = `https://huggingface.co/${LOCAL_MODEL}/resolve/main/${ONNX_FILE}`;
// SHA-256 of onnx-community/gte-multilingual-base/onnx/model_quantized.onnx (verified 2026-02)
const ONNX_SHA256 =
  'ab2bd164ebd8ca9003dc49a981b611e849b5d326f504c8873ba76e07fa6c0082';

/**
 * Resolve the path to the ONNX model file.
 * Cache structure: <cache_dir>/onnx-community/gte-multilingual-base/onnx/model_quantized.onnx
 */
function resolveOnnxModelPath(cacheDir: string): string {
  return join(cacheDir, LOCAL_MODEL, ONNX_FILE);
}

/**
 * Download the ONNX model file from HuggingFace if not already cached.
 */
async function downloadOnnxModel(destPath: string): Promise<void> {
  mkdirSync(dirname(destPath), { recursive: true });
  logger.info(`⬇️ Downloading ONNX model (~340 MB) from HuggingFace...`);

  const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1_000; // 10 minutes for ~340 MB
  const response = await fetch(HF_DOWNLOAD_URL, {
    redirect: 'follow',
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(
      `Failed to download ONNX model: ${response.status} ${response.statusText}`,
    );
  }

  // Initialize progress tracking from Content-Length header
  const contentLength = parseInt(
    response.headers.get('content-length') ?? '0',
    10,
  );
  downloadProgress = { downloadedBytes: 0, totalBytes: contentLength || 0 };

  // Stream to disk
  if (!response.body) {
    throw new Error('ONNX model download returned empty response body');
  }
  const dest = createWriteStream(destPath);
  const reader = response.body.getReader();

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    dest.write(value);
    if (downloadProgress) {
      downloadProgress.downloadedBytes += value.byteLength;
    }
  }
  dest.end();

  // Wait for file to be fully written
  await new Promise<void>((resolve, reject) => {
    dest.on('finish', resolve);
    dest.on('error', reject);
  });

  downloadProgress = null;

  // Verify SHA-256 integrity
  await verifyFileChecksum(destPath, ONNX_SHA256);
  logger.info(`✅ ONNX model downloaded and verified: ${destPath}`);
}

/**
 * Verify SHA-256 checksum of a downloaded file.
 * Deletes the file and throws if the hash doesn't match.
 */
async function verifyFileChecksum(
  filePath: string,
  expectedHash: string,
): Promise<void> {
  const hash = createHash('sha256');
  const stream = createReadStream(filePath);

  await new Promise<void>((resolve, reject) => {
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', resolve);
    stream.on('error', reject);
  });

  const actual = hash.digest('hex');
  if (actual !== expectedHash) {
    // Remove the corrupted/tampered file
    try {
      unlinkSync(filePath);
    } catch {
      /* best-effort cleanup */
    }
    throw new Error(
      `ONNX model checksum mismatch (expected ${expectedHash.slice(0, 12)}…, got ${actual.slice(0, 12)}…). ` +
        `Corrupted file removed — please retry to download a fresh copy.`,
    );
  }
}

// ── Local embedding (onnxruntime-node + AutoTokenizer) ──

async function loadLocalModel(): Promise<void> {
  if (localSession && localTokenizer) return;
  if (localModelLoading) return localModelLoading;

  localModelLoading = (async () => {
    try {
      const cacheDir = getModelCacheDir();

      // Load tokenizer via @huggingface/transformers AutoTokenizer
      // This works independently of model class validation
      loadingPhase = 'downloading_tokenizer';
      const { AutoTokenizer } = await import('@huggingface/transformers');
      localTokenizer = (await AutoTokenizer.from_pretrained(LOCAL_MODEL, {
        cache_dir: cacheDir,
      })) as unknown as TokenizerFn;
      logger.info(`🔤 Tokenizer loaded: ${LOCAL_MODEL}`);

      // Load ONNX model via onnxruntime-node
      const ort = await loadOnnxRuntime();
      const modelPath = resolveOnnxModelPath(cacheDir);

      // Auto-download on first use if not cached
      if (existsSync(modelPath)) {
        loadingPhase = 'verifying';
        try {
          await verifyFileChecksum(modelPath, ONNX_SHA256);
        } catch (verifyErr) {
          // verifyFileChecksum already deleted the file; log and fall through to re-download
          logger.warn(
            'Checksum verification failed, will re-download',
            verifyErr,
          );
        }
      }
      if (!existsSync(modelPath)) {
        loadingPhase = 'downloading_model';
        await downloadOnnxModel(modelPath);
      }

      loadingPhase = 'verifying';
      // Brief pause to allow status polling to see this phase
      loadingPhase = 'creating_session';
      try {
        localSession = await ort.InferenceSession.create(modelPath, {
          executionProviders: ['cpu'],
        });
      } catch (sessionErr) {
        logger.warn(
          'ONNX session creation failed, removing corrupted file',
          sessionErr,
        );
        // Model file is likely corrupted — remove it so Retry triggers a fresh download
        let removed = true;
        try {
          unlinkSync(modelPath);
        } catch (unlinkErr) {
          logger.warn(
            `Failed to remove corrupted ONNX model file: ${modelPath}`,
            unlinkErr,
          );
          removed = false;
        }
        throw new Error(
          removed
            ? 'Model file is corrupted and has been removed. Please retry to download a fresh copy.'
            : `Model file is corrupted but could not be removed. Please manually delete "${modelPath}" and retry.`,
        );
      }
      logger.info(`🧠 ONNX session loaded: ${modelPath}`);
      loadingPhase = null;
    } catch (err) {
      localModelLoading = null;
      localSession = null;
      localTokenizer = null;
      downloadProgress = null;
      loadingPhase = null;
      downloadError = err instanceof Error ? err.message : String(err);
      throw err;
    }
  })();

  return localModelLoading;
}

/**
 * Embed text locally using gte-multilingual-base via direct ONNX Runtime inference.
 * The ONNX model outputs a pre-computed `sentence_embedding` (768-dim, L2-normalized).
 */
async function embedLocal(text: string): Promise<Float32Array> {
  await loadLocalModel();

  const ort = await loadOnnxRuntime();

  // Tokenize (loadLocalModel guarantees non-null after await)
  const encoded = localTokenizer!(text, {
    padding: false,
    truncation: true,
    max_length: MAX_SEQ_LENGTH,
  });

  const inputIds = encoded.input_ids.data as BigInt64Array;
  const attentionMask = encoded.attention_mask.data as BigInt64Array;
  const seqLen = inputIds.length;

  // Create ONNX Runtime tensors
  const feeds: Record<string, import('onnxruntime-node').Tensor> = {
    input_ids: new ort.Tensor('int64', inputIds, [1, seqLen]),
    attention_mask: new ort.Tensor('int64', attentionMask, [1, seqLen]),
  };

  // Run inference — model outputs: { sentence_embedding: [1, 768], token_embeddings: [1, seq, 768] }
  const output = await localSession!.run(feeds);

  // Use the pre-computed sentence embedding (already L2-normalized by the model)
  const sentenceEmbedding = output.sentence_embedding;
  if (!sentenceEmbedding) {
    const outputKeys = Object.keys(output);
    throw new Error(
      `Expected "sentence_embedding" in model output, got: [${outputKeys.join(', ')}]`,
    );
  }

  logUsage({
    callType: 'embedding',
    provider: 'local',
    model: 'gte-multilingual-base',
    billingType: 'free',
    inputTokens: seqLen,
  });

  return new Float32Array(sentenceEmbedding.data as Float32Array);
}

async function loadSiglipBundle(
  modelName = IMAGE_MODEL,
): Promise<SiglipBundle> {
  if (imageBundle?.modelName === modelName) {
    touchImageBundle();
    return imageBundle;
  }
  if (imageBundleLoading) return imageBundleLoading;

  imageBundleLoading = (async () => {
    const cacheDir = getModelCacheDir();
    const { AutoProcessor, AutoTokenizer, RawImage, SiglipModel } =
      await import('@huggingface/transformers');
    const [tokenizer, processor, model] = await Promise.all([
      AutoTokenizer.from_pretrained(modelName, { cache_dir: cacheDir }),
      AutoProcessor.from_pretrained(modelName, { cache_dir: cacheDir }),
      SiglipModel.from_pretrained(modelName, { cache_dir: cacheDir }),
    ]);
    imageBundle = {
      tokenizer: tokenizer as unknown as SiglipTokenizerFn,
      processor: processor as unknown as SiglipProcessorFn,
      model: model as unknown as SiglipModelFn,
      RawImage: RawImage as unknown as RawImageCtor,
      modelName,
    };
    imageBundleLoading = null;
    touchImageBundle();
    logger.info(`SigLIP image embedding model loaded: ${modelName}`);
    return imageBundle;
  })().catch((error) => {
    imageBundleLoading = null;
    throw error;
  });

  return imageBundleLoading;
}

function touchImageBundle(): void {
  if (imageIdleTimer) clearTimeout(imageIdleTimer);
  imageIdleTimer = setTimeout(() => {
    void disposeImageBundle();
  }, IMAGE_IDLE_EVICT_MS);
  imageIdleTimer.unref?.();
}

async function disposeImageBundle(): Promise<void> {
  const current = imageBundle;
  imageBundle = null;
  imageBundleLoading = null;
  imageIdleTimer = undefined;
  const disposable = current?.model as unknown as
    | { dispose?: () => unknown }
    | undefined;
  if (disposable?.dispose) {
    await Promise.resolve(disposable.dispose()).catch((error) => {
      logger.warn(`SigLIP model dispose failed: ${error}`);
    });
  }
}

async function readSiglipImage(
  input: string | Uint8Array | ArrayBuffer,
  RawImage: RawImageCtor,
): Promise<unknown> {
  if (typeof input === 'string') return RawImage.read(input);
  const bytes = input instanceof ArrayBuffer ? new Uint8Array(input) : input;
  const arrayBuffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(arrayBuffer).set(bytes);
  return RawImage.read(
    new Blob([arrayBuffer], { type: 'application/octet-stream' }),
  );
}

function readTensorData(
  output: Record<string, unknown>,
  key: string,
): Float32Array {
  const tensor = output[key];
  if (!tensor || typeof tensor !== 'object') {
    throw new Error(`Expected "${key}" in model output`);
  }
  const data = (tensor as { data?: unknown }).data;
  if (data instanceof Float32Array) return new Float32Array(data);
  if (Array.isArray(data)) return new Float32Array(data.map(Number));
  if (ArrayBuffer.isView(data) && !(data instanceof DataView)) {
    const view = data as unknown as ArrayLike<number>;
    const result = new Float32Array(view.length);
    for (let index = 0; index < view.length; index += 1) {
      result[index] = Number(view[index]);
    }
    return result;
  }
  throw new Error(`Unexpected "${key}" tensor data`);
}

/**
 * Embed an image with the configured local SigLIP model.
 * The model is loaded lazily and evicted after five minutes of inactivity.
 */
export async function embedImage(
  input: string | Uint8Array | ArrayBuffer,
  modelName = IMAGE_MODEL,
): Promise<Float32Array> {
  const bundle = await loadSiglipBundle(modelName);
  const image = await readSiglipImage(input, bundle.RawImage);
  const imageInputs = await bundle.processor(image);
  const textInputs = bundle.tokenizer(['an image'], {
    padding: 'max_length',
    truncation: true,
  });
  const output = await bundle.model({ ...textInputs, ...imageInputs });
  touchImageBundle();
  return readTensorData(output, 'image_embeds');
}

/**
 * Embed a text query into the same SigLIP space as image embeddings.
 */
export async function embedImageText(
  text: string,
  modelName = IMAGE_MODEL,
): Promise<Float32Array> {
  const bundle = await loadSiglipBundle(modelName);
  const textInputs = bundle.tokenizer([text], {
    padding: 'max_length',
    truncation: true,
  });
  const output = await bundle.model(textInputs);
  touchImageBundle();
  if ('text_embeds' in output) return readTensorData(output, 'text_embeds');

  const blank = new bundle.RawImage(
    new Uint8ClampedArray([0, 0, 0, 255]),
    1,
    1,
    4,
  );
  const imageInputs = await bundle.processor(blank);
  return readTensorData(
    await bundle.model({ ...textInputs, ...imageInputs }),
    'text_embeds',
  );
}

export function getImageEmbeddingModelName(model?: string): string {
  return model ?? IMAGE_MODEL;
}

export function getImageEmbeddingDim(): number {
  return IMAGE_DIM;
}

// ── Cloud embedding (OpenAI) ──

async function embedOpenAI(
  text: string,
  apiKey: string,
  model = 'text-embedding-3-small',
): Promise<Float32Array> {
  const embedStart = Date.now();
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ input: text, model }),
  });

  if (!response.ok) {
    throw new Error(
      `OpenAI embeddings API error: ${response.status} ${response.statusText}`,
    );
  }

  const data = await response.json();
  const embedding = data?.data?.[0]?.embedding;
  if (!Array.isArray(embedding)) {
    throw new Error('Unexpected OpenAI embeddings response structure');
  }

  logUsage({
    callType: 'embedding',
    provider: 'openai',
    model,
    inputTokens: data?.usage?.prompt_tokens,
    latencyMs: Date.now() - embedStart,
  });

  return new Float32Array(embedding);
}

// ── Cloud embedding (Gemini) ──

async function embedGemini(
  text: string,
  apiKey: string,
  model = 'text-embedding-004',
): Promise<Float32Array> {
  const embedStart = Date.now();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      model: `models/${model}`,
      content: { parts: [{ text }] },
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Gemini embeddings API error: ${response.status} ${response.statusText}`,
    );
  }

  const data = await response.json();
  const values = data?.embedding?.values;
  if (!Array.isArray(values)) {
    throw new Error('Unexpected Gemini embeddings response structure');
  }

  logUsage({
    callType: 'embedding',
    provider: 'google',
    model,
    billingType: 'free', // Gemini embeddings free under limit
    latencyMs: Date.now() - embedStart,
  });

  return new Float32Array(values);
}

// ── Public API ──

export type EmbeddingProvider = 'local' | 'openai' | 'gemini';

export interface EmbedOptions {
  provider: EmbeddingProvider;
  apiKey?: string;
  model?: string;
}

/**
 * Generate an embedding vector for the given text.
 * Returns Float32Array (required by sqlite-vec).
 */
export async function embed(
  text: string,
  options: EmbedOptions,
): Promise<Float32Array> {
  switch (options.provider) {
    case 'local':
      return embedLocal(text);
    case 'openai':
      if (!options.apiKey) throw new Error('OpenAI API key required');
      return embedOpenAI(text, options.apiKey, options.model);
    case 'gemini':
      if (!options.apiKey) throw new Error('Gemini API key required');
      return embedGemini(text, options.apiKey, options.model);
    default:
      throw new Error(`Unknown embedding provider: ${options.provider}`);
  }
}

/**
 * Resolve the canonical model name from embed options.
 * Used as cache key and for logging.
 */
export function getModelName(options: EmbedOptions): string {
  if (options.model) return options.model;
  switch (options.provider) {
    case 'local':
      return 'gte-multilingual-base';
    case 'openai':
      return 'text-embedding-3-small';
    case 'gemini':
      return 'text-embedding-004';
    default:
      return 'unknown';
  }
}

// ── Local model status ──

export type LocalModelState =
  | 'not_downloaded'
  | 'downloading'
  | 'loading'
  | 'ready'
  | 'error';

export interface LocalModelStatus {
  state: LocalModelState;
  progress?: { downloadedBytes: number; totalBytes: number };
  message?: string;
}

/**
 * Query the current status of the local ONNX embedding model
 * without triggering a download.
 */
export function getLocalModelStatus(): LocalModelStatus {
  // Already loaded and ready
  if (localSession && localTokenizer) {
    return { state: 'ready' };
  }

  // Error from previous attempt
  if (downloadError) {
    return { state: 'error', message: downloadError };
  }

  // Currently downloading
  if (downloadProgress) {
    return { state: 'downloading', progress: { ...downloadProgress } };
  }

  // Loading (tokenizer or ONNX session being initialized)
  if (localModelLoading) {
    const phaseMessages: Record<string, string> = {
      downloading_tokenizer: 'Downloading tokenizer...',
      downloading_model: 'Downloading model...',
      verifying: 'Verifying integrity...',
      creating_session: 'Creating inference session...',
    };
    const message = loadingPhase
      ? phaseMessages[loadingPhase]
      : 'Loading model...';
    return { state: 'loading', message };
  }

  // Check if the model file exists on disk — auto-trigger loading
  const cacheDir = getModelCacheDir();
  const modelPath = resolveOnnxModelPath(cacheDir);
  if (existsSync(modelPath)) {
    // Kick off loading so the model doesn't sit idle on disk
    triggerLocalModelDownload();
    return { state: 'loading', message: 'Loading model...' };
  }

  return { state: 'not_downloaded' };
}

/**
 * Trigger the local model download + load in fire-and-forget mode.
 * No-op if already loading or loaded.
 */
export function triggerLocalModelDownload(): void {
  if (localSession && localTokenizer) return;
  if (localModelLoading) return;

  downloadError = null;
  loadLocalModel().catch((err) => {
    logger.warn(`❌ triggerLocalModelDownload failed: ${err}`);
  });
}

/**
 * Get the embedding dimension for a given provider/model.
 */
export function getEmbeddingDim(
  provider: EmbeddingProvider,
  model?: string,
): number {
  if (provider === 'local') return LOCAL_DIM; // 768

  // OpenAI models
  if (provider === 'openai') {
    const dims: Record<string, number> = {
      'text-embedding-3-small': 1536,
      'text-embedding-3-large': 3072,
      'text-embedding-ada-002': 1536,
    };
    return dims[model ?? 'text-embedding-3-small'] ?? 1536;
  }

  // Gemini models
  if (provider === 'gemini') {
    return 768; // text-embedding-004
  }

  return LOCAL_DIM;
}
