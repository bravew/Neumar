import { useMemo, useRef } from 'react';

import { useVirtualizer } from '@tanstack/react-virtual';

import type { DesignFileEntry } from '@/shared/types/design-mode';

import type { FileWorkspaceGroupId } from './file-workspace-utils';
import { FileWorkspaceRow } from './FileWorkspaceRow';
import type { useFileWorkspaceController } from './useFileWorkspaceController';

type Workspace = ReturnType<typeof useFileWorkspaceController>;
type ListItem =
  | { kind: 'directory'; key: string; file: DesignFileEntry }
  | { kind: 'header'; key: string; groupId: FileWorkspaceGroupId }
  | { kind: 'file'; key: string; file: DesignFileEntry };

const VIRTUALIZE_FILE_THRESHOLD = 100;

export function buildFileTreeItems(workspace: Workspace): ListItem[] {
  const items: ListItem[] = workspace.visibleDirectories.map((file) => ({
    kind: 'directory',
    key: `directory:${file.path}`,
    file,
  }));
  for (const group of workspace.groupedFiles) {
    if (workspace.groupBy !== 'none' && group.files.length > 0) {
      items.push({
        kind: 'header',
        key: `header:${group.id}`,
        groupId: group.id,
      });
    }
    items.push(
      ...group.files.map((file) => ({
        kind: 'file' as const,
        key: `file:${file.path}`,
        file,
      })),
    );
  }
  return items;
}

interface FileTreeLabels {
  folder: string;
  rename: string;
  renameCommit: string;
  renameCancel: string;
  groupLabel: (groupId: FileWorkspaceGroupId) => string;
}

export function VirtualFileTreeList({
  workspace,
  labels,
}: {
  workspace: Workspace;
  labels: FileTreeLabels;
}) {
  const items = useMemo(() => buildFileTreeItems(workspace), [workspace]);
  if (items.length < VIRTUALIZE_FILE_THRESHOLD) {
    return (
      <div className="min-h-0 flex-1 space-y-1 overflow-auto">
        {items.map((item) => (
          <FileTreeItem
            key={item.key}
            item={item}
            workspace={workspace}
            labels={labels}
          />
        ))}
      </div>
    );
  }
  return (
    <VirtualFileTreeRows items={items} workspace={workspace} labels={labels} />
  );
}

function VirtualFileTreeRows({
  items,
  workspace,
  labels,
}: {
  items: ListItem[];
  workspace: Workspace;
  labels: FileTreeLabels;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    getItemKey: (index) => items[index]?.key ?? index,
    estimateSize: (index) => (items[index]?.kind === 'header' ? 24 : 34),
    overscan: 8,
    initialRect: { width: 288, height: 600 },
  });
  return (
    <div
      ref={scrollRef}
      className="min-h-0 flex-1 overflow-auto"
      data-testid="virtual-file-tree"
    >
      <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((virtualItem) => {
          const item = items[virtualItem.index];
          if (!item) return null;
          return (
            <div
              key={item.key}
              ref={virtualizer.measureElement}
              data-index={virtualItem.index}
              className="absolute inset-x-0 top-0"
              style={{ transform: `translateY(${virtualItem.start}px)` }}
            >
              <FileTreeItem item={item} workspace={workspace} labels={labels} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FileTreeItem({
  item,
  workspace,
  labels,
}: {
  item: ListItem;
  workspace: Workspace;
  labels: FileTreeLabels;
}) {
  if (item.kind === 'header') {
    return (
      <p className="text-muted-foreground px-2 py-1 text-[11px] font-medium uppercase">
        {labels.groupLabel(item.groupId)}
      </p>
    );
  }
  const { file } = item;
  const directory = item.kind === 'directory';
  return (
    <FileWorkspaceRow
      file={file}
      active={!directory && workspace.activePath === file.path}
      selected={!directory && workspace.selectedPaths.has(file.path)}
      folderLabel={labels.folder}
      renameLabel={labels.rename}
      renameCommitLabel={labels.renameCommit}
      renameCancelLabel={labels.renameCancel}
      onRename={(from, to) => void workspace.renameFile(from, to)}
      onOpen={(event) => {
        if (directory) {
          workspace.openDirectory(file.path);
          return;
        }
        if (event.metaKey || event.ctrlKey || event.shiftKey) {
          workspace.toggleSelection(file.path, event.shiftKey);
          return;
        }
        workspace.openFile(file.path);
      }}
      onToggle={(event) => {
        if (!directory) workspace.toggleSelection(file.path, event.shiftKey);
      }}
    />
  );
}
