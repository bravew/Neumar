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
// mediabunny's own docs on `canvasesAtTimestamps` (the sparse per-timestamp
// lookup this cache used exclusively before): "This method is good for
// sparse access of media data. If you want primarily sequential media
// access, prefer CanvasSink.canvases instead." Continuous playback is
// exactly that sequential case — re-opening a fresh sparse lookup every
// single rendered frame throws away any decode-ahead state between calls,
// which is what made playback stutter under load. `canvases()` returns a
// live generator that keeps pre-decoding ahead of what's been consumed, so
// a cursor over it carries that lookahead across render calls.
const MAX_SEQUENTIAL_GAP_SEC = 1.5;
// Generous enough to walk the full gap above even for a 60fps source
// (1.5s * 60fps = 90) without truncating before reaching the target.
const SEQUENTIAL_ADVANCE_GUARD = 90;

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
  /** The active forward-playback cursor over `sink.canvases()`, if any. */
  sequential: SequentialCursor | null;
}

interface SequentialCursor {
  iterator: AsyncGenerator<WrappedCanvas | null>;
  /** Last frame returned to a caller — reused when nothing newer qualifies. */
  lastFrame: WrappedCanvas | null;
  /** A frame already pulled from the iterator but not yet due — the next
   *  call resumes from here instead of re-pulling. */
  lookahead: WrappedCanvas | null;
  /** Where this cursor believes playback currently is. */
  cursorTimeSec: number;
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
        // Only a lone request for this source is unambiguously "the next
        // frame of continuous playback" — anything else (a transition's
        // from/to pair, several simultaneous layers of the same source)
        // needs arbitrary timestamps at once, which is exactly the sparse
        // case `canvasesAtTimestamps` is for. Route that batch through the
        // existing tested path unchanged.
        if (group.length === 1) {
          const request = group[0]!;
          const timeSec = normalizeTimeSec(request.timeSec);
          const sequential = source.frameChain.then(() =>
            this.getSequentialFrame(source, timeSec),
          );
          source.frameChain = sequential.catch(() => undefined);
          results.set(request.id, await sequential);
          return;
        }

        const ordered = [...group].sort(
          (a, b) => normalizeTimeSec(a.timeSec) - normalizeTimeSec(b.timeSec),
        );
        const batch = source.frameChain.then(async () => {
          this.discardSequentialCursor(source);
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
        sequential: null,
        sink: new CanvasSink(track, getCanvasSinkOptions(request)),
      };
    } catch (error) {
      input.dispose();
      throw error;
    }
  }

  /**
   * Returns the frame at `timeSec` via a cursor over `sink.canvases()`,
   * reusing the existing one when `timeSec` continues the forward playback
   * it's already following (a normal next-frame request), or opening a
   * fresh one otherwise (first request for this source, a backward seek, or
   * a jump far enough ahead that walking frame-by-frame would cost more
   * than just reseeking). Callers must already be inside `source.frameChain`
   * — this does not chain itself.
   */
  private async getSequentialFrame(
    source: VideoFrameSource,
    timeSec: number,
  ): Promise<WrappedCanvas | null> {
    const existing = source.sequential;
    if (
      existing &&
      timeSec >= existing.cursorTimeSec &&
      timeSec - existing.cursorTimeSec <= MAX_SEQUENTIAL_GAP_SEC
    ) {
      return this.advanceSequentialCursor(existing, timeSec);
    }

    // No cursor yet, or this request doesn't continue the existing one —
    // start fresh at `timeSec`. A cursor that turns out to be a one-off (a
    // single scrub frame) costs about the same as the sparse lookup it
    // replaces; one that turns out to be the start of playback pays off on
    // every subsequent frame that continues it.
    if (existing) this.closeSequentialCursor(existing);
    const cursor: SequentialCursor = {
      cursorTimeSec: timeSec,
      iterator: source.sink.canvases(timeSec),
      lastFrame: null,
      lookahead: null,
    };
    source.sequential = cursor;
    return this.advanceSequentialCursor(cursor, timeSec);
  }

  private async advanceSequentialCursor(
    cursor: SequentialCursor,
    timeSec: number,
  ): Promise<WrappedCanvas | null> {
    let result = cursor.lastFrame;
    for (let guard = 0; guard < SEQUENTIAL_ADVANCE_GUARD; guard += 1) {
      let next = cursor.lookahead;
      cursor.lookahead = null;
      if (next === null) {
        const step = await cursor.iterator.next();
        if (step.done) break;
        next = step.value;
      }
      if (next === null) continue; // no frame at this position; keep walking
      if (next.timestamp > timeSec) {
        cursor.lookahead = next;
        break;
      }
      result = next;
      cursor.lastFrame = next;
    }
    cursor.cursorTimeSec = timeSec;
    return result;
  }

  private discardSequentialCursor(source: VideoFrameSource): void {
    if (!source.sequential) return;
    this.closeSequentialCursor(source.sequential);
    source.sequential = null;
  }

  private closeSequentialCursor(cursor: SequentialCursor): void {
    void cursor.iterator.return?.(undefined).catch(() => {});
  }

  private disposeSource(cacheKey: string): void {
    const source = this.sources.get(cacheKey);
    if (!source) return;
    if (source.sequential) this.closeSequentialCursor(source.sequential);
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
