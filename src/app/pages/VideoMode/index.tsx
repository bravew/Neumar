import { useCallback, useEffect, useState } from 'react';

import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';

import { Clapperboard, FileCode2, SlidersHorizontal } from 'lucide-react';
import { toast } from 'sonner';

import { CreativeIntentEntry } from '@/components/creative/CreativeIntentEntry';
import { LeftSidebar, SidebarProvider } from '@/components/layout';
import { ActivePluginChip } from '@/components/plugins/ActivePluginChip';
import {
  NewVideoProjectForm,
  type NewVideoProjectDefaults,
} from '@/components/video/NewVideoProjectForm';
import { openVideoProjectFolder } from '@/components/video/openVideoProjectFolder';
import { VideoFolderCard } from '@/components/video/VideoFolderCard';
import type { CreativeIntentId } from '@/shared/creative-workflow';
import { DEFAULT_MODES_SETTINGS, useSetting } from '@/shared/db/settings';
import { usePluginLaunch } from '@/shared/hooks/usePluginLaunch';
import {
  createVideoProject,
  deleteVideoProject,
  renameVideoProject,
  useVideoProjects,
} from '@/shared/hooks/useVideoProject';
import { useLanguage } from '@/shared/providers/language-provider';
import type { VideoProject, VideoProjectListItem } from '@/shared/types/video';

import { launchVideoPlugin } from './launchVideoPlugin';
import {
  DeleteProjectDialog,
  RenameProjectDialog,
} from './VideoProjectEntryDialogs';

export function VideoModeRoute() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { projects, loading, error, setProjects } = useVideoProjects();
  const modeSettings = {
    ...DEFAULT_MODES_SETTINGS,
    ...useSetting('modes'),
  };
  const [renameTarget, setRenameTarget] = useState<VideoProjectListItem | null>(
    null,
  );
  const [renameValue, setRenameValue] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<VideoProjectListItem | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [newProjectDefaults, setNewProjectDefaults] = useState<
    NewVideoProjectDefaults | undefined
  >(undefined);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [selectedIntent, setSelectedIntent] =
    useState<CreativeIntentId>('video');
  const [intentPrompt, setIntentPrompt] = useState('');
  const [searchParams, setSearchParams] = useSearchParams();

  // Arriving via a plugin "Use" starts a new video project seeded with the
  // plugin's example query and opens it — not just the gallery.
  usePluginLaunch(
    useCallback(
      (active) =>
        launchVideoPlugin(active, {
          navigate,
          defaultProjectName: t.video.entry.defaultProjectName,
          onError: (message) =>
            toast.error(
              t.video.entry.newProjectDialog.createFailed.replace(
                '{message}',
                message,
              ),
            ),
        }),
      [navigate, t],
    ),
    modeSettings.videoEnabled,
  );

  useEffect(() => {
    if (searchParams.get('new') === '1') {
      // The sidebar "New video project" action lands here. Surface the inline
      // creation form (Configure) instead of a modal, seeding any routed
      // prompt. A new object reference each time re-seeds the form.
      const prompt = searchParams.get('prompt') ?? '';
      setNewProjectDefaults(prompt ? { prompt } : {});
      setAdvancedOpen(true);
      const next = new URLSearchParams(searchParams);
      next.delete('new');
      next.delete('prompt');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  if (!modeSettings.videoEnabled) return <Navigate to="/" replace />;

  const handleProjectCreated = (
    project: VideoProject,
    options: { html?: boolean } = {},
  ) => {
    setProjects((prev) => [
      {
        id: project.id,
        name: project.name,
        template: project.template,
        updatedAt: project.updatedAt,
        renderStatus: project.render?.status ?? 'idle',
      },
      ...prev,
    ]);
    navigate(
      options.html
        ? `/video/${project.id}?step=brief&html=1`
        : `/video/${project.id}`,
    );
  };

  const createAndOpen = async (
    input: Parameters<typeof createVideoProject>[0],
    options: { html?: boolean } = {},
  ) => {
    try {
      const { project } = await createVideoProject(input);
      handleProjectCreated(project, options);
    } catch (err) {
      toast.error(
        t.video.entry.newProjectDialog.createFailed.replace(
          '{message}',
          err instanceof Error ? err.message : String(err),
        ),
      );
    }
  };

  const createHtmlProject = (prompt?: string) =>
    createAndOpen(
      {
        name: t.video.entry.htmlProjectName,
        template: 'custom',
        aspectRatio: '16:9',
        prompt: (prompt ?? '').trim() || t.video.entry.htmlProjectPrompt,
      },
      { html: true },
    );

  const selectIntent = (intent: CreativeIntentId) => {
    setSelectedIntent(intent);
  };

  const designPathForIntent = (prompt: string, surface?: 'image' | 'audio') => {
    const params = new URLSearchParams();
    if (surface) params.set('surface', surface);
    if (prompt) params.set('prompt', prompt);
    const query = params.toString();
    return query ? `/design?${query}` : '/design';
  };

  const startFromIntent = () => {
    const prompt = intentPrompt.trim();
    if (selectedIntent === 'design') {
      navigate(designPathForIntent(prompt));
      return;
    }
    if (selectedIntent === 'image' || selectedIntent === 'audio') {
      navigate(designPathForIntent(prompt, selectedIntent));
      return;
    }
    if (selectedIntent === 'import') {
      void createHtmlProject(prompt);
      return;
    }
    void createAndOpen({
      name: t.video.entry.defaultProjectName,
      template: selectedIntent === 'template' ? 'product-reel' : 'slideshow',
      aspectRatio: '16:9',
      ...(prompt ? { prompt } : {}),
    });
  };

  const openProjectFolder = async (projectId: string) => {
    try {
      await openVideoProjectFolder(projectId);
    } catch (err) {
      toast.error(
        t.video.entry.openFolderFailed.replace(
          '{message}',
          err instanceof Error ? err.message : String(err),
        ),
      );
    }
  };

  const submitRename = async () => {
    if (!renameTarget) return;
    const next = renameValue.trim();
    if (!next || next === renameTarget.name) {
      setRenameTarget(null);
      return;
    }
    setBusy(true);
    try {
      const result = await renameVideoProject(renameTarget.id, next);
      setProjects((prev) =>
        prev.map((item) =>
          item.id === renameTarget.id
            ? {
                ...item,
                name: result.project.name,
                updatedAt: result.project.updatedAt,
              }
            : item,
        ),
      );
      setRenameTarget(null);
    } catch (err) {
      toast.error(
        t.video.entry.renameFailed.replace(
          '{message}',
          err instanceof Error ? err.message : String(err),
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setBusy(true);
    try {
      await deleteVideoProject(target.id);
      setProjects((prev) => prev.filter((item) => item.id !== target.id));
      toast.success(t.video.entry.deleteSuccess.replace('{name}', target.name));
      setDeleteTarget(null);
    } catch (err) {
      toast.error(
        t.video.entry.deleteFailed.replace(
          '{message}',
          err instanceof Error ? err.message : String(err),
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <SidebarProvider>
      <div className="bg-sidebar flex h-screen overflow-hidden">
        <div className="hidden md:block">
          <LeftSidebar tasks={[]} />
        </div>
        <main className="bg-background flex min-w-0 flex-1 flex-col overflow-hidden shadow-sm md:my-2 md:mr-2 md:rounded-2xl">
          <section className="flex flex-1 flex-col overflow-auto px-4 py-5 sm:px-6 sm:py-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h1 className="text-foreground text-xl font-semibold">
                  {t.video.entry.title}
                </h1>
                <p className="text-muted-foreground mt-1 text-sm">
                  {t.video.entry.description}
                </p>
              </div>
              <ActivePluginChip />
            </div>
            <div className="mt-5 max-w-3xl">
              <CreativeIntentEntry
                labels={t.creative.intentEntry}
                selectedIntent={selectedIntent}
                prompt={intentPrompt}
                onSelectIntent={selectIntent}
                onPromptChange={setIntentPrompt}
                onStart={startFromIntent}
                disabledIntents={{ assets: true }}
              />
              <div className="border-border bg-background mt-4 rounded-lg border p-3">
                <button
                  type="button"
                  className="hover:bg-accent flex w-full items-center justify-between gap-3 rounded-md px-2 py-2 text-left text-sm font-medium"
                  aria-label={t.video.entry.configure}
                  aria-expanded={advancedOpen}
                  aria-controls="video-entry-advanced"
                  onClick={() => setAdvancedOpen((open) => !open)}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <SlidersHorizontal className="size-4 shrink-0" />
                    <span>{t.video.entry.configure}</span>
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {advancedOpen
                      ? t.video.entry.configureHide
                      : t.video.entry.configureShow}
                  </span>
                </button>
                <p className="text-muted-foreground px-2 pb-2 text-xs">
                  {t.video.entry.configureDescription}
                </p>
                <div
                  id="video-entry-advanced"
                  className="border-border mt-3 border-t pt-3"
                  hidden={!advancedOpen}
                >
                  <NewVideoProjectForm
                    defaults={newProjectDefaults}
                    onCreated={handleProjectCreated}
                  />
                  <div className="border-border mt-3 flex justify-end border-t pt-3">
                    <button
                      type="button"
                      className="border-border hover:bg-accent inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium"
                      onClick={() => void createHtmlProject()}
                    >
                      <FileCode2 className="size-4" />
                      {t.video.entry.newHtmlVideo}
                    </button>
                  </div>
                </div>
              </div>
            </div>
            {loading ? (
              <div className="text-muted-foreground flex flex-1 items-center justify-center text-sm">
                {t.video.entry.loading}
              </div>
            ) : error ? (
              <div className="text-destructive flex flex-1 items-center justify-center text-sm">
                {error}
              </div>
            ) : projects.length > 0 ? (
              <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {projects.map((project) => (
                  <VideoFolderCard
                    key={project.id}
                    project={project}
                    onOpen={() => navigate(`/video/${project.id}`)}
                    onRename={() => {
                      setRenameTarget(project);
                      setRenameValue(project.name);
                    }}
                    onDelete={() => setDeleteTarget(project)}
                    onOpenFolder={() => void openProjectFolder(project.id)}
                  />
                ))}
              </div>
            ) : (
              <div className="flex flex-1 items-center justify-center">
                <div className="max-w-lg text-center">
                  <div className="bg-muted text-muted-foreground mx-auto flex size-12 items-center justify-center rounded-xl">
                    <Clapperboard className="size-6" />
                  </div>
                  <h2 className="text-foreground mt-4 text-lg font-semibold">
                    {t.video.entry.emptyTitle}
                  </h2>
                  <p className="text-muted-foreground mt-2 text-sm">
                    {t.video.entry.emptyDescription}
                  </p>
                </div>
              </div>
            )}
          </section>
        </main>
      </div>
      <RenameProjectDialog
        open={Boolean(renameTarget)}
        value={renameValue}
        busy={busy}
        labels={t.video.entry}
        commonLabels={t.common}
        onOpenChange={(open) => {
          if (!open) setRenameTarget(null);
        }}
        onValueChange={setRenameValue}
        onSubmit={() => void submitRename()}
      />
      <DeleteProjectDialog
        open={Boolean(deleteTarget)}
        projectName={deleteTarget?.name ?? ''}
        busy={busy}
        labels={t.video.entry}
        commonLabels={t.common}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        onConfirm={() => void confirmDelete()}
      />
    </SidebarProvider>
  );
}
