import { useEffect, useMemo, useState } from 'react';

import { PanelLeft, PanelLeftClose } from 'lucide-react';

import { useLanguage } from '@/shared/providers/language-provider';
import type {
  DesignOutput,
  DesignProject,
  DesignSurface,
} from '@/shared/types/design-mode';

import { AssetGallery } from './AssetGallery';
import { isRetainablePreviewPath } from './file-viewer-utils';
import { FileTabStrip } from './FileTabStrip';
import { FileTreePanel } from './FileTreePanel';
import { FileViewer } from './FileViewer';
import { QuickFileSwitcher } from './QuickFileSwitcher';
import { useFileWorkspaceController } from './useFileWorkspaceController';

const RETAINED_PREVIEW_CAP = 3;

export function FileWorkspace({
  projectId,
  project,
  surface,
  outputs,
  onProjectChange,
  onSendToChat,
  reloadSignal,
}: {
  projectId: string;
  project?: DesignProject;
  surface: DesignSurface;
  outputs: DesignOutput[];
  onProjectChange?: (project: DesignProject) => void;
  onSendToChat?: (prompt: string) => void;
  reloadSignal?: number;
}) {
  const { t } = useLanguage();
  const workspace = useFileWorkspaceController({
    projectId,
    project,
    outputs,
    onProjectChange,
    reloadSignal,
  });
  const [retainedPreviewPaths, setRetainedPreviewPaths] = useState<string[]>(
    [],
  );
  // The file tree is a collapsible drawer, not a permanent middle column — the
  // creations grid is the default "Design Files" view (Open Design parity).
  // Default collapsed for a clean 2-pane chat ‖ canvas layout.
  const [filesPanelOpen, setFilesPanelOpen] = useState(false);
  // The creations grid is an explicit "Design Files" tab overlay, not a
  // permanent header above the viewer (which ate ~half the pane). The
  // controller auto-opens the latest artifact, so this is decoupled from
  // activePath: opening a file dismisses the gallery; the home tab shows it.
  const [galleryOpen, setGalleryOpen] = useState(false);
  const openFileFromWorkspace = workspace.openFile;
  const openFile = (path: string | null) => {
    setGalleryOpen(false);
    openFileFromWorkspace(path);
  };
  const existingFilePaths = useMemo(
    () => new Set(workspace.sortedFiles.map((file) => file.path)),
    [workspace.sortedFiles],
  );
  const hasVisibleFiles =
    workspace.visibleDirectories.length > 0 ||
    workspace.groupedFiles.some((group) => group.files.length > 0);

  useEffect(() => {
    setRetainedPreviewPaths((current) =>
      current.filter((path) => existingFilePaths.has(path)),
    );
  }, [existingFilePaths]);

  useEffect(() => {
    const path = workspace.activePath;
    if (!isRetainablePreviewPath(path)) return;
    const previewPath = path;
    setRetainedPreviewPaths((current) =>
      [previewPath, ...current.filter((item) => item !== previewPath)].slice(
        0,
        RETAINED_PREVIEW_CAP,
      ),
    );
  }, [workspace.activePath]);

  const activePath = workspace.activePath;
  const showGallery = galleryOpen || !activePath;
  const activePathRetained = Boolean(
    activePath && retainedPreviewPaths.includes(activePath),
  );
  // Render every viewer from a single keyed list so React preserves (rather
  // than remounts) retained previews when a path moves between visible and
  // hidden. Splitting active vs. retained across two sibling expressions made
  // the retained viewer migrate child slots on each navigation, forcing a
  // remount + refetch and defeating the "hide, don't unmount" retention.
  const viewerPaths = activePathRetained
    ? retainedPreviewPaths
    : [activePath, ...retainedPreviewPaths];
  const renderViewer = (viewerPath: string | null, visible: boolean) => (
    <div
      key={viewerPath ? `${projectId}:${viewerPath}` : `${projectId}:home`}
      className={visible ? 'h-full min-h-0' : 'hidden h-full min-h-0'}
      aria-hidden={!visible}
    >
      <FileViewer
        projectId={projectId}
        surface={surface}
        path={viewerPath}
        reloadKey={outputs.length}
        projectFiles={workspace.files}
        onDirtySketchChange={visible ? workspace.setDirtySketch : undefined}
        onSendToChat={visible ? onSendToChat : undefined}
      />
    </div>
  );

  return (
    <section className="bg-background flex min-h-0 min-w-0 flex-1">
      {filesPanelOpen && (
        <FileTreePanel
          workspace={{ ...workspace, openFile }}
          hasVisibleFiles={hasVisibleFiles}
        />
      )}
      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-stretch">
          <button
            type="button"
            className="border-border hover:bg-accent text-muted-foreground hover:text-foreground hidden shrink-0 items-center border-r border-b px-2 lg:flex"
            aria-label={t.design.fileTreeToggle}
            aria-pressed={filesPanelOpen}
            title={t.design.fileTreeToggle}
            onClick={() => setFilesPanelOpen((open) => !open)}
          >
            {filesPanelOpen ? (
              <PanelLeftClose className="size-4" />
            ) : (
              <PanelLeft className="size-4" />
            )}
          </button>
          <div className="min-w-0 flex-1">
            <FileTabStrip
              homeLabel={t.design.designFiles}
              tabs={workspace.fileTabs}
              activePath={workspace.activePath}
              homeActive={galleryOpen}
              onHome={() => setGalleryOpen(true)}
              onSelect={openFile}
              onReorder={workspace.reorderFileTabs}
            />
          </div>
        </div>
        <div className="min-h-0 flex-1">
          {/* The viewer fills the pane (Open Design parity). The creations grid
              is an explicit "Design Files" tab overlay, not a permanent header
              that ate ~half the pane. Viewers stay mounted (retained-preview
              cache) but hidden while the gallery overlay is open. */}
          <div className={showGallery ? 'hidden' : 'h-full min-h-0'}>
            {viewerPaths.map((path) => renderViewer(path, path === activePath))}
          </div>
          {showGallery && (
            <div className="h-full overflow-auto p-3">
              <AssetGallery
                projectId={projectId}
                assets={outputs}
                onOpen={openFile}
                onProjectChange={onProjectChange}
              />
            </div>
          )}
        </div>
      </main>
      <QuickFileSwitcher
        open={workspace.quickSwitcherOpen}
        onOpenChange={workspace.setQuickSwitcherOpen}
        files={workspace.sortedFiles}
        onOpenFile={openFile}
      />
    </section>
  );
}
