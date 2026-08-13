// Shared catalog ordering primitive (07-06 Open Design sync, upstream
// e9b4a96cf). Catalog surfaces keep their curated order by default and can
// offer a `newest` order when records carry real timestamps. The choice is
// remembered per catalog through localStorage, best-effort.
export type CatalogSortOrder = 'curated' | 'newest';

export const DEFAULT_CATALOG_SORT_ORDER: CatalogSortOrder = 'curated';

const STORAGE_KEY_PREFIX = 'neuma:catalog-sort:';

export interface CatalogTimestampFields {
  updatedAt?: string;
  createdAt?: string;
  installedAt?: string;
}

function isCatalogSortOrder(value: unknown): value is CatalogSortOrder {
  return value === 'curated' || value === 'newest';
}

export function readStoredCatalogSortOrder(
  catalogKey: string,
): CatalogSortOrder {
  try {
    const raw = window.localStorage.getItem(
      `${STORAGE_KEY_PREFIX}${catalogKey}`,
    );
    return isCatalogSortOrder(raw) ? raw : DEFAULT_CATALOG_SORT_ORDER;
  } catch {
    return DEFAULT_CATALOG_SORT_ORDER;
  }
}

export function writeStoredCatalogSortOrder(
  catalogKey: string,
  order: CatalogSortOrder,
): void {
  try {
    window.localStorage.setItem(`${STORAGE_KEY_PREFIX}${catalogKey}`, order);
  } catch {
    // Preference persistence is best-effort; sorting still works for the
    // session when storage is unavailable.
  }
}

// Freshness in epoch ms: updatedAt wins over createdAt over installedAt.
// Returns undefined for records with no parseable timestamp so they can keep
// their curated position.
export function catalogTimestamp(
  fields: CatalogTimestampFields,
): number | undefined {
  for (const value of [
    fields.updatedAt,
    fields.createdAt,
    fields.installedAt,
  ]) {
    if (!value) continue;
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return undefined;
}

// Newest-first, stable: timestamped records lead, ties and timestamp-less
// records keep their incoming (curated) relative order — a catalog seeded in
// one batch does not collapse into arbitrary order.
export function sortByNewest<T>(
  records: readonly T[],
  timestamp: (record: T) => number | undefined,
): T[] {
  const annotated = records.map((record, idx) => ({
    idx,
    record,
    ts: timestamp(record),
  }));
  annotated.sort((a, b) => {
    if (a.ts !== b.ts) {
      if (a.ts === undefined) return 1;
      if (b.ts === undefined) return -1;
      return b.ts - a.ts;
    }
    return a.idx - b.idx;
  });
  return annotated.map((entry) => entry.record);
}
