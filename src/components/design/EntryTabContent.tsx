import type { useDesignCatalogs } from '@/shared/hooks/useDesignMode';
import type {
  DesignProject,
  DesignSkillRecord,
  DesignSystemRecord,
  PromptTemplateSnapshot,
} from '@/shared/types/design-mode';

import type { EntryTab } from './entry-routing';
import { DesignsTab } from './tabs/DesignsTab';
import { DesignSystemsTab } from './tabs/DesignSystemsTab';
import { ExamplesTab } from './tabs/ExamplesTab';
import { PromptTemplatesTab } from './tabs/PromptTemplatesTab';
import { RoutinesTab } from './tabs/RoutinesTab';
import { SkillsTab } from './tabs/SkillsTab';

export function EntryTabContent({
  tab,
  projects,
  catalogs,
  onUseExample,
  onCreateSkill,
  defaultDesignSystemId,
  defaultSkillId,
  onPreviewDesignSystem,
  onSelectDefaultDesignSystem,
  onStartDesignSystemProject,
  designSystemActionError,
  onSelectDefaultSkill,
  onPreviewTemplate,
  onOpen,
  onRenameProject,
  onDeleteProjects,
}: {
  tab: EntryTab;
  projects: DesignProject[];
  catalogs: ReturnType<typeof useDesignCatalogs>;
  onUseExample: (skill: DesignSkillRecord) => Promise<void>;
  onCreateSkill: (skill: DesignSkillRecord) => Promise<void>;
  defaultDesignSystemId: string;
  defaultSkillId: string;
  onPreviewDesignSystem: (system: DesignSystemRecord) => void;
  onSelectDefaultDesignSystem: (system: DesignSystemRecord) => void;
  onStartDesignSystemProject: (system: DesignSystemRecord) => void;
  designSystemActionError?: string;
  onSelectDefaultSkill: (skill: DesignSkillRecord) => void;
  onPreviewTemplate: (template: PromptTemplateSnapshot) => void;
  onOpen: (project: DesignProject) => void;
  onRenameProject: (project: DesignProject, title: string) => Promise<void>;
  onDeleteProjects: (projectIds: string[]) => Promise<void>;
}) {
  if (tab === 'designs') {
    return (
      <DesignsTab
        projects={projects}
        designSystems={catalogs.designSystems}
        onOpen={onOpen}
        onRename={onRenameProject}
        onDelete={onDeleteProjects}
      />
    );
  }
  if (tab === 'design-systems') {
    return (
      <DesignSystemsTab
        systems={catalogs.designSystems}
        selectedId={defaultDesignSystemId}
        onPreview={onPreviewDesignSystem}
        onSelectDefault={onSelectDefaultDesignSystem}
        onStartProject={onStartDesignSystemProject}
        actionError={designSystemActionError}
        onCatalogChanged={catalogs.refresh}
      />
    );
  }
  if (tab === 'image-templates') {
    return (
      <PromptTemplatesTab
        surface="image"
        templates={catalogs.imageTemplates}
        onPreview={onPreviewTemplate}
      />
    );
  }
  if (tab === 'video-templates') {
    return (
      <PromptTemplatesTab
        surface="video"
        templates={catalogs.videoTemplates}
        onPreview={onPreviewTemplate}
      />
    );
  }
  if (tab === 'skills') {
    return (
      <SkillsTab
        skills={catalogs.skills}
        selectedId={defaultSkillId}
        onCreate={onCreateSkill}
        onSelectDefault={onSelectDefaultSkill}
        onCatalogChanged={catalogs.refresh}
      />
    );
  }
  if (tab === 'routines') {
    return (
      <RoutinesTab
        projects={projects}
        designSystems={catalogs.designSystems}
        skills={catalogs.skills}
        onOpen={onOpen}
      />
    );
  }
  return (
    <ExamplesTab
      skills={catalogs.skills.filter((skill) => hasExampleContent(skill))}
      onUsePrompt={onUseExample}
    />
  );
}

function hasExampleContent(skill: DesignSkillRecord) {
  return Boolean(
    skill.od.examplePrompt ||
    skill.od.preview?.entry ||
    (skill.source === 'bundled' && skill.description),
  );
}
