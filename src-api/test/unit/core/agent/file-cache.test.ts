import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FileStateCache } from '@/core/agent/file-cache';

const TEST_DIR = join(tmpdir(), 'neuma-file-cache-test');

beforeAll(() => {
  if (!existsSync(TEST_DIR)) {
    mkdirSync(TEST_DIR, { recursive: true });
  }
});

afterAll(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

function createTempFile(
  name: string,
  content: string,
): { path: string; mtime: number } {
  const path = join(TEST_DIR, name);
  writeFileSync(path, content);
  const { mtimeMs } = require('node:fs').statSync(path);
  return { path, mtime: mtimeMs };
}

describe('FileStateCache', () => {
  it('returns undefined on cache miss', () => {
    const cache = new FileStateCache();
    expect(cache.get('/nonexistent')).toBeUndefined();
  });

  it('returns cached entry when mtime matches', () => {
    const cache = new FileStateCache();
    const { path, mtime } = createTempFile('test1.txt', 'hello');
    cache.set(path, 'hello', mtime);
    const entry = cache.get(path);
    expect(entry).toBeDefined();
    expect(entry!.content).toBe('hello');
    expect(entry!.size).toBe(5);
  });

  it('invalidates when mtime changes', () => {
    const cache = new FileStateCache();
    const { path, mtime } = createTempFile('test2.txt', 'v1');
    cache.set(path, 'v1', mtime);

    // Modify the file
    writeFileSync(path, 'v2');
    // Cache should return undefined (mtime mismatch)
    expect(cache.get(path)).toBeUndefined();
  });

  it('handles deleted files (ENOENT)', () => {
    const cache = new FileStateCache();
    const path = join(TEST_DIR, 'deleted.txt');
    writeFileSync(path, 'temp');
    const { mtimeMs } = require('node:fs').statSync(path);
    cache.set(path, 'temp', mtimeMs);

    // Delete the file
    rmSync(path);
    expect(cache.get(path)).toBeUndefined();
  });

  it('invalidates a specific path', () => {
    const cache = new FileStateCache();
    const { path, mtime } = createTempFile('test3.txt', 'data');
    cache.set(path, 'data', mtime);
    cache.invalidate(path);
    // Still returns undefined because it's been deleted from cache
    // (even though file still exists on disk)
    expect(cache.get(path)).toBeUndefined();
  });

  it('invalidates by pattern', () => {
    const cache = new FileStateCache();
    const f1 = createTempFile('prefix_a.txt', 'a');
    const f2 = createTempFile('prefix_b.txt', 'b');
    const f3 = createTempFile('other.txt', 'c');
    cache.set(f1.path, 'a', f1.mtime);
    cache.set(f2.path, 'b', f2.mtime);
    cache.set(f3.path, 'c', f3.mtime);

    cache.invalidatePattern('*prefix*');
    expect(cache.get(f1.path)).toBeUndefined();
    expect(cache.get(f2.path)).toBeUndefined();
    // other.txt should not match
    expect(cache.get(f3.path)).toBeDefined();
  });

  it('tracks hit and miss metrics', () => {
    const cache = new FileStateCache();
    const { path, mtime } = createTempFile('metrics.txt', 'hi');
    cache.set(path, 'hi', mtime);

    cache.get(path); // hit
    cache.get('/no-such-file'); // miss

    const metrics = cache.getMetrics();
    expect(metrics.hits).toBe(1);
    expect(metrics.misses).toBe(1);
    expect(metrics.size).toBe(1);
  });

  it('clones to a new independent instance', () => {
    const cache = new FileStateCache();
    const { path, mtime } = createTempFile('clone.txt', 'data');
    cache.set(path, 'data', mtime);

    const cloned = cache.clone();
    expect(cloned.get(path)).toBeDefined();

    // Mutating original doesn't affect clone
    cache.invalidate(path);
    expect(cloned.get(path)).toBeDefined();
  });
});
