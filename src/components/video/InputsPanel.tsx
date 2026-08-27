import { useEffect, useRef, useState } from 'react';

import { useLanguage } from '@/shared/providers/language-provider';
import type { VideoProject } from '@/shared/types/video';

import { PanelShell } from './PanelShell';
import { ProjectTemplateField } from './ProjectTemplateField';

interface InputsPanelProps {
  project: VideoProject;
  onPatch: (patch: Partial<VideoProject>) => Promise<VideoProject | null>;
}

/**
 * The "Brief" surface — script + template + prompt stacked in a single
 * scroll column. Assets and Brand previously had duplicate sub-tabs here
 * that overlapped with the outer SideRail's Assets and Brand tabs;
 * those are now owned exclusively by the outer tabs.
 */
export function InputsPanel({ project, onPatch }: InputsPanelProps) {
  const { t } = useLanguage();
  const [script, setScript] = useState(project.script ?? '');
  const hasEditedScriptRef = useRef(false);
  const lastProjectIdRef = useRef(project.id);

  useEffect(() => {
    const projectChanged = lastProjectIdRef.current !== project.id;
    if (projectChanged) {
      lastProjectIdRef.current = project.id;
      hasEditedScriptRef.current = false;
    }
    if (projectChanged || !hasEditedScriptRef.current) {
      setScript(project.script ?? '');
    }
  }, [project.id, project.script]);

  const wordCount = script.trim() ? script.trim().split(/\s+/).length : 0;
  const narrationSec = Math.ceil((wordCount / 150) * 60);

  return (
    <PanelShell
      title={t.video.inputs.title}
      description={t.video.inputs.description}
    >
      <div className="space-y-5">
        <section className="space-y-2">
          <h3 className="text-foreground text-xs font-semibold">
            {t.video.inputs.tabs.script}
          </h3>
          <textarea
            value={script}
            onChange={(event) => {
              hasEditedScriptRef.current = true;
              setScript(event.target.value);
            }}
            onBlur={async () => {
              try {
                await onPatch({ script });
              } finally {
                hasEditedScriptRef.current = false;
              }
            }}
            placeholder={t.video.inputs.scriptPlaceholder}
            className="border-input bg-background min-h-36 w-full resize-y rounded-md border px-3 py-2 text-sm"
          />
          <p className="text-muted-foreground text-xs">
            {t.video.inputs.wordCount
              .replace('{count}', String(wordCount))
              .replace('{seconds}', String(narrationSec))}
          </p>
        </section>

        <section className="space-y-2">
          <h3 className="text-foreground text-xs font-semibold">
            {t.video.inputs.tabs.template}
          </h3>
          {/* One implementation of the intent control, so the rail cannot
              offer a change the Brief step refuses — or vice versa. */}
          <ProjectTemplateField
            project={project}
            onPatch={onPatch}
            variant="inline"
          />
          <textarea
            value={project.prompt}
            onChange={(event) => void onPatch({ prompt: event.target.value })}
            placeholder={t.video.inputs.promptPlaceholder}
            className="border-input bg-background min-h-24 w-full resize-y rounded-md border px-3 py-2 text-sm"
          />
        </section>
      </div>
    </PanelShell>
  );
}
