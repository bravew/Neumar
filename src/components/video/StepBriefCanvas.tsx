import { useEffect, useRef } from 'react';

import { FileCode2, FileText, Image, WandSparkles } from 'lucide-react';

import { useLanguage } from '@/shared/providers/language-provider';
import type { VideoProject } from '@/shared/types/video';

import type { VideoProjectEditorActions, VideoEditorStep } from './editorTypes';
import { HtmlVideoPanel } from './html-video/HtmlVideoPanel';
import { ProjectTemplateField } from './ProjectTemplateField';
import { TemplateInlinePicker } from './TemplateInlinePicker';

interface StepBriefCanvasProps {
  project: VideoProject;
  actions: VideoProjectEditorActions;
  onStepChange: (step: VideoEditorStep) => void;
  focusHtml?: boolean;
}

export function StepBriefCanvas({
  project,
  actions,
  onStepChange,
  focusHtml = false,
}: StepBriefCanvasProps) {
  const { t } = useLanguage();
  const words = project.script?.trim().split(/\s+/).filter(Boolean).length ?? 0;
  const htmlPanelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!focusHtml) return;
    htmlPanelRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
  }, [focusHtml]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto p-4">
      <div className="grid gap-3 lg:grid-cols-3">
        <Metric
          icon={FileText}
          label={t.video.editor.brief.script}
          value={t.video.inputs.wordCount
            .replace('{count}', String(words))
            .replace('{seconds}', String(Math.round(words / 2.5)))}
        />
        <Metric
          icon={Image}
          label={t.video.editor.brief.assets}
          value={t.video.editor.brief.assetCount.replace(
            '{count}',
            String(project.assets.length),
          )}
        />
        <ProjectTemplateField
          project={project}
          onPatch={actions.patchProject}
        />
      </div>
      <div className="mt-4">
        <TemplateInlinePicker
          onApply={actions.applyTemplate}
          onApplied={() => onStepChange('board')}
        />
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="border-border hover:bg-accent inline-flex items-center gap-2 rounded-md border px-3 py-2 text-xs font-medium"
          onClick={() =>
            htmlPanelRef.current?.scrollIntoView({
              behavior: 'smooth',
              block: 'start',
            })
          }
        >
          <FileCode2 className="size-3.5" />
          {t.video.entry.newHtmlVideo}
        </button>
      </div>
      <div ref={htmlPanelRef} className="mt-4 scroll-mt-4">
        <HtmlVideoPanel projectId={project.id} />
      </div>
      <section className="border-border bg-muted/20 mt-4 min-h-0 flex-1 rounded-md border border-dashed p-4">
        <h2 className="text-foreground text-sm font-semibold">
          {t.video.editor.brief.title}
        </h2>
        <p className="text-muted-foreground mt-1 text-xs">
          {t.video.editor.brief.description}
        </p>
        <div className="mt-4 grid gap-3 xl:grid-cols-2">
          <div className="border-border bg-background rounded-md border p-3">
            <p className="text-muted-foreground mb-2 text-xs">
              {t.video.inputs.promptPlaceholder}
            </p>
            <p className="text-foreground line-clamp-6 text-sm">
              {project.prompt || t.video.editor.brief.noPrompt}
            </p>
          </div>
          <div className="border-border bg-background rounded-md border p-3">
            <p className="text-muted-foreground mb-2 text-xs">
              {t.video.inputs.scriptPlaceholder}
            </p>
            <p className="text-foreground line-clamp-6 text-sm whitespace-pre-wrap">
              {project.script || t.video.editor.brief.noScript}
            </p>
          </div>
        </div>
      </section>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-3 py-2 text-xs font-medium"
          onClick={async () => {
            await actions.generateStoryboard(
              t.video.agent.generatePrompt
                .replace('{template}', project.template)
                .replace('{budget}', String(project.budget?.capUsd ?? 0)),
            );
            onStepChange('board');
          }}
        >
          <WandSparkles className="mr-1 inline size-3" />
          {t.video.editor.actions.generateStoryboard}
        </button>
      </div>
    </div>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof FileText;
  label: string;
  value: string;
}) {
  return (
    <div className="border-border bg-background rounded-md border p-3">
      <div className="text-muted-foreground flex items-center gap-2 text-xs">
        <Icon className="size-4" />
        <span>{label}</span>
      </div>
      <p className="text-foreground mt-2 truncate text-sm font-medium">
        {value}
      </p>
    </div>
  );
}
