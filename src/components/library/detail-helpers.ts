/**
 * Pure helpers shared by the plugin detail bodies (available + installed):
 * URL validation, source-ref formatting, author normalization, and a
 * best-effort GitHub web URL.
 */

import type { AvailablePluginEntry } from '@/shared/hooks/useMarketplaceSources';

export function safeUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  try {
    const u = new URL(value);
    return u.protocol === 'https:' || u.protocol === 'http:' ? value : null;
  } catch {
    return null;
  }
}

/** Human-readable install source string for the provenance / catalog rows. */
export function sourceRef(entry: AvailablePluginEntry): string {
  const source = entry.entry.source;
  if (typeof source === 'string') return source;
  if (source && typeof source === 'object') {
    const record = source as Record<string, unknown>;
    const repo = record.repo as string | undefined;
    const path = record.path as string | undefined;
    if (repo) return path ? `${repo}/${path}` : repo;
    return (record.url as string) ?? (record.source as string) ?? '';
  }
  return '';
}

export function authorName(
  author: AvailablePluginEntry['entry']['author'],
): { name: string; url?: string } | null {
  if (!author) return null;
  if (typeof author === 'string') return { name: author };
  if (author.name) return author;
  return null;
}

/**
 * Best-effort GitHub web URL for a catalog entry whose source is a github
 * object (`{ source: 'github', repo, ref?, path? }`). Returns null otherwise.
 */
export function githubWebUrl(entry: AvailablePluginEntry): string | null {
  const source = entry.entry.source;
  if (!source || typeof source !== 'object') return safeUrl(source);
  const record = source as Record<string, unknown>;
  const repo = record.repo as string | undefined;
  if (!repo) return safeUrl(record.url);
  const ref = (record.ref as string | undefined) ?? 'main';
  const path = record.path as string | undefined;
  const base = `https://github.com/${repo}/tree/${ref}`;
  return path ? `${base}/${path}` : base;
}
