import { useEffect, useState } from 'react';

import { SlidersHorizontal } from 'lucide-react';

import { CreativeIntentEntry } from '@/components/creative/CreativeIntentEntry';
import type { CreativeIntentId } from '@/shared/creative-workflow';
import {
  DEFAULT_DESIGN_MODE_SETTINGS,
  DEFAULT_MODES_SETTINGS,
  useSetting,
} from '@/shared/db/settings';
import { createDesignProject } from '@/shared/hooks/useDesignMode';
import type { useDesignCatalogs } from '@/shared/hooks/useDesignMode';
import type { useLanguage } from '@/shared/providers/language-provider';
import type { DesignProject } from '@/shared/types/design-mode';

import { entrySurfaceFromSearch } from './entry-routing';
import { defaultMediaForSurface } from './entryDefaults';
import { NewProjectPanel } from './NewProjectPanel';

const DESIGN_ENTRY_TITLE_WORD_LIMIT = 6;

type DesignEntrySidebarProps = {
  catalogs: ReturnType<typeof useDesignCatalogs>;
  initialPanelSurface: ReturnType<typeof entrySurfaceFromSearch>;
  initialPrompt: string;
  language: ReturnType<typeof useLanguage>['language'];
  labels: ReturnType<typeof useLanguage>['t']['creative']['intentEntry'];
  onOpenProject: (project: DesignProject) => void;
  onOpenVideo: (prompt: string) => void;
  onSelectTemplates: (surface: 'image' | 'video') => void;
};

export function DesignEntrySidebar({
  catalogs,
  initialPanelSurface,
  initialPrompt,
  language,
  labels,
  onOpenProject,
  onOpenVideo,
  onSelectTemplates,
}: DesignEntrySidebarProps) {
  const designModeSettings =
    useSetting('designMode') ?? DEFAULT_DESIGN_MODE_SETTINGS;
  const modeSettings = {
    ...DEFAULT_MODES_SETTINGS,
    ...useSetting('modes'),
  };
  const [intentSurface, setIntentSurface] = useState(initialPanelSurface);
  const [selectedIntent, setSelectedIntent] = useState<CreativeIntentId>(
    intentFromEntrySurface(initialPanelSurface),
  );
  const [intentPrompt, setIntentPrompt] = useState(initialPrompt);
  const [intentCreating, setIntentCreating] = useState(false);
  const [intentError, setIntentError] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(() =>
    shouldOpenAdvancedFromRoute(initialPanelSurface),
  );

  useEffect(() => {
    setIntentSurface(initialPanelSurface);
    setSelectedIntent(intentFromEntrySurface(initialPanelSurface));
    if (shouldOpenAdvancedFromRoute(initialPanelSurface)) {
      setAdvancedOpen(true);
    }
  }, [initialPanelSurface]);

  useEffect(() => {
    setIntentPrompt(initialPrompt);
  }, [initialPrompt]);

  const selectIntent = (intent: CreativeIntentId) => {
    const templateSurface = selectedIntent === 'video' ? 'video' : 'image';
    setSelectedIntent(intent);
    setIntentError('');
    setIntentSurface(
      intent === 'template'
        ? { initialSurface: 'template', initialMediaSurface: templateSurface }
        : entrySurfaceFromIntent(intent),
    );
    if (intent === 'template') onSelectTemplates(templateSurface);
  };

  const startFromIntent = async () => {
    const prompt = intentPrompt.trim();
    if (selectedIntent === 'template') {
      onSelectTemplates(
        intentSurface.initialMediaSurface === 'video' ? 'video' : 'image',
      );
      return;
    }
    if (selectedIntent === 'video' && modeSettings.videoEnabled) {
      onOpenVideo(prompt);
      return;
    }

    const surface = designSurfaceFromIntent(selectedIntent);
    const title = titleFromPrompt(prompt, labels.intent[selectedIntent]);
    setIntentCreating(true);
    setIntentError('');
    try {
      const { project } = await createDesignProject({
        title,
        surface,
        intent: designIntentFromCreativeIntent(selectedIntent),
        brief: {
          prompt,
          createdFromIntent: selectedIntent,
          locale: language,
          chatLocale: language,
        },
        media: defaultMediaForSurface(surface),
      });
      onOpenProject(project);
    } catch (err) {
      setIntentError(err instanceof Error ? err.message : String(err));
    } finally {
      setIntentCreating(false);
    }
  };

  return (
    <section className="bg-muted/20 border-border max-h-[46vh] shrink-0 overflow-auto border-b p-5 lg:h-full lg:max-h-none lg:w-[380px] lg:border-r lg:border-b-0 xl:w-[420px]">
      <div className="mb-5">
        <CreativeIntentEntry
          labels={labels}
          selectedIntent={selectedIntent}
          prompt={intentPrompt}
          onSelectIntent={selectIntent}
          onPromptChange={setIntentPrompt}
          onStart={() => void startFromIntent()}
          disabledIntents={{ assets: true, import: true }}
          startDisabled={intentCreating}
        />
        {intentError ? (
          <p className="text-destructive mt-2 text-xs">
            {labels.startFailed.replace('{message}', intentError)}
          </p>
        ) : null}
      </div>
      <div className="border-border bg-background rounded-lg border p-3">
        <button
          type="button"
          className="hover:bg-accent flex w-full items-center justify-between gap-3 rounded-md px-2 py-2 text-left text-sm font-medium"
          aria-label={labels.configure}
          aria-expanded={advancedOpen}
          aria-controls="design-entry-advanced"
          onClick={() => setAdvancedOpen((open) => !open)}
        >
          <span className="flex min-w-0 items-center gap-2">
            <SlidersHorizontal className="size-4 shrink-0" />
            <span>{labels.configure}</span>
          </span>
          <span className="text-muted-foreground text-xs">
            {advancedOpen ? labels.configureHide : labels.configureShow}
          </span>
        </button>
        <p className="text-muted-foreground px-2 pb-2 text-xs">
          {labels.configureDescription}
        </p>
        <div
          id="design-entry-advanced"
          className="border-border mt-3 border-t pt-3"
          hidden={!advancedOpen}
        >
          <NewProjectPanel
            designSystems={catalogs.designSystems}
            skills={catalogs.skills}
            imageTemplates={catalogs.imageTemplates}
            videoTemplates={catalogs.videoTemplates}
            defaultDesignSystemId={designModeSettings.defaultDesignSystemId}
            defaultSkillId={designModeSettings.defaultSkillId}
            initialSurface={intentSurface.initialSurface}
            initialMediaSurface={intentSurface.initialMediaSurface}
            onCreated={onOpenProject}
          />
        </div>
      </div>
    </section>
  );
}

function titleFromPrompt(prompt: string, fallback: string): string {
  const firstLine = prompt.split(/\r?\n/)[0]?.trim() ?? '';
  if (!firstLine) return fallback;
  const firstClause = firstLine.split(/[.!?;:]/)[0]?.trim() || firstLine;
  const title = firstClause
    .split(/\s+/)
    .slice(0, DESIGN_ENTRY_TITLE_WORD_LIMIT)
    .join(' ')
    .replace(/[,，]+$/, '')
    .trim();
  return title || fallback;
}

function shouldOpenAdvancedFromRoute({
  initialSurface,
}: ReturnType<typeof entrySurfaceFromSearch>): boolean {
  return initialSurface === 'media' || initialSurface === 'template';
}

function intentFromEntrySurface({
  initialSurface,
  initialMediaSurface,
}: ReturnType<typeof entrySurfaceFromSearch>): CreativeIntentId {
  if (initialSurface === 'media') return initialMediaSurface;
  if (initialSurface === 'template') return 'template';
  return 'design';
}

function entrySurfaceFromIntent(
  intent: CreativeIntentId,
): ReturnType<typeof entrySurfaceFromSearch> {
  if (intent === 'image' || intent === 'audio' || intent === 'video') {
    return { initialSurface: 'media', initialMediaSurface: intent };
  }
  if (intent === 'template') {
    return { initialSurface: 'template', initialMediaSurface: 'image' };
  }
  return { initialSurface: 'prototype', initialMediaSurface: 'image' };
}

function designSurfaceFromIntent(
  intent: CreativeIntentId,
): DesignProject['surface'] {
  if (intent === 'image' || intent === 'audio' || intent === 'video') {
    return intent;
  }
  if (intent === 'template') return 'template';
  return 'prototype';
}

function designIntentFromCreativeIntent(
  intent: CreativeIntentId,
): DesignProject['intent'] {
  if (intent === 'image' || intent === 'audio' || intent === 'video') {
    return 'media';
  }
  if (intent === 'design') return 'app-screen';
  return 'other';
}
