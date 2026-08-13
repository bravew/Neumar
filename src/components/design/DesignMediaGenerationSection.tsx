import { useMemo } from 'react';

import {
  MediaGenerationWorkspace,
  type MediaGenerationCapability,
} from '@/components/creative/MediaGenerationWorkspace';
import { useLanguage } from '@/shared/providers/language-provider';
import type { PromptTemplateSnapshot } from '@/shared/types/design-mode';

import { AspectCards } from './AspectCards';
import { AudioKindPicker } from './AudioKindPicker';
import { AudioProviderControls } from './AudioProviderControls';
import { MediaModelCards } from './MediaModelCards';
import type { MediaSurface } from './MediaSurfacePicker';

interface DesignMediaGenerationState {
  prompt: string;
  model?: string;
  aspect?: string;
  durationSeconds?: number;
  voice?: string;
  audioKind?: 'speech' | 'voiceover' | 'music' | 'sfx' | 'ambience';
  templateId?: string;
}

interface DesignMediaGenerationSectionProps {
  surface: MediaSurface;
  current: DesignMediaGenerationState;
  templates: PromptTemplateSnapshot[];
  mediaAliases: Record<string, string>;
  onUpdate: (patch: Partial<DesignMediaGenerationState>) => void;
  onModelChange: (model: string) => void;
}

export function DesignMediaGenerationSection({
  surface,
  current,
  templates,
  mediaAliases,
  onUpdate,
  onModelChange,
}: DesignMediaGenerationSectionProps) {
  const { t } = useLanguage();
  const capabilities = useMemo<MediaGenerationCapability[]>(
    () => [
      {
        id: 'model',
        label: t.creative.mediaGeneration.model,
        value: current.model
          ? modelSummary(current.model, mediaAliases)
          : t.creative.mediaGeneration.projectDefaults,
      },
      ...(surface === 'audio'
        ? [
            {
              id: 'duration',
              label: t.creative.mediaGeneration.duration,
              value: `${current.durationSeconds ?? 30}s`,
            },
          ]
        : [
            {
              id: 'aspect',
              label: t.creative.mediaGeneration.aspectRatio,
              value:
                current.aspect ?? t.creative.mediaGeneration.projectDefaults,
            },
          ]),
    ],
    [
      current.aspect,
      current.durationSeconds,
      current.model,
      mediaAliases,
      surface,
      t.creative.mediaGeneration.aspectRatio,
      t.creative.mediaGeneration.duration,
      t.creative.mediaGeneration.model,
      t.creative.mediaGeneration.projectDefaults,
    ],
  );

  return (
    <MediaGenerationWorkspace
      surface={surface}
      title={t.creative.mediaGeneration.title}
      description={t.creative.mediaGeneration.description}
      prompt={current.prompt}
      promptLabel={t.design.brief}
      promptPlaceholder={t.design.briefPlaceholder}
      promptTestId="design-project-brief-input"
      onPromptChange={(prompt) => onUpdate({ prompt })}
      capabilities={capabilities}
    >
      {(surface === 'image' || surface === 'video') && (
        <>
          <label className="block space-y-1.5 text-sm">
            <span className="font-medium">{t.design.promptTemplateLabel}</span>
            <select
              value={current.templateId ?? ''}
              onChange={(event) =>
                onUpdate({ templateId: event.target.value || undefined })
              }
              className="border-input bg-background h-10 w-full rounded-md border px-3 text-sm"
            >
              <option value="">{t.design.noPromptTemplate}</option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.title}
                </option>
              ))}
            </select>
          </label>
          <MediaModelCards
            value={current.model}
            surface={surface}
            aliases={mediaAliases}
            onChange={onModelChange}
          />
          <AspectCards
            value={current.aspect}
            onChange={(aspect) => onUpdate({ aspect })}
          />
        </>
      )}

      {surface === 'audio' && (
        <>
          <MediaModelCards
            value={current.model}
            surface="audio"
            aliases={mediaAliases}
            onChange={onModelChange}
          />
          {current.model !== 'elevenlabs-speech' &&
            current.model !== 'elevenlabs-sfx' && (
              <AudioKindPicker
                value={current.audioKind}
                unsupportedTitle={t.design.audioProviderNotConfigured}
                onChange={(audioKind) => onUpdate({ audioKind })}
              />
            )}
          <AudioProviderControls
            model={current.model}
            voice={current.voice}
            onVoiceChange={(voice) => onUpdate({ voice })}
          />
        </>
      )}
    </MediaGenerationWorkspace>
  );
}

function modelSummary(model: string, aliases: Record<string, string>): string {
  const alias = aliases[model];
  return alias ? `${model} -> ${alias}` : model;
}
