/**
 * Compact list view for the cloud-storage picker. Mirrors a desktop
 * file-manager details pane: icon + inline thumbnail, name, modified
 * date, size, owner. Folders pin to the top and clicking opens them via
 * `onOpen`. Column headers toggle sort (asc/desc) on click — folders
 * stay grouped on top regardless of sort direction.
 */
import { useMemo, useState } from 'react';

import { ArrowDown, ArrowUp, Check } from 'lucide-react';

import type { CloudFile } from '@/components/library/cloudStorageLibraryUtils';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

import { buildThumbnailUrl, iconForCloudFile } from './cloudStoragePickerUtils';

interface CloudStorageListViewProps {
  items: CloudFile[];
  connectionId: string;
  selectedIds: string[];
  onOpen: (id: string) => void;
  onPreview: (id: string) => void;
  onToggleSelect: (id: string) => void;
  onLoadMore?: () => void;
}

type SortKey = 'name' | 'modified' | 'size';
type SortDir = 'asc' | 'desc';

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

function formatDate(value: string | Date | undefined): string {
  if (!value) return '—';
  try {
    const d = value instanceof Date ? value : new Date(value);
    return d.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return '—';
  }
}

function timestamp(value: string | Date | undefined): number {
  if (!value) return 0;
  try {
    const d = value instanceof Date ? value : new Date(value);
    const t = d.getTime();
    return Number.isFinite(t) ? t : 0;
  } catch {
    return 0;
  }
}

function ItemThumb({
  item,
  connectionId,
}: {
  item: CloudFile;
  connectionId: string;
}) {
  const Icon = iconForCloudFile(item);
  const url = buildThumbnailUrl(item, connectionId);
  return (
    <span
      className={cn(
        'border-border/60 bg-muted/40 text-muted-foreground flex size-8 shrink-0 items-center justify-center overflow-hidden rounded border',
        item.isFolder && 'text-foreground/80 border-transparent bg-transparent',
      )}
    >
      {url ? (
        <img
          src={url}
          alt=""
          className="size-full object-cover"
          decoding="async"
          loading="lazy"
          onError={(e) => {
            // Fall back to the icon if the thumbnail proxy 404s.
            (e.currentTarget as HTMLImageElement).style.display = 'none';
          }}
        />
      ) : (
        <Icon className="size-4" aria-hidden strokeWidth={1.75} />
      )}
    </span>
  );
}

interface SortHeaderProps {
  label: string;
  active: boolean;
  dir: SortDir;
  align?: 'left' | 'right';
  onSort: () => void;
}

function SortHeader({
  label,
  active,
  dir,
  align = 'left',
  onSort,
}: SortHeaderProps) {
  return (
    <button
      type="button"
      onClick={onSort}
      className={cn(
        'hover:text-foreground inline-flex items-center gap-1 text-xs font-medium tracking-wide uppercase',
        active && 'text-foreground',
        align === 'right' && 'justify-end',
      )}
    >
      <span>{label}</span>
      {active ? (
        dir === 'asc' ? (
          <ArrowUp className="size-3" aria-hidden />
        ) : (
          <ArrowDown className="size-3" aria-hidden />
        )
      ) : null}
    </button>
  );
}

export function CloudStorageListView({
  items,
  connectionId,
  selectedIds,
  onOpen,
  onPreview,
  onToggleSelect,
  onLoadMore,
}: CloudStorageListViewProps) {
  const { t } = useLanguage();
  const selectedSet = new Set(selectedIds);
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const sorted = useMemo(() => {
    const folders = items.filter((i) => i.isFolder);
    const files = items.filter((i) => !i.isFolder);
    const factor = sortDir === 'asc' ? 1 : -1;
    const compare = (a: CloudFile, b: CloudFile) => {
      switch (sortKey) {
        case 'modified':
          return (timestamp(a.modifiedAt) - timestamp(b.modifiedAt)) * factor;
        case 'size':
          return ((a.size ?? 0) - (b.size ?? 0)) * factor;
        case 'name':
        default:
          return (
            (a.name ?? '').localeCompare(b.name ?? '', undefined, {
              numeric: true,
              sensitivity: 'base',
            }) * factor
          );
      }
    };
    folders.sort(compare);
    files.sort(compare);
    // Folders pinned on top regardless of sort direction — matches every
    // mainstream file manager. Sort within each group.
    return [...folders, ...files];
  }, [items, sortKey, sortDir]);

  function toggleSort(next: SortKey) {
    if (next === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(next);
      setSortDir(next === 'name' ? 'asc' : 'desc');
    }
  }

  if (items.length === 0) {
    return (
      <div className="text-muted-foreground flex min-h-40 items-center justify-center text-sm">
        {t.cloudStorage.noMediaResults}
      </div>
    );
  }

  return (
    <div className="size-full">
      <table className="w-full border-collapse text-sm">
        <thead className="bg-background sticky top-0 z-10 text-left">
          <tr className="text-muted-foreground border-border border-b">
            <th className="w-8 px-2 py-2"></th>
            <th className="w-10 px-2 py-2"></th>
            <th className="px-2 py-2">
              <SortHeader
                label={t.cloudStorage.listColumnName}
                active={sortKey === 'name'}
                dir={sortDir}
                onSort={() => toggleSort('name')}
              />
            </th>
            <th className="hidden w-32 px-2 py-2 sm:table-cell">
              <SortHeader
                label={t.cloudStorage.listColumnModified}
                active={sortKey === 'modified'}
                dir={sortDir}
                onSort={() => toggleSort('modified')}
              />
            </th>
            <th className="hidden w-24 px-2 py-2 md:table-cell">
              <SortHeader
                label={t.cloudStorage.listColumnSize}
                active={sortKey === 'size'}
                dir={sortDir}
                align="right"
                onSort={() => toggleSort('size')}
              />
            </th>
            <th className="text-muted-foreground hidden w-40 px-2 py-2 text-xs font-medium tracking-wide uppercase lg:table-cell">
              {t.cloudStorage.listColumnOwner}
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((item) => {
            const selected = selectedSet.has(item.id);
            return (
              <tr
                key={item.id}
                className={cn(
                  'border-border hover:bg-muted/40 cursor-pointer border-b',
                  selected && 'bg-primary/5',
                )}
                onClick={() => onOpen(item.id)}
                onDoubleClick={() => onPreview(item.id)}
              >
                <td
                  className="px-2 py-2"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!item.isFolder) onToggleSelect(item.id);
                  }}
                >
                  {item.isFolder ? null : (
                    <span
                      role="checkbox"
                      aria-checked={selected}
                      className={cn(
                        'border-border flex size-4 items-center justify-center rounded border',
                        selected &&
                          'border-primary bg-primary text-primary-foreground',
                      )}
                    >
                      {selected ? (
                        <Check className="size-3" aria-hidden />
                      ) : null}
                    </span>
                  )}
                </td>
                <td className="px-2 py-2">
                  <ItemThumb item={item} connectionId={connectionId} />
                </td>
                <td className="text-foreground min-w-0 px-2 py-2">
                  <span className="block truncate">{item.name}</span>
                </td>
                <td className="text-muted-foreground hidden px-2 py-2 text-xs whitespace-nowrap sm:table-cell">
                  {formatDate(item.modifiedAt)}
                </td>
                <td className="text-muted-foreground hidden px-2 py-2 text-right text-xs whitespace-nowrap md:table-cell">
                  {item.isFolder ? '—' : formatBytes(item.size ?? 0)}
                </td>
                <td className="text-muted-foreground hidden truncate px-2 py-2 text-xs lg:table-cell">
                  {(item as { owner?: { name?: string; email?: string } }).owner
                    ?.name ??
                    (item as { owner?: { name?: string; email?: string } })
                      .owner?.email ??
                    '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {onLoadMore ? (
        <div className="flex justify-center p-3">
          <button
            type="button"
            onClick={onLoadMore}
            className="border-border hover:bg-muted rounded-md border px-3 py-1.5 text-xs"
          >
            {t.cloudStorage.loadMore}
          </button>
        </div>
      ) : null}
    </div>
  );
}
