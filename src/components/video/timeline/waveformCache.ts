import {
  type WaveformSourceRange,
  waveformPeaksFromAudioBuffer,
} from './waveformPeaks';

const DEFAULT_WAVEFORM_BUCKETS = 160;
const MAX_WAVEFORM_CACHE_ENTRIES = 40;
const WAVEFORM_DB_NAME = 'video-wave-peaks';
const WAVEFORM_DB_STORE = 'peaks';
const WAVEFORM_DB_VERSION = 1;

const waveformPeakCache = new Map<string, Promise<number[]>>();
let waveformDbPromise: Promise<IDBDatabase | null> | null = null;
let workerRequestCounter = 0;

export function getCachedWaveformPeaks(
  src: string,
  bucketCount = DEFAULT_WAVEFORM_BUCKETS,
  options: { signal?: AbortSignal; sourceRange?: WaveformSourceRange } = {},
): Promise<number[]> {
  const cacheKey = waveformCacheKey(src, bucketCount, options.sourceRange);
  const cached = waveformPeakCache.get(cacheKey);
  if (cached) return cached;

  const decoded = getPersistedWaveformPeaks(cacheKey)
    .then((persisted) => {
      if (persisted) return persisted;
      return decodeWaveformPeaks(
        src,
        bucketCount,
        options.signal,
        options.sourceRange,
      ).then(async (peaks) => {
        if (peaks.length > 0) {
          await setPersistedWaveformPeaks(cacheKey, peaks);
        }
        return peaks;
      });
    })
    .catch((error) => {
      waveformPeakCache.delete(cacheKey);
      throw error;
    });
  waveformPeakCache.set(cacheKey, decoded);
  trimWaveformPeakCache();
  return decoded;
}

export function clearWaveformPeakCache() {
  waveformPeakCache.clear();
}

export function fallbackWaveformPeaks(seed: string, bucketCount: number) {
  return Array.from({ length: bucketCount }, (_, index) =>
    pseudoAmplitude(seed, index),
  );
}

async function decodeWaveformPeaks(
  src: string,
  bucketCount: number,
  signal?: AbortSignal,
  sourceRange?: WaveformSourceRange,
) {
  throwIfAborted(signal);
  const workerPeaks = await decodeWaveformPeaksInWorker(
    src,
    bucketCount,
    signal,
    sourceRange,
  ).catch((error) => {
    if (isAbortError(error)) throw error;
    return null;
  });
  if (workerPeaks) return workerPeaks;
  return decodeWaveformPeaksOnMainThread(src, bucketCount, signal, sourceRange);
}

async function decodeWaveformPeaksOnMainThread(
  src: string,
  bucketCount: number,
  signal?: AbortSignal,
  sourceRange?: WaveformSourceRange,
) {
  const AudioContextCtor = getAudioContextConstructor();
  if (!AudioContextCtor) return [];
  const response = await fetch(src, { signal });
  if (!response.ok) return [];
  const audioContext = new AudioContextCtor();
  try {
    const arrayBuffer = await response.arrayBuffer();
    throwIfAborted(signal);
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    return waveformPeaksFromAudioBuffer(audioBuffer, bucketCount, sourceRange);
  } finally {
    await audioContext.close().catch(() => {});
  }
}

function decodeWaveformPeaksInWorker(
  src: string,
  bucketCount: number,
  signal?: AbortSignal,
  sourceRange?: WaveformSourceRange,
): Promise<number[] | null> {
  if (typeof Worker === 'undefined') return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const id = `waveform-${(workerRequestCounter += 1)}`;
    const worker = new Worker(
      new URL('./wave-peaks-worker.ts', import.meta.url),
      {
        type: 'module',
      },
    );
    const cleanup = () => {
      signal?.removeEventListener('abort', onAbort);
      worker.terminate();
    };
    const onAbort = () => {
      cleanup();
      reject(abortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    worker.onmessage = (event: MessageEvent<WaveformWorkerResponse>) => {
      if (event.data.id !== id) return;
      cleanup();
      if (event.data.error) {
        reject(new Error(event.data.error));
        return;
      }
      resolve(event.data.peaks ?? []);
    };
    worker.onerror = (event) => {
      cleanup();
      reject(new Error(event.message || 'Waveform worker failed'));
    };
    worker.postMessage({
      id,
      src,
      bucketCount,
      sourceRange,
    } satisfies WaveformWorkerRequest);
  });
}

function waveformCacheKey(
  src: string,
  bucketCount: number,
  sourceRange: WaveformSourceRange | undefined,
): string {
  if (!sourceRange) return `${src}::${bucketCount}`;
  return [
    src,
    bucketCount,
    Math.max(0, Math.round(sourceRange.startMs)),
    Math.max(1, Math.round(sourceRange.durationMs)),
    sourceRange.reverse === true ? 'reverse' : 'forward',
  ].join('::');
}

function getAudioContextConstructor() {
  return (
    window.AudioContext ??
    (window as Window & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext
  );
}

function trimWaveformPeakCache() {
  while (waveformPeakCache.size > MAX_WAVEFORM_CACHE_ENTRIES) {
    const firstKey = waveformPeakCache.keys().next().value;
    if (!firstKey) return;
    waveformPeakCache.delete(firstKey);
  }
}

async function getPersistedWaveformPeaks(
  cacheKey: string,
): Promise<number[] | null> {
  const db = await getWaveformDb();
  if (!db) return null;
  const record = await idbRequest<WaveformPeakRecord | undefined>(
    db
      .transaction(WAVEFORM_DB_STORE, 'readonly')
      .objectStore(WAVEFORM_DB_STORE)
      .get(cacheKey),
  );
  return record?.peaks ?? null;
}

async function setPersistedWaveformPeaks(
  cacheKey: string,
  peaks: number[],
): Promise<void> {
  const db = await getWaveformDb();
  if (!db) return;
  await idbRequest(
    db
      .transaction(WAVEFORM_DB_STORE, 'readwrite')
      .objectStore(WAVEFORM_DB_STORE)
      .put({ key: cacheKey, peaks, createdAt: new Date().toISOString() }),
  );
}

function getWaveformDb(): Promise<IDBDatabase | null> {
  if (waveformDbPromise) return waveformDbPromise;
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  waveformDbPromise = new Promise((resolve) => {
    const request = indexedDB.open(WAVEFORM_DB_NAME, WAVEFORM_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(WAVEFORM_DB_STORE)) {
        db.createObjectStore(WAVEFORM_DB_STORE, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
  return waveformDbPromise;
}

function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error('IndexedDB error'));
  });
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortError();
}

function abortError(): DOMException {
  return new DOMException('Waveform decode aborted', 'AbortError');
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

interface WaveformPeakRecord {
  key: string;
  peaks: number[];
  createdAt: string;
}

interface WaveformWorkerRequest {
  id: string;
  src: string;
  bucketCount: number;
  sourceRange?: WaveformSourceRange;
}

interface WaveformWorkerResponse {
  id: string;
  peaks?: number[];
  error?: string;
}

function pseudoAmplitude(seed: string, index: number): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const mixed = Math.sin((hash + index * 97) * 12.9898) * 43758.5453;
  return 0.08 + (mixed - Math.floor(mixed)) * 0.92;
}
