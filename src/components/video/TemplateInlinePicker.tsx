import { useState } from 'react';

import { useNavigate } from 'react-router-dom';

import { Sparkles } from 'lucide-react';

import {
  createVideoProjectFromTemplate,
  useVideoTemplates,
} from '@/shared/hooks/useVideoProject';
import { useLanguage } from '@/shared/providers/language-provider';
import type { VideoProject, VideoTemplate } from '@/shared/types/video';

import { TemplateUseForm } from './TemplateUseForm';

interface TemplateInlinePickerProps {
  onApply?: (
    templateId: string,
    inputs: Record<string, unknown>,
    name?: string,
  ) => Promise<VideoProject | null>;
  onApplied?: (project: VideoProject) => void;
}

export function TemplateInlinePicker({
  onApply,
  onApplied,
}: TemplateInlinePickerProps = {}) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { templates, loading, error } = useVideoTemplates();
  const [selectedId, setSelectedId] = useState('');
  const [busy, setBusy] = useState(false);
  const selected = templates.find((template) => template.id === selectedId);

  const handleTemplateUse = async (
    template: VideoTemplate,
    inputs: Record<string, unknown>,
  ) => {
    setBusy(true);
    try {
      if (onApply) {
        const project = await onApply(
          template.id,
          inputs,
          template.displayName,
        );
        if (project) onApplied?.(project);
        return;
      }
      const result = await createVideoProjectFromTemplate({
        templateId: template.id,
        inputs,
        name: template.displayName,
      });
      navigate(`/video/${result.project.id}?step=board`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="border-border bg-background rounded-md border p-3">
      <div className="text-muted-foreground flex items-center gap-2 text-xs">
        <Sparkles className="size-4" />
        <span>{t.video.templates.library.inlineTitle}</span>
      </div>
      {loading ? (
        <p className="text-muted-foreground mt-3 text-xs">
          {t.video.templates.library.loading}
        </p>
      ) : error ? (
        <p className="text-destructive mt-3 text-xs">{error}</p>
      ) : (
        <div className="mt-3 space-y-3">
          <select
            value={selectedId}
            onChange={(event) => setSelectedId(event.target.value)}
            className="border-input bg-background text-foreground w-full rounded-md border px-3 py-2 text-xs"
          >
            <option value="">{t.video.templates.library.pickTemplate}</option>
            {templates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.displayName}
              </option>
            ))}
          </select>
          {selected ? (
            <TemplateUseForm
              key={selected.id}
              template={selected}
              busy={busy}
              onUse={(inputs) => handleTemplateUse(selected, inputs)}
            />
          ) : null}
        </div>
      )}
    </section>
  );
}
