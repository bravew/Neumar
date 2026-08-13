/**
 * File State Cache
 *
 * LRU cache for file content with mtime-based invalidation.
 * Prevents re-reading unchanged files across agent turns.
 */

import { statSync } from 'node:fs';

import { LRUCache } from 'lru-cache';

import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('FileCache');

const DEFAULT_MAX_ENTRIES = 500;
const DEFAULT_TTL_MS = 30 * 60 * 1000; // 30 minutes

// ============================================================================
// Types
// ============================================================================

export interface FileEntry {
  content: string;
  mtime: number;
  size: number;
}

// ============================================================================
// File State Cache
// ============================================================================

export class FileStateCache {
  private cache: LRUCache<string, FileEntry>;
  private hits = 0;
  private misses = 0;

  constructor(maxEntries = DEFAULT_MAX_ENTRIES) {
    this.cache = new LRUCache<string, FileEntry>({
      max: maxEntries,
      ttl: DEFAULT_TTL_MS,
      updateAgeOnGet: true,
      updateAgeOnHas: true,
      dispose: (_value, key) => {
        logger.debug(`File evicted from cache: ${key}`);
      },
    });
  }

  /**
   * Get cached file entry if mtime matches disk.
   * Returns undefined on cache miss or stale entry.
   */
  get(path: string): FileEntry | undefined {
    const entry = this.cache.get(path);
    if (!entry) {
      this.misses++;
      return undefined;
    }

    // Validate mtime against disk
    try {
      const stat = statSync(path);
      if (stat.mtimeMs !== entry.mtime) {
        // File changed on disk — invalidate
        this.cache.delete(path);
        this.misses++;
        logger.debug(`File cache stale (mtime changed): ${path}`);
        return undefined;
      }
    } catch (err: unknown) {
      // File deleted externally — remove from cache
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        this.cache.delete(path);
        this.misses++;
        logger.debug(`File deleted externally, removed from cache: ${path}`);
        return undefined;
      }
      // Other stat errors — treat as miss but don't evict
      this.misses++;
      return undefined;
    }

    this.hits++;
    return entry;
  }

  /** Cache a file entry. */
  set(path: string, content: string, mtime: number): void {
    this.cache.set(path, { content, mtime, size: content.length });
  }

  /** Invalidate a specific file (e.g. after Write/Edit tool). */
  invalidate(path: string): void {
    this.cache.delete(path);
  }

  /**
   * Invalidate files matching a simple prefix or suffix pattern.
   * Uses basic string matching (no glob library dependency).
   */
  invalidatePattern(pattern: string): void {
    const isPrefix = pattern.endsWith('*');
    const isSuffix = pattern.startsWith('*');
    const core = pattern.replace(/^\*|\*$/g, '');

    for (const key of this.cache.keys()) {
      const match =
        isPrefix && isSuffix
          ? key.includes(core)
          : (isPrefix && key.startsWith(core)) ||
            (isSuffix && key.endsWith(core)) ||
            (!isPrefix && !isSuffix && key.includes(core));
      if (match) {
        this.cache.delete(key);
      }
    }
  }

  /** Shallow clone for sub-agent sharing (shares no mutable state). */
  clone(): FileStateCache {
    const cloned = new FileStateCache(this.cache.max);
    for (const [key, value] of this.cache.entries()) {
      if (value) {
        cloned.cache.set(key, { ...value });
      }
    }
    return cloned;
  }

  /** Observability metrics. */
  getMetrics(): { size: number; hits: number; misses: number } {
    return {
      size: this.cache.size,
      hits: this.hits,
      misses: this.misses,
    };
  }
}
