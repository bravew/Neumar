import { useEffect, useState } from 'react';

import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { createVideoProject } from '@/shared/hooks/useVideoProject';
import { useLanguage } from '@/shared/providers/language-provider';
import type {
  VideoAspectRatio,
  VideoProject,
  VideoTemplateId,
} from '@/shared/types/video';

export interface NewVideoProjectDefaults {
  name?: string;
  template?: VideoTemplateId;
  aspectRatio?: VideoAspectRatio;
  prompt?: string;
}

const TEMPLATE_OPTIONS: VideoTemplateId[] = [
  'slideshow',
  'product-reel',
  'explainer',
  'ugc-ad',
  'podcast',
  'custom',
];

const ASPECT_OPTIONS: VideoAspectRatio[] = ['16:9', '9:16', '1:1', '4:5'];

/**
 * Inline new-video-project form. Decoupled from any modal shell so the entry
 * page can render it directly (mirrors how Design embeds NewProjectPanel behind
 * its "Configure" disclosure). Owns its create call and surfaces failures as a
 * toast; the parent decides where to navigate via `onCreated`.
 */
export function NewVideoProjectForm({
  defaults,
  onCreated,
}: {
  defaults?: NewVideoProjectDefaults;
  onCreated: (project: VideoProject) => void;
}) {
  const { t } = useLanguage();
  const m = t.video.entry.newProjectDialog;
  const [name, setName] = useState(
    defaults?.name ?? t.video.entry.defaultProjectName,
  );
  const [template, setTemplate] = useState<VideoTemplateId>(
    defaults?.template ?? 'slideshow',
  );
  const [aspectRatio, setAspectRatio] = useState<VideoAspectRatio>(
    defaults?.aspectRatio ?? '16:9',
  );
  const [prompt, setPrompt] = useState(defaults?.prompt ?? '');
  const [busy, setBusy] = useState(false);

  // Re-seed only when the caller hands the form a fresh `defaults` object (e.g.
  // a routed `?new=1&prompt=...` entry). Guarded on `defaults` so ordinary
  // re-renders never clobber what the user has typed.
  useEffect(() => {
    if (!defaults) return;
    setName(defaults.name ?? t.video.entry.defaultProjectName);
    setTemplate(defaults.template ?? 'slideshow');
    setAspectRatio(defaults.aspectRatio ?? '16:9');
    setPrompt(defaults.prompt ?? '');
  }, [defaults, t.video.entry.defaultProjectName]);

  const submit = async () => {
    if (busy) return;
    const trimmedName = name.trim() || t.video.entry.defaultProjectName;
    const trimmedPrompt = prompt.trim();
    setBusy(true);
    try {
      const result = await createVideoProject({
        name: trimmedName,
        template,
        aspectRatio,
        ...(trimmedPrompt ? { prompt: trimmedPrompt } : {}),
      });
      onCreated(result.project);
    } catch (err) {
      toast.error(
        m.createFailed.replace(
          '{message}',
          err instanceof Error ? err.message : String(err),
        ),
      );
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-4">
      <Field label={m.nameLabel} htmlFor="video-project-name">
        <input
          id="video-project-name"
          data-testid="video-project-name-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void submit();
            }
          }}
          maxLength={160}
          placeholder={t.video.entry.defaultProjectName}
          className="border-input bg-background focus-visible:ring-ring h-10 w-full rounded-md border px-3 text-sm focus-visible:ring-1 focus-visible:outline-none"
        />
      </Field>

      <Field label={m.templateLabel}>
        <div className="flex flex-wrap gap-2">
          {TEMPLATE_OPTIONS.map((id) => (
            <Chip
              key={id}
              active={template === id}
              onClick={() => setTemplate(id)}
              label={t.video.templates[id]}
            />
          ))}
        </div>
      </Field>

      <Field label={m.aspectRatioLabel}>
        <div className="flex flex-wrap gap-2">
          {ASPECT_OPTIONS.map((ar) => (
            <Chip
              key={ar}
              active={aspectRatio === ar}
              onClick={() => setAspectRatio(ar)}
              label={ar}
            />
          ))}
        </div>
      </Field>

      <Field label={m.promptLabel} htmlFor="video-project-prompt">
        <textarea
          id="video-project-prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          maxLength={5000}
          rows={3}
          placeholder={m.promptPlaceholder}
          className="border-input bg-background focus-visible:ring-ring min-h-20 w-full resize-y rounded-md border px-3 py-2 text-sm focus-visible:ring-1 focus-visible:outline-none"
        />
      </Field>

      <div className="flex justify-end">
        <Button type="button" onClick={() => void submit()} disabled={busy}>
          {busy ? m.creating : m.create}
        </Button>
      </div>
    </div>
  );
}

interface FieldProps {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
}

function Field({ label, htmlFor, children }: FieldProps) {
  return (
    <div className="grid gap-1.5">
      <label
        htmlFor={htmlFor}
        className="text-foreground text-xs font-medium tracking-wide uppercase"
      >
        {label}
      </label>
      {children}
    </div>
  );
}

interface ChipProps {
  active: boolean;
  onClick: () => void;
  label: string;
}

function Chip({ active, onClick, label }: ChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? 'border-primary bg-primary text-primary-foreground rounded-full border px-3 py-1 text-xs font-medium'
          : 'border-input bg-background hover:bg-accent rounded-full border px-3 py-1 text-xs font-medium'
      }
    >
      {label}
    </button>
  );
}
