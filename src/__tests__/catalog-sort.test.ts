import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  catalogTimestamp,
  readStoredCatalogSortOrder,
  sortByNewest,
  writeStoredCatalogSortOrder,
} from '@/shared/utils/catalog-sort';

import { installLocalStorageMock } from './helpers/local-storage';

beforeEach(() => {
  installLocalStorageMock();
  vi.restoreAllMocks();
});

describe('catalogTimestamp', () => {
  it('prefers updatedAt over createdAt over installedAt', () => {
    expect(
      catalogTimestamp({
        updatedAt: '2026-07-01T00:00:00.000Z',
        createdAt: '2026-06-01T00:00:00.000Z',
        installedAt: '2026-05-01T00:00:00.000Z',
      }),
    ).toBe(Date.parse('2026-07-01T00:00:00.000Z'));
    expect(catalogTimestamp({ installedAt: '2026-05-01T00:00:00.000Z' })).toBe(
      Date.parse('2026-05-01T00:00:00.000Z'),
    );
  });

  it('skips unparseable values and returns undefined without timestamps', () => {
    expect(
      catalogTimestamp({
        updatedAt: 'not-a-date',
        installedAt: '2026-05-01T00:00:00.000Z',
      }),
    ).toBe(Date.parse('2026-05-01T00:00:00.000Z'));
    expect(catalogTimestamp({})).toBeUndefined();
  });
});

describe('sortByNewest', () => {
  const record = (id: string, ts?: string) => ({ id, ts });
  const timestamp = (item: { ts?: string }) =>
    item.ts ? Date.parse(item.ts) : undefined;

  it('sorts newest first and keeps timestamp-less records in curated order', () => {
    const sorted = sortByNewest(
      [
        record('bundled-a'),
        record('old', '2026-01-01T00:00:00.000Z'),
        record('bundled-b'),
        record('new', '2026-07-01T00:00:00.000Z'),
      ],
      timestamp,
    );
    expect(sorted.map((item) => item.id)).toEqual([
      'new',
      'old',
      'bundled-a',
      'bundled-b',
    ]);
  });

  it('is stable: fully tied batches keep their incoming order', () => {
    const sorted = sortByNewest(
      [
        record('first', '2026-06-01T00:00:00.000Z'),
        record('second', '2026-06-01T00:00:00.000Z'),
        record('third', '2026-06-01T00:00:00.000Z'),
      ],
      timestamp,
    );
    expect(sorted.map((item) => item.id)).toEqual(['first', 'second', 'third']);
  });

  it('does not mutate the input', () => {
    const input = [record('a', '2026-01-01T00:00:00.000Z'), record('b')];
    sortByNewest(input, timestamp);
    expect(input.map((item) => item.id)).toEqual(['a', 'b']);
  });
});

describe('sort order persistence', () => {
  it('round-trips through localStorage per catalog key', () => {
    expect(readStoredCatalogSortOrder('design-systems')).toBe('curated');
    writeStoredCatalogSortOrder('design-systems', 'newest');
    expect(readStoredCatalogSortOrder('design-systems')).toBe('newest');
    expect(readStoredCatalogSortOrder('other-catalog')).toBe('curated');
  });

  it('ignores unknown stored values', () => {
    window.localStorage.setItem('neuma:catalog-sort:design-systems', 'hot');
    expect(readStoredCatalogSortOrder('design-systems')).toBe('curated');
  });

  it('falls back to curated when storage throws', () => {
    const storage = installLocalStorageMock();
    vi.spyOn(storage, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(storage, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(readStoredCatalogSortOrder('design-systems')).toBe('curated');
    expect(() =>
      writeStoredCatalogSortOrder('design-systems', 'newest'),
    ).not.toThrow();
  });
});
