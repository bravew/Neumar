import {
  type CSSProperties,
  useCallback,
  useMemo,
  useRef,
  useState,
} from 'react';

import { useVirtualizer } from '@tanstack/react-virtual';
import {
  ChevronDown,
  ChevronRight,
  Database,
  File,
  Folder,
  Paperclip,
} from 'lucide-react';

import { cn } from '@/shared/lib/utils';
import type {
  VideoLinkedAssetKind,
  VideoLinkedFolderChild,
  VideoLinkedSource,
} from '@/shared/types/video';

import type { VideoProjectEditorActions } from '../editorTypes';
import { writeLinkedAssetDrag } from '../linkedAssetDrag';

interface AssetRailFolderTreeProps {
  sources: VideoLinkedSource[];
  actions: VideoProjectEditorActions;
  kind?: Exclude<VideoLinkedAssetKind, 'other'>;
  title: string;
  empty: string;
  attachLabel: string;
  syncLabel: string;
  onAttach: (assetId: string) => void;
}

type TreeRow =
  | { type: 'source'; source: VideoLinkedSource; depth: number; key: string }
  | {
      type: 'entry';
      source: VideoLinkedSource;
      entry: VideoLinkedFolderChild;
      depth: number;
      key: string;
    };

interface LoadedChildren {
  entries: VideoLinkedFolderChild[];
  loading: boolean;
  error?: string;
}

export function AssetRailFolderTree({
  sources,
  actions,
  kind,
  title,
  empty,
  attachLabel,
  syncLabel,
  onAttach,
}: AssetRailFolderTreeProps) {
  const parentRef = useRef<HTMLDivElement | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [children, setChildren] = useState<Record<string, LoadedChildren>>({});

  const loadChildren = useCallback(
    async (source: VideoLinkedSource, path?: string) => {
      const key = treeKey(source.id, path);
      setChildren((prev) => ({
        ...prev,
        [key]: { entries: prev[key]?.entries ?? [], loading: true },
      }));
      try {
        const result = await actions.listLinkedFolderChildren({
          sourceId: source.id,
          path,
          kinds: kind ? [kind] : undefined,
          limit: 100,
        });
        setChildren((prev) => ({
          ...prev,
          [key]: { entries: result.entries, loading: false },
        }));
      } catch (error) {
        setChildren((prev) => ({
          ...prev,
          [key]: {
            entries: prev[key]?.entries ?? [],
            loading: false,
            error: error instanceof Error ? error.message : String(error),
          },
        }));
      }
    },
    [actions, kind],
  );

  const toggle = useCallback(
    (source: VideoLinkedSource, path?: string) => {
      const key = treeKey(source.id, path);
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
      if (!children[key]) void loadChildren(source, path);
    },
    [children, loadChildren],
  );

  const rows = useMemo(() => {
    const next: TreeRow[] = [];
    for (const source of sources) {
      const key = treeKey(source.id);
      next.push({ type: 'source', source, depth: 0, key });
      if (expanded.has(key)) {
        appendRows(next, source, children, expanded, 1);
      }
    }
    return next;
  }, [children, expanded, sources]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 34,
    overscan: 10,
  });

  return (
    <section className="min-h-0 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-foreground text-xs font-semibold">{title}</h3>
        <span className="text-muted-foreground text-[11px]">
          {sources.length}
        </span>
      </div>
      {sources.length === 0 ? (
        <p className="text-muted-foreground text-xs">{empty}</p>
      ) : (
        <div ref={parentRef} className="h-72 overflow-auto pr-1">
          <div
            className="relative"
            style={{ height: virtualizer.getTotalSize() }}
          >
            {virtualizer.getVirtualItems().map((row) => {
              const item = rows[row.index];
              if (!item) return null;
              return (
                <TreeRowView
                  key={item.key}
                  row={item}
                  expanded={expanded.has(item.key)}
                  loaded={children[item.key]}
                  attachLabel={attachLabel}
                  syncLabel={syncLabel}
                  onToggle={toggle}
                  onSync={(sourceId) => void actions.syncLinkedSource(sourceId)}
                  onAttach={onAttach}
                  style={{
                    transform: `translateY(${row.start}px)`,
                    height: row.size,
                  }}
                />
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

function appendRows(
  rows: TreeRow[],
  source: VideoLinkedSource,
  children: Record<string, LoadedChildren>,
  expanded: Set<string>,
  depth: number,
  path?: string,
) {
  for (const entry of children[treeKey(source.id, path)]?.entries ?? []) {
    const key = treeKey(source.id, entry.id);
    rows.push({ type: 'entry', source, entry, depth, key });
    if (entry.isFolder && expanded.has(key)) {
      appendRows(rows, source, children, expanded, depth + 1, entry.id);
    }
  }
}

function TreeRowView({
  row,
  expanded,
  loaded,
  attachLabel,
  syncLabel,
  onToggle,
  onSync,
  onAttach,
  style,
}: {
  row: TreeRow;
  expanded: boolean;
  loaded?: LoadedChildren;
  attachLabel: string;
  syncLabel: string;
  onToggle: (source: VideoLinkedSource, path?: string) => void;
  onSync: (sourceId: string) => void;
  onAttach: (assetId: string) => void;
  style: CSSProperties;
}) {
  const isFolder = row.type === 'source' || row.entry.isFolder;
  const label = row.type === 'source' ? row.source.displayName : row.entry.name;
  const Icon = row.type === 'source' ? Database : isFolder ? Folder : File;
  const assetId = row.type === 'entry' ? row.entry.assetId : undefined;
  const assetKind = row.type === 'entry' ? row.entry.kind : undefined;

  return (
    <div className="absolute inset-x-0 top-0 py-0.5" style={style}>
      <div
        className={cn(
          'hover:bg-accent/60 flex h-full items-center gap-1 rounded-md px-1 text-xs',
          row.type === 'source' ? 'text-foreground' : 'text-muted-foreground',
        )}
        style={{ paddingLeft: 4 + row.depth * 14 }}
        draggable={Boolean(assetId && assetKind && assetKind !== 'other')}
        onDragStart={(event) => {
          if (!assetId || !assetKind || assetKind === 'other') return;
          writeLinkedAssetDrag(event.dataTransfer, {
            assetId,
            kind: assetKind,
            name: label,
          });
        }}
      >
        {isFolder ? (
          <button
            type="button"
            className="hover:bg-background rounded p-0.5"
            aria-expanded={expanded}
            onClick={() =>
              onToggle(
                row.source,
                row.type === 'entry' ? row.entry.id : undefined,
              )
            }
          >
            {expanded ? (
              <ChevronDown className="size-3.5" />
            ) : (
              <ChevronRight className="size-3.5" />
            )}
          </button>
        ) : (
          <span className="w-[18px]" />
        )}
        <Icon className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate" title={label}>
          {label}
        </span>
        {loaded?.loading ? (
          <span className="text-muted-foreground text-[10px]">...</span>
        ) : null}
        {row.type === 'source' ? (
          <button
            type="button"
            className="hover:bg-background rounded px-1 py-0.5 text-[10px]"
            onClick={() => onSync(row.source.id)}
          >
            {syncLabel}
          </button>
        ) : null}
        {assetId ? (
          <button
            type="button"
            className="hover:bg-background rounded p-1"
            aria-label={attachLabel}
            onClick={() => onAttach(assetId)}
          >
            <Paperclip className="size-3" />
          </button>
        ) : null}
      </div>
      {loaded?.error ? (
        <p className="text-destructive truncate px-2 text-[10px]">
          {loaded.error}
        </p>
      ) : null}
    </div>
  );
}

function treeKey(sourceId: string, path?: string): string {
  return `${sourceId}:${path ?? ''}`;
}
