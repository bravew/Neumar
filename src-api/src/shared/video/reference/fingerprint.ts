import { createHash } from 'node:crypto';

/**
 * Canonical JSON + sha256 hasher for the reference artifact chain.
 * Sibling to `multicamFingerprint()` — do not extend that helper.
 * Labels are excluded by callers so a rename does not invalidate work.
 */
export function referenceFingerprint(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, sortValue(nested)]),
    );
  }
  return value;
}
