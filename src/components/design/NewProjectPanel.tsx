import { useEffect, useMemo, useState } from 'react';

import { recordCreativeDebugCounter } from '@/shared/creative-workflow/debug-counters';
import { DEFAULT_DESIGN_MODE_SETTINGS, useSetting } from '@/shared/db/settings';
import {
  createDesignProject,
  getPromptTemplateDetail,
} from '@/shared/hooks/useDesignMode';
import { useLanguage } from '@/shared/providers/language-provider';
import type {
  DesignProject,
  DesignSkillRecord,
  DesignSurface,
  DesignSystemRecord,
  PromptTemplateSnapshot,
  DesignProjectIntent,
} from '@/shared/types/design-mode';

import { defaultIntentForSurface, localizedSurfaceLabel } from './constants';
import { DesignMediaGenerationSection } from './DesignMediaGenerationSection';
import { DesignSystemPicker } from './DesignSystemPicker';
import { FidelityPicker } from './FidelityPicker';
import { MediaSurfacePicker, type MediaSurface } from './MediaSurfacePicker';
import { NewProjectSubmitActions } from './NewProjectSubmitActions';
import { ProjectIntentPicker } from './ProjectIntentPicker';
import { SurfaceTabsShell } from './SurfaceTabs';
import { ToggleRow } from './ToggleRow';

type SurfaceState = {
  name: string;
  designSystemId: string | null;
  inspirations: string[];
  prompt: string;
  intent?: DesignProjectIntent;
  model?: string;
  aspect?: string;
  imageStyle?: string;
  lengthSeconds?: number;
  durationSeconds?: number;
  voice?: string;
  skillId?: string | null;
  audioKind?: 'speech' | 'voiceover' | 'music' | 'sfx' | 'ambience';
  fidelity?: 'wireframe' | 'high-fidelity';
  speakerNotes?: boolean;
  templateId?: string;
};

type SurfaceSelection = DesignSurface | 'other' | 'media';

const DEFAULT_STATE: SurfaceState = {
  name: '',
  designSystemId: null,
  inspirations: [],
  prompt: '',
  aspect: '16:9',
  audioKind: 'speech',
  lengthSeconds: 5,
  durationSeconds: 30,
  fidelity: 'wireframe',
};
interface NewProjectPanelProps {
  designSystems: DesignSystemRecord[];
  skills: DesignSkillRecord[];
  imageTemplates: PromptTemplateSnapshot[];
  videoTemplates: PromptTemplateSnapshot[];
  defaultDesignSystemId?: string;
  defaultSkillId?: string;
  initialSurface?: SurfaceSelection;
  initialMediaSurface?: MediaSurface;
  onCreated: (project: DesignProject) => void;
}

export function NewProjectPanel({
  designSystems,
  skills,
  imageTemplates,
  videoTemplates,
  defaultDesignSystemId = '',
  defaultSkillId = '',
  initialSurface = 'prototype',
  initialMediaSurface = 'image',
  onCreated,
}: NewProjectPanelProps) {
  const { t, tt, language } = useLanguage();
  const designModeSettings =
    useSetting('designMode') ?? DEFAULT_DESIGN_MODE_SETTINGS;
  const [surface, setSurface] = useState<SurfaceSelection>(initialSurface);
  const [mediaSurface, setMediaSurface] =
    useState<MediaSurface>(initialMediaSurface);
  const [states, setStates] = useState<Record<string, SurfaceState>>({});
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const actualSurface =
    surface === 'other'
      ? 'prototype'
      : surface === 'media'
        ? mediaSurface
        : surface;
  const stateKey = surface === 'media' ? `media:${mediaSurface}` : surface;
  const templates = actualSurface === 'video' ? videoTemplates : imageTemplates;
  const surfaceName = localizedSurfaceLabel(surface, t.design.surfaces);
  const resolvedDefaultDesignSystemId = useMemo(
    () =>
      designSystems.some((system) => system.id === defaultDesignSystemId)
        ? defaultDesignSystemId
        : '',
    [defaultDesignSystemId, designSystems],
  );
  const resolvedDefaultSkillId = useMemo(
    () =>
      skills.find(
        (skill) => skill.id === defaultSkillId || skill.slug === defaultSkillId,
      )?.id ?? '',
    [defaultSkillId, skills],
  );
  const defaultState = useMemo<SurfaceState>(
    () => ({
      ...DEFAULT_STATE,
      designSystemId: resolvedDefaultDesignSystemId || null,
      skillId: resolvedDefaultSkillId || null,
    }),
    [resolvedDefaultDesignSystemId, resolvedDefaultSkillId],
  );
  const current = states[stateKey] ?? defaultState;
  const mediaAliases = designModeSettings.media?.aliases ?? {};
  const currentIntent =
    current.intent ?? defaultIntentForSurface(actualSurface);
  const isMediaProject = isMediaSurface(actualSurface);

  useEffect(() => {
    setSurface(initialSurface);
    if (initialSurface === 'media') setMediaSurface(initialMediaSurface);
  }, [initialMediaSurface, initialSurface]);

  const title = useMemo(
    () =>
      tt('design.newProjectTitle', {
        surface: surfaceName.toLocaleLowerCase(),
      }),
    [surfaceName, tt],
  );

  const update = (patch: Partial<SurfaceState>) => {
    setStates((prev) => ({
      ...prev,
      [stateKey]: { ...(prev[stateKey] ?? defaultState), ...patch },
    }));
  };

  const updateModel = (model: string) => {
    update({
      model,
      audioKind: model === 'elevenlabs-sfx' ? 'sfx' : current.audioKind,
      voice: model === 'elevenlabs-speech' ? current.voice : undefined,
    });
  };

  const handleCreate = async () => {
    const name =
      current.name.trim() ||
      `${surfaceName} · ${new Date().toLocaleDateString()}`;
    setCreating(true);
    setCreateError('');
    try {
      if (
        actualSurface === 'image' ||
        actualSurface === 'video' ||
        actualSurface === 'audio'
      ) {
        recordCreativeDebugCounter('generation.submitted');
      }
      const template =
        (actualSurface === 'image' || actualSurface === 'video') &&
        current.templateId
          ? (await getPromptTemplateDetail(actualSurface, current.templateId))
              .template
          : undefined;
      const { project } = await createDesignProject({
        title: name,
        surface: actualSurface,
        intent: currentIntent,
        designSystemId: current.designSystemId,
        inspirationDesignSystemIds: current.inspirations,
        skillId: current.skillId,
        promptTemplate: template,
        media: {
          model: current.model,
          aspect: current.aspect as NonNullable<
            DesignProject['media']
          >['aspect'],
          imageStyle: current.imageStyle,
          lengthSeconds: current.lengthSeconds,
          durationSeconds: current.durationSeconds,
          voice: current.voice,
          audioKind: current.audioKind,
          fidelity: current.fidelity,
          speakerNotes: current.speakerNotes,
        },
        brief: {
          prompt: template?.prompt || current.prompt,
          intent: currentIntent,
          createdFromPanel: true,
          createdFromTemplate: Boolean(template),
          locale: language,
          chatLocale: language,
        },
      });
      onCreated(project);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  };

  return (
    <section className="space-y-4" data-testid="new-project-panel">
      <SurfaceTabsShell value={surface} onChange={setSurface} />
      {surface === 'media' && (
        <MediaSurfacePicker
          value={mediaSurface}
          labels={t.design.surfaces}
          onChange={setMediaSurface}
        />
      )}
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-muted-foreground text-sm">
          {t.design.structuredLocalFiles}
        </p>
      </div>
      <label className="block space-y-1.5 text-sm">
        <span className="font-medium">{t.design.projectName}</span>
        <input
          value={current.name}
          onChange={(event) => update({ name: event.target.value })}
          placeholder={t.design.projectNamePlaceholder}
          data-testid="design-project-name-input"
          className="border-input bg-background focus:ring-ring/40 h-10 w-full rounded-md border px-3 outline-none focus:ring-2"
        />
      </label>

      {[
        'document',
        'prototype',
        'deck',
        'template',
        'campaign',
        'other',
      ].includes(surface) && (
        <DesignSystemPicker
          systems={designSystems}
          value={current.designSystemId}
          inspirations={current.inspirations}
          onChange={(designSystemId, inspirations) =>
            update({ designSystemId, inspirations })
          }
        />
      )}

      {surface === 'prototype' && (
        <FidelityPicker
          value={current.fidelity}
          onChange={(fidelity) => update({ fidelity })}
        />
      )}

      <ProjectIntentPicker
        value={currentIntent}
        labels={{ intent: t.design.intent, ...t.design.intents }}
        onChange={(intent) => update({ intent })}
      />

      {surface === 'deck' && (
        <ToggleRow
          label={t.design.speakerNotes}
          checked={Boolean(current.speakerNotes)}
          onChange={(speakerNotes) => update({ speakerNotes })}
        />
      )}

      {isMediaProject ? (
        <DesignMediaGenerationSection
          surface={actualSurface}
          current={current}
          templates={templates}
          mediaAliases={mediaAliases}
          onUpdate={update}
          onModelChange={updateModel}
        />
      ) : (
        <label className="block space-y-1.5 text-sm">
          <span className="font-medium">{t.design.brief}</span>
          <textarea
            value={current.prompt}
            onChange={(event) => update({ prompt: event.target.value })}
            placeholder={t.design.briefPlaceholder}
            data-testid="design-project-brief-input"
            className="border-input bg-background focus:ring-ring/40 min-h-24 w-full resize-none rounded-md border p-3 outline-none focus:ring-2"
          />
        </label>
      )}

      <NewProjectSubmitActions
        creating={creating}
        createError={createError}
        createLabel={
          surface === 'template' ? t.design.createFromTemplate : t.design.create
        }
        onCreate={handleCreate}
        surface={actualSurface}
        onCreated={onCreated}
      />
    </section>
  );
}

function isMediaSurface(surface: DesignSurface): surface is MediaSurface {
  return surface === 'image' || surface === 'video' || surface === 'audio';
}
