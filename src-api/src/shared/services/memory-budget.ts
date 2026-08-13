import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('MemoryBudget');

export const SIDECAR_RSS_BUDGET_MB = 1536;
export const EMBEDDER_LRU_BUDGET_BYTES = 64 * 1024 * 1024;
export const RENDER_CACHE_INDEX_BUDGET_BYTES = 16 * 1024 * 1024;
export const SERVER_WAVE_PEAK_BUDGET_BYTES = 32 * 1024 * 1024;
export const FFMPEG_MAX_CONCURRENT_RENDERS = 2;

const RSS_WARN_COOLDOWN_MS = 60_000;
const PRESSURE_TRIM_COOLDOWN_MS = 60_000;
const PRESSURE_MONITOR_INTERVAL_MS = 5_000;

export interface MemoryBudgetStatus {
  rssMb: number;
  rssBudgetMb: number;
  underPressure: boolean;
  lastEvictionAt: string | null;
  evictionCount: number;
  activeFfmpegRenders: number;
  queuedFfmpegRenders: number;
  budgets: {
    embedderLruBytes: number;
    renderCacheBytes: number;
    renderCacheIndexBytes: number;
    wavePeakBytes: number;
    ffmpegMaxConcurrentRenders: number;
  };
}

interface EvictionRecord {
  cache: 'render-cache' | 'render-cache-index' | 'embedder-lru' | 'wave-peaks';
  reason: 'capacity' | 'memory-pressure';
  entriesRemoved: number;
  bytesRemoved?: number;
  rssMb?: number;
}

type FfmpegQueueItem = {
  resolve: () => void;
  reject: (error: Error) => void;
};

type MemoryPressureHandler = (rssMb: number) => void;

class MemoryBudgetSupervisor {
  private activeFfmpegRenders = 0;
  private ffmpegQueue: FfmpegQueueItem[] = [];
  private lastWarnAt = 0;
  private lastPressureTrimAt = 0;
  private lastEvictionAt: string | null = null;
  private evictionCount = 0;
  private pressureHandlers = new Map<string, MemoryPressureHandler>();
  private pressureMonitor: ReturnType<typeof setInterval>;

  constructor() {
    this.pressureMonitor = setInterval(() => {
      this.respondToPressure();
    }, PRESSURE_MONITOR_INTERVAL_MS);
    this.pressureMonitor.unref?.();
  }

  getStatus(): MemoryBudgetStatus {
    const rssMb = currentRssMb();
    const underPressure = rssMb >= SIDECAR_RSS_BUDGET_MB;
    return {
      rssMb,
      rssBudgetMb: SIDECAR_RSS_BUDGET_MB,
      underPressure,
      lastEvictionAt: this.lastEvictionAt,
      evictionCount: this.evictionCount,
      activeFfmpegRenders: this.activeFfmpegRenders,
      queuedFfmpegRenders: this.ffmpegQueue.length,
      budgets: {
        embedderLruBytes: EMBEDDER_LRU_BUDGET_BYTES,
        renderCacheBytes: 2 * 1024 * 1024 * 1024,
        renderCacheIndexBytes: RENDER_CACHE_INDEX_BUDGET_BYTES,
        wavePeakBytes: SERVER_WAVE_PEAK_BUDGET_BYTES,
        ffmpegMaxConcurrentRenders: FFMPEG_MAX_CONCURRENT_RENDERS,
      },
    };
  }

  recordEviction(record: EvictionRecord): void {
    if (record.entriesRemoved <= 0 && !record.bytesRemoved) return;
    this.evictionCount += Math.max(1, record.entriesRemoved);
    this.lastEvictionAt = new Date().toISOString();
    logger.warn('memory_budget.cache_evicted', {
      ...record,
      rssMb: record.rssMb ?? currentRssMb(),
      evictionCount: this.evictionCount,
      lastEvictionAt: this.lastEvictionAt,
    });
  }

  registerPressureHandler(
    name: string,
    handler: MemoryPressureHandler,
  ): () => void {
    this.pressureHandlers.set(name, handler);
    return () => {
      this.pressureHandlers.delete(name);
    };
  }

  async runWithFfmpegSlot<T>(
    operation: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    await this.acquireFfmpegSlot(signal);
    if (signal?.aborted) {
      this.releaseFfmpegSlot();
      throw new Error('FFmpeg render was aborted');
    }
    try {
      return await operation();
    } finally {
      this.releaseFfmpegSlot();
    }
  }

  resetForTests(): void {
    this.activeFfmpegRenders = 0;
    this.ffmpegQueue = [];
    this.lastWarnAt = 0;
    this.lastPressureTrimAt = 0;
    this.lastEvictionAt = null;
    this.evictionCount = 0;
  }

  private respondToPressure(): void {
    const rssMb = currentRssMb();
    if (rssMb < SIDECAR_RSS_BUDGET_MB) return;
    this.trimUnderPressure(rssMb);
    this.warnMemoryPressure(rssMb);
  }

  private trimUnderPressure(rssMb: number): void {
    const now = Date.now();
    if (now - this.lastPressureTrimAt < PRESSURE_TRIM_COOLDOWN_MS) return;
    this.lastPressureTrimAt = now;
    for (const [name, handler] of this.pressureHandlers) {
      try {
        handler(rssMb);
      } catch (err) {
        logger.warn('memory_budget.pressure_handler_failed', {
          name,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  private warnMemoryPressure(rssMb: number): void {
    const now = Date.now();
    if (now - this.lastWarnAt < RSS_WARN_COOLDOWN_MS) return;
    this.lastWarnAt = now;
    logger.warn('memory_budget.rss_pressure', {
      rssMb,
      rssBudgetMb: SIDECAR_RSS_BUDGET_MB,
      activeFfmpegRenders: this.activeFfmpegRenders,
      queuedFfmpegRenders: this.ffmpegQueue.length,
    });
  }

  private async acquireFfmpegSlot(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw new Error('FFmpeg render was aborted');
    if (this.activeFfmpegRenders < FFMPEG_MAX_CONCURRENT_RENDERS) {
      this.activeFfmpegRenders += 1;
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const item: FfmpegQueueItem = {
        resolve: () => {
          signal?.removeEventListener('abort', onAbort);
          resolve();
        },
        reject,
      };
      const onAbort = () => {
        this.ffmpegQueue = this.ffmpegQueue.filter(
          (candidate) => candidate !== item,
        );
        signal?.removeEventListener('abort', onAbort);
        reject(new Error('FFmpeg render was aborted'));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.ffmpegQueue.push(item);
    });
    this.activeFfmpegRenders += 1;
  }

  private releaseFfmpegSlot(): void {
    this.activeFfmpegRenders = Math.max(0, this.activeFfmpegRenders - 1);
    const next = this.ffmpegQueue.shift();
    next?.resolve();
  }
}

function currentRssMb(): number {
  return Math.round(process.memoryUsage().rss / 1024 / 1024);
}

export const memoryBudgetSupervisor = new MemoryBudgetSupervisor();

export function getMemoryBudgetSupervisor(): MemoryBudgetSupervisor {
  return memoryBudgetSupervisor;
}
