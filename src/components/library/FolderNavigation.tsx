import { ChevronRight, Folder, Home } from 'lucide-react';

import type { MediaGridItem } from './MediaGridView';

export interface FolderPathEntry {
  id: string;
  name: string;
}

// `folder=<base64>` carries the breadcrumb stack so the browser back button
// and history navigation walk up one folder at a time. Base64 keeps the URL
// readable for short paths and avoids escaping issues with arbitrary
// provider id syntax (Immich uses `album:<uuid>`, Box uses numeric ids).
export function encodeFolderPath(path: FolderPathEntry[]): string {
  if (path.length === 0) return '';
  try {
    const json = JSON.stringify(path);
    if (typeof btoa === 'function') {
      // Use URL-safe base64 — no `+`, `/`, or `=` to keep the query clean.
      return btoa(unescape(encodeURIComponent(json)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
    }
    return encodeURIComponent(json);
  } catch {
    return '';
  }
}

export function decodeFolderPath(encoded: string | null): FolderPathEntry[] {
  if (!encoded) return [];
  try {
    let json: string;
    if (typeof atob === 'function') {
      const padded =
        encoded.replace(/-/g, '+').replace(/_/g, '/') +
        '='.repeat((4 - (encoded.length % 4)) % 4);
      json = decodeURIComponent(escape(atob(padded)));
    } else {
      json = decodeURIComponent(encoded);
    }
    const value = JSON.parse(json) as unknown;
    if (!Array.isArray(value)) return [];
    return value
      .filter(
        (entry): entry is FolderPathEntry =>
          !!entry &&
          typeof (entry as { id?: unknown }).id === 'string' &&
          typeof (entry as { name?: unknown }).name === 'string',
      )
      .map((entry) => ({ id: entry.id, name: entry.name }));
  } catch {
    return [];
  }
}

export function FolderBreadcrumbs({
  path,
  rootLabel,
  onNavigate,
}: {
  path: FolderPathEntry[];
  rootLabel: string;
  onNavigate: (depth: number) => void;
}) {
  return (
    <nav
      aria-label="Folder breadcrumbs"
      className="text-muted-foreground flex flex-wrap items-center gap-1 text-xs"
    >
      <button
        type="button"
        onClick={() => onNavigate(0)}
        className="hover:text-foreground inline-flex items-center gap-1 rounded px-1.5 py-0.5"
      >
        <Home className="size-3" aria-hidden />
        <span className="truncate">{rootLabel}</span>
      </button>
      {path.map((entry, idx) => {
        const isLast = idx === path.length - 1;
        return (
          <span key={entry.id} className="inline-flex items-center gap-1">
            <ChevronRight className="size-3 shrink-0" aria-hidden />
            {isLast ? (
              <span className="text-foreground truncate px-1.5 py-0.5 font-medium">
                {entry.name}
              </span>
            ) : (
              <button
                type="button"
                onClick={() => onNavigate(idx + 1)}
                className="hover:text-foreground truncate rounded px-1.5 py-0.5"
              >
                {entry.name}
              </button>
            )}
          </span>
        );
      })}
    </nav>
  );
}

export function FolderStrip({
  items,
  label,
  language,
  s,
  onOpen,
}: {
  items: MediaGridItem[];
  label: string;
  language: string;
  s: Record<string, string>;
  onOpen: (item: MediaGridItem) => void;
}) {
  return (
    <section
      aria-label={label}
      className="space-y-2"
      data-testid="folder-strip"
    >
      <h3 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
        {label}
      </h3>
      {/*
        Auto-fill grid with a generous minimum (240px). Matches what Google
        Drive Web and Box Web do on the folder header row — folder names
        like "AfterEffectsTemplates" or "Box Reports 2024" stay readable
        instead of getting clipped to 12 characters.
      */}
      <div
        className="grid gap-2"
        style={{
          gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
        }}
      >
        {items.map((item) => (
          <FolderCard
            key={item.id}
            item={item}
            onOpen={onOpen}
            language={language}
            s={s}
          />
        ))}
      </div>
    </section>
  );
}

function FolderCard({
  item,
  onOpen,
  language,
  s,
}: {
  item: MediaGridItem;
  onOpen: (item: MediaGridItem) => void;
  language: string;
  s: Record<string, string>;
}) {
  const meta = folderMetaLine(item, language, s);
  const tooltip = folderTooltip(item, language, s);
  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      title={tooltip}
      className="bg-card border-border hover:border-primary/40 hover:bg-muted/40 group flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors"
    >
      <div className="bg-muted text-muted-foreground flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-md">
        {item.thumbnailUrl ? (
          <img
            src={item.thumbnailUrl}
            alt=""
            className="size-full object-cover"
            decoding="async"
            loading="lazy"
          />
        ) : (
          <Folder className="size-5" aria-hidden />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-foreground truncate text-sm font-medium">
          {item.name}
        </p>
        {meta ? (
          <p className="text-muted-foreground truncate text-xs">{meta}</p>
        ) : null}
      </div>
    </button>
  );
}

function folderMetaLine(
  item: MediaGridItem,
  language: string,
  s: Record<string, string>,
): string {
  // Prioritize the most identifying secondary signal: item count when we
  // know it (Immich albums), otherwise the last-modified date — same order
  // Google Drive / Box / Dropbox use on their folder rows.
  const parts: string[] = [];
  if (typeof item.itemCount === 'number') {
    parts.push(formatItemCount(item.itemCount, item.provider, s));
  }
  const modified = formatRelativeDate(item.modifiedAt, language);
  if (modified) parts.push(modified);
  return parts.join(' · ');
}

function folderTooltip(
  item: MediaGridItem,
  language: string,
  s: Record<string, string>,
): string {
  const lines: string[] = [item.name];
  if (typeof item.itemCount === 'number') {
    lines.push(formatItemCount(item.itemCount, item.provider, s));
  }
  const modified = formatRelativeDate(item.modifiedAt, language);
  if (modified) {
    lines.push(`${s.folderTooltipModified ?? 'Modified'}: ${modified}`);
  }
  return lines.join('\n');
}

function formatItemCount(
  count: number,
  provider: string | undefined,
  s: Record<string, string>,
): string {
  // Immich/PhotoPrism albums use "photos" / "items"; everything else uses
  // a generic "{n} items" string. Templated through the locale so the
  // singular/plural switch can be localized.
  const template =
    provider === 'immich' || provider === 'photoprism'
      ? count === 1
        ? (s.folderItemCountSingular_album ?? '{count} item')
        : (s.folderItemCountPlural_album ?? '{count} items')
      : count === 1
        ? (s.folderItemCountSingular ?? '{count} item')
        : (s.folderItemCountPlural ?? '{count} items');
  return template.replace('{count}', count.toLocaleString());
}

function formatRelativeDate(
  value: string | Date | undefined,
  language: string,
): string {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(language, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date);
}

export function folderStripLabel(
  provider: string,
  s: Record<string, string>,
): string {
  // Per-provider terminology — matches the official terms each service uses
  // in its own UI/API. Immich calls them Albums, the rest call them Folders.
  if (provider === 'immich' || provider === 'photoprism') {
    return s.albumsSectionTitle ?? 'Albums';
  }
  return s.foldersSectionTitle ?? 'Folders';
}
