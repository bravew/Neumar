import type { ReactNode } from 'react';

import {
  Navigate,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom';

import { ArrowLeft } from 'lucide-react';

import { LeftSidebar, SidebarProvider } from '@/components/layout';
import { AgentPanel } from '@/components/video/AgentPanel';
import { InputsPanel } from '@/components/video/InputsPanel';
import { PreviewPanel } from '@/components/video/PreviewPanel';
import { ProjectEditor } from '@/components/video/ProjectEditor';
import { ProviderPanel } from '@/components/video/ProviderPanel';
import { SourcesPanel } from '@/components/video/SourcesPanel';
import { StoryboardPanel } from '@/components/video/StoryboardPanel';
import { DEFAULT_MODES_SETTINGS, useSetting } from '@/shared/db/settings';
import { useVideoProject } from '@/shared/hooks/useVideoProject';
import { useLanguage } from '@/shared/providers/language-provider';

export function VideoProjectRoute() {
  const { t } = useLanguage();
  const { projectId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const {
    project,
    loading,
    error,
    patchProject,
    uploadAssets,
    uploadReferenceImages,
    attachAssetPaths,
    deleteAsset,
    regenerateAssetProxy,
    deleteAssetProxy,
    importSourcePath,
    importSourceFile,
    importCaptureFiles,
    importCapturePaths,
    alignCapture,
    queueYtDlpImport,
    analyzeSource,
    createCutPlan,
    generateStoryboard,
    updateStoryboard,
    approveStoryboard,
    createRenderPlan,
    updateRenderPlanSceneModel,
    updateTimeline,
    applyAgentTool,
    undoAgentJournalEntry,
    redoAgentJournalEntry,
    rejectStoryboard,
    replanScene,
    materializeSceneAsset,
    regenerateScene,
    generateMusic,
    generateNarration,
    setRenderCaptionMode,
    grantLocalFolder,
    addLinkedSource,
    syncLinkedSource,
    removeLinkedSource,
    listLinkedAssets,
    listLinkedFolderChildren,
    listRecentLinkedAssets,
    listFavoriteLinkedAssets,
    setLinkedAssetFavorite,
    markLinkedAssetOpened,
    searchLinkedAssets,
    attachLinkedAsset,
    attachCatalogAsset,
    hydrateProjectAsset,
    cancelProjectAssetHydration,
    setFrameNativeEnhancement,
    applyTemplate,
    renderProject,
    queueRenderProject,
    queueEditorHandoff,
    getEditorHandoffJob,
    cancelRender,
    setProject,
  } = useVideoProject(projectId);
  const modeSettings = {
    ...DEFAULT_MODES_SETTINGS,
    ...useSetting('modes'),
  };

  if (!modeSettings.videoEnabled) return <Navigate to="/" replace />;
  if (!projectId) return <Navigate to="/video" replace />;
  const legacyEditor = searchParams.get('legacy') === '1';

  return (
    <SidebarProvider defaultLeftOpen={false}>
      <VideoProjectShell>
        {loading || error || !project || legacyEditor ? (
          <header className="border-border flex items-center gap-3 border-b px-5 py-3">
            <button
              type="button"
              className="text-muted-foreground hover:bg-accent hover:text-foreground flex size-8 items-center justify-center rounded-md"
              aria-label={t.video.project.back}
              onClick={() => navigate('/video')}
            >
              <ArrowLeft className="size-4" />
            </button>
            <div className="min-w-0">
              <h1 className="text-foreground truncate text-sm font-semibold">
                {project?.name ?? t.video.project.title}
              </h1>
              <p className="text-muted-foreground text-xs">
                {project
                  ? t.video.project.updatedAt.replace(
                      '{date}',
                      new Date(project.updatedAt).toLocaleString(),
                    )
                  : t.video.project.loading}
              </p>
            </div>
          </header>
        ) : null}
        {loading ? (
          <div className="text-muted-foreground flex flex-1 items-center justify-center text-sm">
            {t.video.project.loading}
          </div>
        ) : error || !project ? (
          <div className="text-destructive flex flex-1 items-center justify-center text-sm">
            {error ?? t.video.project.notFound}
          </div>
        ) : (
          <>
            {legacyEditor ? (
              <div className="grid min-h-0 flex-1 gap-4 overflow-auto p-4 lg:grid-cols-[minmax(260px,1fr)_minmax(320px,1.4fr)_minmax(260px,1fr)]">
                <div className="space-y-4">
                  <InputsPanel project={project} onPatch={patchProject} />
                  <SourcesPanel
                    project={project}
                    onImportPath={importSourcePath}
                    onImportFile={importSourceFile}
                    onImportUrl={queueYtDlpImport}
                    onAnalyze={analyzeSource}
                    onCreateCutPlan={createCutPlan}
                    actions={{
                      patchProject,
                      uploadAssets,
                      uploadReferenceImages,
                      attachAssetPaths,
                      deleteAsset,
                      regenerateAssetProxy,
                      deleteAssetProxy,
                      importSourcePath,
                      importSourceFile,
                      importCaptureFiles,
                      importCapturePaths,
                      alignCapture,
                      queueYtDlpImport,
                      analyzeSource,
                      createCutPlan,
                      generateStoryboard,
                      updateStoryboard,
                      approveStoryboard,
                      createRenderPlan,
                      updateRenderPlanSceneModel,
                      updateTimeline,
                      applyAgentTool,
                      undoAgentJournalEntry,
                      redoAgentJournalEntry,
                      rejectStoryboard,
                      replanScene,
                      materializeSceneAsset,
                      regenerateScene,
                      generateMusic,
                      generateNarration,
                      setRenderCaptionMode,
                      grantLocalFolder,
                      addLinkedSource,
                      syncLinkedSource,
                      removeLinkedSource,
                      listLinkedAssets,
                      listLinkedFolderChildren,
                      listRecentLinkedAssets,
                      listFavoriteLinkedAssets,
                      setLinkedAssetFavorite,
                      markLinkedAssetOpened,
                      searchLinkedAssets,
                      attachLinkedAsset,
                      attachCatalogAsset,
                      hydrateProjectAsset,
                      cancelProjectAssetHydration,
                      setFrameNativeEnhancement,
                      applyTemplate,
                      renderProject,
                      queueRenderProject,
                      queueEditorHandoff,
                      getEditorHandoffJob,
                      cancelRender,
                    }}
                  />
                  <ProviderPanel />
                </div>
                <div className="space-y-4">
                  <AgentPanel
                    project={project}
                    onGenerateStoryboard={generateStoryboard}
                  />
                  <StoryboardPanel
                    project={project}
                    onUpdateStoryboard={updateStoryboard}
                    onUpdateBudget={(capUsd) =>
                      patchProject({
                        budget: {
                          capUsd,
                          spentUsd: project.budget?.spentUsd ?? 0,
                        },
                      }).then(() => undefined)
                    }
                    onApprove={approveStoryboard}
                    onReject={rejectStoryboard}
                    onReplanScene={replanScene}
                  />
                </div>
                <PreviewPanel
                  project={project}
                  onRender={renderProject}
                  onCancel={cancelRender}
                />
              </div>
            ) : (
              <ProjectEditor
                project={project}
                setProject={setProject}
                onBack={() => navigate('/video')}
                actions={{
                  patchProject,
                  uploadAssets,
                  uploadReferenceImages,
                  attachAssetPaths,
                  deleteAsset,
                  regenerateAssetProxy,
                  deleteAssetProxy,
                  importSourcePath,
                  importSourceFile,
                  importCaptureFiles,
                  importCapturePaths,
                  alignCapture,
                  queueYtDlpImport,
                  analyzeSource,
                  createCutPlan,
                  generateStoryboard,
                  updateStoryboard,
                  approveStoryboard,
                  createRenderPlan,
                  updateRenderPlanSceneModel,
                  updateTimeline,
                  applyAgentTool,
                  undoAgentJournalEntry,
                  redoAgentJournalEntry,
                  rejectStoryboard,
                  replanScene,
                  materializeSceneAsset,
                  regenerateScene,
                  generateMusic,
                  generateNarration,
                  setRenderCaptionMode,
                  grantLocalFolder,
                  addLinkedSource,
                  syncLinkedSource,
                  removeLinkedSource,
                  listLinkedAssets,
                  listLinkedFolderChildren,
                  listRecentLinkedAssets,
                  listFavoriteLinkedAssets,
                  setLinkedAssetFavorite,
                  markLinkedAssetOpened,
                  searchLinkedAssets,
                  attachLinkedAsset,
                  attachCatalogAsset,
                  hydrateProjectAsset,
                  cancelProjectAssetHydration,
                  setFrameNativeEnhancement,
                  applyTemplate,
                  renderProject,
                  queueRenderProject,
                  queueEditorHandoff,
                  getEditorHandoffJob,
                  cancelRender,
                }}
              />
            )}
          </>
        )}
      </VideoProjectShell>
    </SidebarProvider>
  );
}

function VideoProjectShell({ children }: { children: ReactNode }) {
  return (
    <div className="bg-sidebar flex h-screen overflow-hidden">
      <LeftSidebar tasks={[]} />
      <main className="bg-background my-2 mr-2 flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl shadow-sm">
        {children}
      </main>
    </div>
  );
}
