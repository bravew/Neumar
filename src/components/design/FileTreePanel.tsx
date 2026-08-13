import { ChevronLeft, FolderOpen, Trash2, X } from 'lucide-react';

import { useLanguage } from '@/shared/providers/language-provider';

import { type FileWorkspaceGroupId } from './file-workspace-utils';
import { FileWorkspaceControls } from './FileWorkspaceControls';
import { type useFileWorkspaceController } from './useFileWorkspaceController';
import { VirtualFileTreeList } from './VirtualFileTreeList';

type Workspace = ReturnType<typeof useFileWorkspaceController>;

/**
 * The DesignMode file tree — a collapsible drawer (not a permanent middle
 * column). The creations grid is the default "Design Files" view; this panel
 * is opened on demand for folder navigation, sort/filter/group, rename, and
 * multi-select delete. Extracted from FileWorkspace to keep both under the
 * 350-line component cap.
 */
export function FileTreePanel({
  workspace,
  hasVisibleFiles,
}: {
  workspace: Workspace;
  hasVisibleFiles: boolean;
}) {
  const { t } = useLanguage();
  return (
    <aside className="border-border hidden w-72 shrink-0 flex-col border-r p-3 lg:flex">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{t.design.designFiles}</h2>
        {workspace.selectedFilePaths.length > 0 ? (
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="hover:bg-accent rounded p-1"
              aria-label={t.design.clearFileSelection}
              onClick={() => workspace.setSelectedPaths(new Set())}
            >
              <X className="size-4" />
            </button>
            <button
              type="button"
              className="text-destructive hover:bg-destructive/10 rounded p-1 disabled:opacity-50"
              aria-label={t.design.deleteSelectedFiles.replace(
                '{count}',
                String(workspace.selectedFilePaths.length),
              )}
              disabled={workspace.deleting}
              onClick={() => void workspace.deleteSelectedFiles()}
            >
              <Trash2 className="size-4" />
            </button>
          </div>
        ) : (
          <FolderOpen className="text-muted-foreground size-4" />
        )}
      </div>
      {workspace.deleteError && (
        <p className="text-destructive border-destructive/30 mb-2 rounded border p-2 text-xs">
          {workspace.deleteError}
        </p>
      )}
      <FileWorkspaceControls
        sortBy={workspace.sortBy}
        sortDirection={workspace.sortDirection}
        groupBy={workspace.groupBy}
        kindFilter={workspace.kindFilter}
        labels={{
          filterByKind: t.design.fileFilterByKind,
          filterAll: t.design.fileFilterAll,
          filterHtml: t.design.fileFilterHtml,
          filterImage: t.design.fileFilterImage,
          filterSvg: t.design.fileFilterSvg,
          filterPdf: t.design.fileFilterPdf,
          filterAudio: t.design.fileFilterAudio,
          filterVideo: t.design.fileFilterVideo,
          sortBy: t.design.fileSortBy,
          sortName: t.design.fileSortName,
          sortKind: t.design.fileSortKind,
          sortModified: t.design.fileSortModified,
          groupBy: t.design.fileGroupBy,
          groupNone: t.design.fileGroupNone,
          groupKind: t.design.fileGroupKind,
          groupModified: t.design.fileGroupModified,
          ascending: t.design.fileSortAscending,
          descending: t.design.fileSortDescending,
        }}
        onSortByChange={workspace.updateSortBy}
        onSortDirectionChange={workspace.updateSortDirection}
        onGroupByChange={workspace.updateGroupBy}
        onKindFilterChange={workspace.updateKindFilter}
      />
      {workspace.currentDirectory && (
        <div className="border-border mb-3 rounded-md border p-2">
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs"
            aria-label={t.design.files.back}
            onClick={workspace.goUpDirectory}
          >
            <ChevronLeft className="size-3.5" />
            {t.design.files.back}
          </button>
          <p
            className="mt-1 truncate text-xs font-medium"
            title={workspace.currentDirectory}
          >
            {t.design.files.folder.replace(
              '{name}',
              workspace.currentDirectoryLabel,
            )}
          </p>
        </div>
      )}
      {workspace.fileListError && (
        <div className="border-destructive/30 mb-3 rounded-md border p-2">
          <p className="text-destructive text-xs">
            {t.design.files.readFailed}
          </p>
          <button
            type="button"
            className="text-primary mt-2 text-xs font-medium hover:underline"
            onClick={workspace.retryFileList}
          >
            {t.design.files.retry}
          </button>
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col">
        {workspace.fileListError ? null : !hasVisibleFiles ? (
          <p className="text-muted-foreground px-2 text-sm">
            {workspace.currentDirectory
              ? t.design.files.emptyFolder
              : t.design.noMatches}
          </p>
        ) : (
          <VirtualFileTreeList
            workspace={workspace}
            labels={{
              folder: t.design.files.folder,
              rename: t.design.renameFile,
              renameCommit: t.design.renameFileCommit,
              renameCancel: t.design.renameFileCancel,
              groupLabel: (groupId) => fileGroupLabel(groupId, t.design),
            }}
          />
        )}
      </div>
    </aside>
  );
}

function fileGroupLabel(
  id: FileWorkspaceGroupId,
  labels: {
    fileGroupAll: string;
    fileGroupHtml: string;
    fileGroupText: string;
    fileGroupImage: string;
    fileGroupVideo: string;
    fileGroupAudio: string;
    fileGroupOther: string;
    fileGroupToday: string;
    fileGroupWeek: string;
    fileGroupOlder: string;
    fileGroupUndated: string;
  },
) {
  const map: Record<FileWorkspaceGroupId, string> = {
    all: labels.fileGroupAll,
    html: labels.fileGroupHtml,
    text: labels.fileGroupText,
    image: labels.fileGroupImage,
    video: labels.fileGroupVideo,
    audio: labels.fileGroupAudio,
    other: labels.fileGroupOther,
    today: labels.fileGroupToday,
    week: labels.fileGroupWeek,
    older: labels.fileGroupOlder,
    undated: labels.fileGroupUndated,
  };
  return map[id] ?? id;
}
