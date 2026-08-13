import { useCallback, useEffect, useMemo, useState } from 'react';

import { ArrowLeft, Settings } from 'lucide-react';

import ImageLogo from '@/assets/logo.png';
import { ActivePluginChip } from '@/components/plugins/ActivePluginChip';
import { SettingsModal } from '@/components/settings';
import { APP_NAME } from '@/config';
import {
  DEFAULT_DESIGN_MODE_SETTINGS,
  getSettings,
  saveSettings,
  useSetting,
} from '@/shared/db/settings';
import {
  createDesignProject,
  deleteDesignProject,
  updateDesignProject,
  useDesignCatalogs,
  useDesignProjects,
} from '@/shared/hooks/useDesignMode';
import { usePluginLaunch } from '@/shared/hooks/usePluginLaunch';
import { useLanguage } from '@/shared/providers/language-provider';
import type {
  DesignProject,
  DesignSkillRecord,
  DesignSystemRecord,
  PromptTemplateSnapshot,
} from '@/shared/types/design-mode';

import { DesignEntrySidebar } from './DesignEntrySidebar';
import { clearDesignProjectCoverCache } from './DesignFolderCard';
import { DesignSystemPreviewModal } from './DesignSystemPreviewModal';
import {
  ENTRY_TABS,
  entryPromptFromSearch,
  entrySurfaceFromSearch,
  entryTabLabel,
  tabFromHash,
  type EntryTab,
} from './entry-routing';
import { defaultMediaForSurface, normalizeSurface } from './entryDefaults';
import { EntryTabContent } from './EntryTabContent';
import { launchDesignPlugin } from './launchDesignPlugin';
import { PromptTemplatePreviewModal } from './PromptTemplatePreviewModal';
import { useDesignSystemCatalogActions } from './useDesignSystemCatalogActions';
import { useEntrySettingsPanel } from './useEntrySettingsPanel';

export function DesignEntryView() {
  const { t, language } = useLanguage();
  const {
    location,
    navigate,
    settingsOpen,
    openSettings,
    onSettingsOpenChange,
  } = useEntrySettingsPanel();
  const { projects, loading, refresh, setProjects } = useDesignProjects();
  const catalogs = useDesignCatalogs('prototype');
  const initialPanelSurface = useMemo(
    () => entrySurfaceFromSearch(location.search),
    [location.search],
  );
  const initialPrompt = useMemo(
    () => entryPromptFromSearch(location.search),
    [location.search],
  );
  const designModeSettings =
    useSetting('designMode') ?? DEFAULT_DESIGN_MODE_SETTINGS;
  const [tab, setTab] = useState<EntryTab>('designs');
  const [previewTemplate, setPreviewTemplate] =
    useState<PromptTemplateSnapshot | null>(null);
  const [previewDesignSystem, setPreviewDesignSystem] =
    useState<DesignSystemRecord | null>(null);
  const [creatingTemplate, setCreatingTemplate] = useState(false);
  const [creatingDesignSystemId, setCreatingDesignSystemId] = useState<
    string | null
  >(null);
  const [templateError, setTemplateError] = useState('');
  const [designSystemStartError, setDesignSystemStartError] = useState('');
  const {
    catalogActionId,
    catalogError,
    clearCatalogError,
    updateDesignSystemInstall,
  } = useDesignSystemCatalogActions({
    onCatalogChanged: catalogs.refresh,
    onPreviewChange: setPreviewDesignSystem,
  });

  useEffect(() => {
    const nextTab = tabFromHash(location.hash);
    if (nextTab) setTab(nextTab);
  }, [location.hash]);

  const openProject = useCallback(
    (project: DesignProject) => {
      setProjects((prev) => [project, ...prev]);
      void refresh();
      navigate(`/design/${project.id}`);
    },
    [navigate, refresh, setProjects],
  );

  usePluginLaunch(
    useCallback(
      (active) =>
        launchDesignPlugin(active, { onOpen: openProject, locale: language }),
      [openProject, language],
    ),
  );

  const createFromExample = async (skill: DesignSkillRecord) => {
    const { project } = await createDesignProject({
      title: skill.name,
      surface: normalizeSurface(skill.od.surface),
      skillId: skill.id,
      brief: {
        prompt: skill.od.examplePrompt || skill.description,
        createdFromExample: true,
        locale: language,
        chatLocale: language,
      },
      media: defaultMediaForSurface(skill.od.surface),
    });
    openProject(project);
  };

  const createFromSkill = async (skill: DesignSkillRecord) => {
    const { project } = await createDesignProject({
      title: skill.name,
      surface: normalizeSurface(skill.od.surface),
      skillId: skill.id,
      designSystemId: designModeSettings.defaultDesignSystemId || null,
      brief: {
        prompt: skill.od.examplePrompt || skill.description,
        createdFromSkill: true,
        locale: language,
        chatLocale: language,
      },
      media: defaultMediaForSurface(skill.od.surface),
    });
    openProject(project);
  };

  const updateDesignModeDefaults = (
    patch: Partial<{
      defaultDesignSystemId: string;
      defaultSkillId: string;
    }>,
  ) => {
    const settings = getSettings();
    saveSettings({
      ...settings,
      designMode: {
        ...DEFAULT_DESIGN_MODE_SETTINGS,
        ...settings.designMode,
        ...patch,
      },
    });
  };

  const createFromTemplate = async (template: PromptTemplateSnapshot) => {
    setCreatingTemplate(true);
    setTemplateError('');
    try {
      const { project } = await createDesignProject({
        title: template.title,
        surface: template.surface,
        promptTemplate: template,
        brief: {
          prompt: template.prompt,
          createdFromTemplate: true,
          locale: language,
          chatLocale: language,
        },
        media: {
          model: template.model,
          aspect: template.aspect,
        },
      });
      openProject(project);
    } catch (err) {
      setTemplateError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreatingTemplate(false);
    }
  };

  const createFromDesignSystem = async (system: DesignSystemRecord) => {
    setCreatingDesignSystemId(system.id);
    setDesignSystemStartError('');
    try {
      const { project } = await createDesignProject({
        title: system.title,
        surface: 'prototype',
        designSystemId: system.id,
        brief: {
          prompt: system.summary,
          createdFromDesignSystem: true,
          locale: language,
          chatLocale: language,
        },
      });
      setPreviewDesignSystem(null);
      openProject(project);
    } catch (err) {
      setDesignSystemStartError(
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      setCreatingDesignSystemId(null);
    }
  };

  const renameProject = async (project: DesignProject, title: string) => {
    const { project: next } = await updateDesignProject(project.id, { title });
    setProjects((prev) =>
      prev.map((item) => (item.id === next.id ? next : item)),
    );
  };

  const deleteProjects = async (projectIds: string[]) => {
    await Promise.all(
      projectIds.map((projectId) => deleteDesignProject(projectId)),
    );
    projectIds.forEach(clearDesignProjectCoverCache);
    setProjects((prev) =>
      prev.filter((project) => !projectIds.includes(project.id)),
    );
  };

  const selectTab = (nextTab: EntryTab) => {
    setTab(nextTab);
    navigate(
      nextTab === 'designs'
        ? { pathname: '/design', search: location.search }
        : { pathname: '/design', search: location.search, hash: nextTab },
    );
  };

  return (
    <div
      className="bg-background flex h-full min-h-0 flex-col"
      data-testid="design-entry-view"
    >
      <header className="border-border flex shrink-0 flex-wrap items-center justify-between gap-3 border-b px-4 py-2.5 pr-14">
        <button
          type="button"
          onClick={() => navigate('/')}
          aria-label={t.design.regularMode}
          className="text-muted-foreground hover:bg-accent hover:text-foreground -ml-1 flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 transition-colors"
        >
          <ArrowLeft className="size-4" />
          <img
            src={ImageLogo}
            alt={APP_NAME}
            className="size-5 shrink-0 object-contain"
          />
          <span className="text-foreground text-sm font-semibold">
            {APP_NAME}
          </span>
          <span className="text-muted-foreground text-sm">/</span>
          <span className="text-foreground text-sm font-medium">
            {t.modes.design.label}
          </span>
        </button>
        <div className="flex items-center gap-2">
          <nav className="flex flex-wrap gap-1">
            {ENTRY_TABS.map((item) => (
              <button
                key={item.id}
                type="button"
                className="data-[active=true]:bg-primary data-[active=true]:text-primary-foreground rounded-md px-3 py-1.5 text-sm"
                data-active={tab === item.id}
                onClick={() => selectTab(item.id)}
              >
                {entryTabLabel(t, item.id)}
              </button>
            ))}
          </nav>
          <ActivePluginChip />
          <span className="bg-border h-5 w-px shrink-0" aria-hidden />
          <button
            type="button"
            onClick={openSettings}
            aria-label={t.settings.designMode}
            className="text-muted-foreground hover:bg-accent hover:text-foreground flex size-8 cursor-pointer items-center justify-center rounded-lg transition-colors"
          >
            <Settings className="size-4" />
          </button>
        </div>
      </header>
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <DesignEntrySidebar
          catalogs={catalogs}
          initialPanelSurface={initialPanelSurface}
          initialPrompt={initialPrompt}
          language={language}
          labels={t.creative.intentEntry}
          onOpenProject={openProject}
          onOpenVideo={(prompt) => {
            const params = new URLSearchParams({ new: '1' });
            if (prompt) params.set('prompt', prompt);
            navigate(`/video?${params.toString()}`);
          }}
          onSelectTemplates={(surface) =>
            selectTab(
              surface === 'video' ? 'video-templates' : 'image-templates',
            )
          }
        />
        <main className="min-h-0 flex-1 overflow-auto p-6">
          {loading && tab === 'designs' ? (
            <p className="text-muted-foreground text-sm">
              {t.design.loadingDesigns}
            </p>
          ) : (
            <EntryTabContent
              tab={tab}
              projects={projects}
              catalogs={catalogs}
              onUseExample={createFromExample}
              onCreateSkill={createFromSkill}
              defaultDesignSystemId={designModeSettings.defaultDesignSystemId}
              defaultSkillId={designModeSettings.defaultSkillId}
              onPreviewDesignSystem={setPreviewDesignSystem}
              onSelectDefaultDesignSystem={(system) =>
                updateDesignModeDefaults({ defaultDesignSystemId: system.id })
              }
              onStartDesignSystemProject={(system) =>
                void createFromDesignSystem(system)
              }
              designSystemActionError={designSystemStartError}
              onSelectDefaultSkill={(skill) =>
                updateDesignModeDefaults({ defaultSkillId: skill.id })
              }
              onPreviewTemplate={(template) => {
                setTemplateError('');
                setPreviewTemplate(template);
              }}
              onOpen={(project) => navigate(`/design/${project.id}`)}
              onRenameProject={renameProject}
              onDeleteProjects={deleteProjects}
            />
          )}
        </main>
      </div>
      <SettingsModal
        open={settingsOpen}
        onOpenChange={onSettingsOpenChange}
        initialCategory="designMode"
      />
      <PromptTemplatePreviewModal
        template={previewTemplate}
        creating={creatingTemplate}
        error={templateError}
        onCreate={(template) => void createFromTemplate(template)}
        onOpenChange={(open) => {
          if (!open) setPreviewTemplate(null);
        }}
      />
      <DesignSystemPreviewModal
        system={previewDesignSystem}
        selected={Boolean(
          previewDesignSystem &&
          designModeSettings.defaultDesignSystemId === previewDesignSystem.id,
        )}
        onSelectDefault={(system) =>
          updateDesignModeDefaults({ defaultDesignSystemId: system.id })
        }
        onStartProject={(system) => void createFromDesignSystem(system)}
        startPending={Boolean(
          previewDesignSystem &&
          creatingDesignSystemId === previewDesignSystem.id,
        )}
        installPending={Boolean(
          previewDesignSystem && catalogActionId === previewDesignSystem.id,
        )}
        installError={catalogError || designSystemStartError}
        onInstallChange={(system) => void updateDesignSystemInstall(system)}
        onCatalogChanged={catalogs.refresh}
        onOpenChange={(open) => {
          if (!open) {
            setPreviewDesignSystem(null);
            clearCatalogError();
            setDesignSystemStartError('');
          }
        }}
      />
    </div>
  );
}
