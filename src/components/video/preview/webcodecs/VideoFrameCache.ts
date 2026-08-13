import {
  ALL_FORMATS,
  CanvasSink,
  Input,
  UrlSource,
  type CanvasSinkOptions,
  type WrappedCanvas,
} from 'mediabunny';

const DEFAULT_MAX_CACHE_SIZE_BYTES = 16 * 1024 * 1024;
const DEFAULT_PARALLELISM = 2;
const DEFAULT_POOL_SIZE = 2;

export interface VideoFrameCacheRequest {
  cacheKey?: string;
  maxCacheSizeBytes?: number;
  maxOutputHeight?: number;
  maxOutputWidth?: number;
  parallelism?: number;
  src: string;
  timeSec: number;
}

export interface VideoFrameCacheBatchRequest extends VideoFrameCacheRequest {
  id: string;
}

interface VideoFrameSource {
  frameChain: Promise<unknown>;
  input: Input<UrlSource>;
  sink: CanvasSink;
}

export class WebCodecsPreviewDecodeError extends Error {
  constructor(
    message: string,
    public readonly code: 'disposed' | 'no-video-track' | 'unsupported-codec',
  ) {
    super(message);
    this.name = 'WebCodecsPreviewDecodeError';
  }
}

export class VideoFrameCache {
  private readonly initTokens = new Map<string, symbol>();
  private readonly sources = new Map<string, VideoFrameSource>();
  private readonly initPromises = new Map<string, Promise<VideoFrameSource>>();

  async getFrameAt(
    request: VideoFrameCacheRequest,
  ): Promise<WrappedCanvas | null> {
    const source = await this.ensureSource(request);
    const timeSec = normalizeTimeSec(request.timeSec);
    const nextFrame = source.frameChain.then(() =>
      source.sink.getCanvas(timeSec),
    );
    source.frameChain = nextFrame.catch(() => undefined);
    return nextFrame;
  }

  async getFramesAt(
    requests: VideoFrameCacheBatchRequest[],
  ): Promise<Map<string, WrappedCanvas | null>> {
    const results = new Map<string, WrappedCanvas | null>();
    const groups = new Map<string, VideoFrameCacheBatchRequest[]>();
    for (const request of requests) {
      const key = getVideoFrameCacheKey(request);
      groups.set(key, [...(groups.get(key) ?? []), request]);
    }

    await Promise.all(
      [...groups.values()].map(async (group) => {
        const source = await this.ensureSource(group[0]!);
        const ordered = [...group].sort(
          (a, b) => normalizeTimeSec(a.timeSec) - normalizeTimeSec(b.timeSec),
        );
        const batch = source.frameChain.then(async () => {
          let index = 0;
          for await (const frame of source.sink.canvasesAtTimestamps(
            ordered.map((request) => normalizeTimeSec(request.timeSec)),
          )) {
            const request = ordered[index];
            if (request) results.set(request.id, frame);
            index += 1;
          }
          for (; index < ordered.length; index += 1) {
            results.set(ordered[index]!.id, null);
          }
        });
        source.frameChain = batch.catch(() => undefined);
        await batch;
      }),
    );

    return results;
  }

  dispose(cacheKey?: string): void {
    if (cacheKey) {
      this.dropPendingSource(cacheKey);
      this.disposeSource(cacheKey);
      return;
    }
    this.initTokens.clear();
    this.initPromises.clear();
    for (const key of this.sources.keys()) {
      this.disposeSource(key);
    }
  }

  private async ensureSource(
    request: VideoFrameCacheRequest,
  ): Promise<VideoFrameSource> {
    const key = getVideoFrameCacheKey(request);
    const existing = this.sources.get(key);
    if (existing) return existing;
    const pending = this.initPromises.get(key);
    if (pending) return pending;

    const initToken = Symbol(key);
    this.initTokens.set(key, initToken);
    const init = this.createSource(request)
      .then((source) => {
        if (this.initTokens.get(key) !== initToken) {
          source.input.dispose();
          throw new WebCodecsPreviewDecodeError(
            'Video frame source disposed',
            'disposed',
          );
        }
        this.sources.set(key, source);
        this.initPromises.delete(key);
        this.initTokens.delete(key);
        return source;
      })
      .catch((error) => {
        const isActiveInit = this.initTokens.get(key) === initToken;
        if (isActiveInit) {
          this.initPromises.delete(key);
          this.initTokens.delete(key);
          throw error;
        }
        throw new WebCodecsPreviewDecodeError(
          'Video frame source disposed',
          'disposed',
        );
      });
    this.initPromises.set(key, init);
    return init;
  }

  private async createSource(
    request: VideoFrameCacheRequest,
  ): Promise<VideoFrameSource> {
    const input = new Input({
      formats: ALL_FORMATS,
      source: new UrlSource(request.src, {
        maxCacheSize: request.maxCacheSizeBytes ?? DEFAULT_MAX_CACHE_SIZE_BYTES,
        parallelism: request.parallelism ?? DEFAULT_PARALLELISM,
      }),
    });
    try {
      const track = await input.getPrimaryVideoTrack();
      if (!track) {
        throw new WebCodecsPreviewDecodeError(
          'No primary video track found',
          'no-video-track',
        );
      }
      if (!(await track.canDecode())) {
        throw new WebCodecsPreviewDecodeError(
          'Primary video track cannot be decoded by WebCodecs',
          'unsupported-codec',
        );
      }
      return {
        frameChain: Promise.resolve(),
        input,
        sink: new CanvasSink(track, getCanvasSinkOptions(request)),
      };
    } catch (error) {
      input.dispose();
      throw error;
    }
  }

  private disposeSource(cacheKey: string): void {
    const source = this.sources.get(cacheKey);
    if (!source) return;
    source.input.dispose();
    this.sources.delete(cacheKey);
  }

  private dropPendingSource(cacheKey: string): void {
    this.initTokens.delete(cacheKey);
    this.initPromises.delete(cacheKey);
  }
}

export function getVideoFrameCacheKey({
  cacheKey,
  maxOutputHeight,
  maxOutputWidth,
  src,
}: Pick<
  VideoFrameCacheRequest,
  'cacheKey' | 'maxOutputHeight' | 'maxOutputWidth' | 'src'
>): string {
  return (
    cacheKey ??
    `${src}|${maxOutputWidth ?? 'auto'}x${maxOutputHeight ?? 'auto'}`
  );
}

export function normalizeTimeSec(timeSec: number): number {
  return Number.isFinite(timeSec) ? Math.max(0, timeSec) : 0;
}

function getCanvasSinkOptions({
  maxOutputHeight,
  maxOutputWidth,
}: VideoFrameCacheRequest): CanvasSinkOptions {
  return {
    fit: maxOutputHeight && maxOutputWidth ? 'contain' : undefined,
    height: maxOutputHeight,
    poolSize: DEFAULT_POOL_SIZE,
    width: maxOutputWidth,
  };
}
