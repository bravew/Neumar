import { type ReactNode, useMemo, useState } from 'react';

import { ChevronRight, Folder } from 'lucide-react';

import { lastPathSegment } from '@/components/video/LinkedSourcesPanel';
import { cn } from '@/shared/lib/utils';
import type { VideoProject } from '@/shared/types/video';

type ProjectAsset = VideoProject['assets'][number];

export interface AssetFolderGroup {
  key: string;
  label: string;
  assets: ProjectAsset[];
}

/**
 * Folder-added local media (`origin: 'external'`) keeps its real filesystem
 * path, so the source folder is derivable with no schema change — assets
 * uploaded/attached from the catalog have no filesystem path and stay
 * ungrouped until attach-time provenance carries a folder label.
 */
export function folderKeyForAsset(asset: ProjectAsset): string | null {
  if (asset.origin !== 'external') return null;
  const idx = Math.max(
    asset.path.lastIndexOf('/'),
    asset.path.lastIndexOf('\\'),
  );
  if (idx <= 0) return null;
  return asset.path.slice(0, idx);
}

// Groups assets that share a source folder, preserving first-seen order.
// Assets with no derivable folder (catalog/managed origin, or a root-level
// external file) fall through to `ungrouped` and render exactly as before —
// projects with no folder-sourced assets see zero layout change.
export function useAssetFolderGroups(assets: ProjectAsset[]): {
  folders: AssetFolderGroup[];
  ungrouped: ProjectAsset[];
} {
  return useMemo(() => {
    const byKey = new Map<string, AssetFolderGroup>();
    const ungrouped: ProjectAsset[] = [];
    for (const asset of assets) {
      const key = folderKeyForAsset(asset);
      if (!key) {
        ungrouped.push(asset);
        continue;
      }
      const existing = byKey.get(key);
      if (existing) {
        existing.assets.push(asset);
      } else {
        byKey.set(key, { key, label: lastPathSegment(key), assets: [asset] });
      }
    }
    return { folders: [...byKey.values()], ungrouped };
  }, [assets]);
}

export function useCollapsedFolders(): {
  collapsedFolderKeys: Set<string>;
  toggleFolder: (key: string) => void;
} {
  const [collapsedFolderKeys, setCollapsedFolderKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const toggleFolder = (key: string) => {
    setCollapsedFolderKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };
  return { collapsedFolderKeys, toggleFolder };
}

interface ProjectAssetFolderSectionProps {
  group: AssetFolderGroup;
  collapsed: boolean;
  onToggle: () => void;
  renderAsset: (asset: ProjectAsset) => ReactNode;
}

export function ProjectAssetFolderSection({
  group,
  collapsed,
  onToggle,
  renderAsset,
}: ProjectAssetFolderSectionProps) {
  return (
    <div className="border-border/60 rounded-md border">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        className="hover:bg-muted/50 flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-[11px] font-medium"
      >
        <ChevronRight
          className={cn(
            'size-3 shrink-0 transition-transform',
            !collapsed && 'rotate-90',
          )}
          aria-hidden
        />
        <Folder className="text-muted-foreground size-3 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1 truncate">{group.label}</span>
        <span className="text-muted-foreground shrink-0 tabular-nums">
          {group.assets.length}
        </span>
      </button>
      {!collapsed ? (
        <div className="space-y-1.5 px-2 pt-0.5 pb-1.5">
          {group.assets.map(renderAsset)}
        </div>
      ) : null}
    </div>
  );
}
