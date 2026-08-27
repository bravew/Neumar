import { useState } from 'react';

import { Lock, WandSparkles } from 'lucide-react';

import { useLanguage } from '@/shared/providers/language-provider';
import type { VideoProject, VideoTemplateId } from '@/shared/types/video';

import { PROJECT_TEMPLATES } from './projectTemplates';

/**
 * The project's product intent.
 *
 * The template is not a formatting preference — it sets the agent's skill set,
 * the shape of the conversation, and the duration ceiling approval enforces.
 * Changing it once a storyboard exists invalidates decisions already made
 * against it, so it locks itself and asks before letting go.
 *
 * It stays overridable rather than permanent because the ceiling is otherwise
 * a dead end: a storyboard that outgrew its template cannot be approved,
 * rendered, or exported, and no other control can free it.
 */
export function ProjectTemplateField({
  project,
  onPatch,
  variant = 'card',
}: {
  project: VideoProject;
  onPatch: (patch: Partial<VideoProject>) => Promise<unknown>;
  variant?: 'card' | 'inline';
}) {
  const { t } = useLanguage();
  const labels = t.video.editor.templateField;
  const committed = (project.storyboard?.scenes.length ?? 0) > 0;
  const [unlocked, setUnlocked] = useState(false);
  const locked = committed && !unlocked;

  const select = (
    <select
      value={project.template}
      disabled={locked}
      onChange={(event) =>
        void onPatch({ template: event.target.value as VideoTemplateId })
      }
      className="text-foreground w-full bg-transparent text-sm font-medium outline-none disabled:opacity-70"
    >
      {PROJECT_TEMPLATES.map((template) => (
        <option key={template} value={template}>
          {t.video.templates[template]}
        </option>
      ))}
    </select>
  );

  const lockNote = locked ? (
    <p className="text-muted-foreground mt-1 text-[11px]">
      {labels.locked}{' '}
      <button
        type="button"
        onClick={() => {
          if (window.confirm(labels.confirmChange)) setUnlocked(true);
        }}
        className="text-primary hover:underline"
      >
        {labels.changeAnyway}
      </button>
    </p>
  ) : null;

  if (variant === 'inline') {
    return (
      <div>
        <span className="text-muted-foreground mb-1 block text-xs font-medium">
          {labels.label}
        </span>
        {select}
        {lockNote}
      </div>
    );
  }

  return (
    <div className="border-border bg-background flex items-start gap-2 rounded-md border p-3">
      {locked ? (
        <Lock className="text-muted-foreground mt-0.5 size-4 shrink-0" />
      ) : (
        <WandSparkles className="text-muted-foreground mt-0.5 size-4 shrink-0" />
      )}
      <div className="min-w-0 flex-1">
        <span className="text-muted-foreground block text-xs">
          {labels.label}
        </span>
        {select}
        {lockNote}
      </div>
    </div>
  );
}
