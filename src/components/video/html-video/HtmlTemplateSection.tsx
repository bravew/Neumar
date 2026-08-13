import { useEffect, useRef, useState } from 'react';

import { HtmlFramePreview } from '@/components/artifacts/live/HtmlFramePreview';
import { EnginePicker } from '@/components/video/EnginePicker';
import { TemplatePicker } from '@/components/video/TemplatePicker';
import type { VariableMap } from '@/components/video/variable-form/types';
import { VariableForm } from '@/components/video/VariableForm';
import { useLanguage } from '@/shared/providers/language-provider';
import { useFormSpec } from '@/shared/video/useFormSpec';
import { useHtmlGallery } from '@/shared/video/useHtmlGallery';
import { useHtmlSelection } from '@/shared/video/useHtmlSelection';
import { useTemplateSource } from '@/shared/video/useTemplateSource';

// Slice K — HTML template authoring: pick a gallery template, fill its
// schema-driven variables (debounced-persisted), and live-preview the frame.

const SAVE_DEBOUNCE_MS = 400;

/** Narrow the API's `Record<string, unknown>` to the form's VariableMap. */
function toVariableMap(value: Record<string, unknown>): VariableMap {
  const out: VariableMap = {};
  for (const [key, v] of Object.entries(value)) {
    if (
      v === null ||
      typeof v === 'string' ||
      typeof v === 'number' ||
      typeof v === 'boolean' ||
      Array.isArray(v) ||
      typeof v === 'object'
    ) {
      out[key] = v as VariableMap[string];
    }
  }
  return out;
}

export function HtmlTemplateSection({ projectId }: { projectId: string }) {
  const { t } = useLanguage();
  const g = t.video.htmlGallery;
  const gallery = useHtmlGallery();
  const { selection, error, setTemplate, setVariables } =
    useHtmlSelection(projectId);
  const templateId = selection.templateId;
  const selectedTemplate = gallery.templates.find(
    (template) => template.id === templateId,
  );
  const htmlTemplateId =
    selectedTemplate?.metadata.engine === 'html' ? templateId : null;
  const { formSpec } = useFormSpec(templateId);
  const { html } = useTemplateSource(htmlTemplateId);

  const [draft, setDraft] = useState<VariableMap>(
    toVariableMap(selection.variables),
  );
  useEffect(() => {
    setDraft(toVariableMap(selection.variables));
  }, [selection.variables, templateId]);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const handleVariableChange = (next: VariableMap) => {
    setDraft(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      // Errors surface via the hook's `error` state; swallow the rejection here
      // so the debounce callback never produces an unhandled rejection.
      void setVariables(next).catch(() => undefined);
    }, SAVE_DEBOUNCE_MS);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-foreground text-sm font-medium">
          {g.templatesTitle}
        </h3>
        <EnginePicker label={g.engineLabel} />
      </div>
      {gallery.loading ? (
        <p className="text-muted-foreground text-xs">{g.loading}</p>
      ) : gallery.error ? (
        <p className="text-destructive text-xs">
          {g.loadError.replace('{error}', gallery.error)}
        </p>
      ) : (
        <TemplatePicker
          selectedId={templateId}
          onSelect={(tpl) => void setTemplate(tpl.id).catch(() => undefined)}
        />
      )}

      {error ? (
        <p className="text-destructive text-xs">
          {g.saveError.replace('{error}', error)}
        </p>
      ) : null}

      {templateId && formSpec ? (
        <VariableForm
          formSpec={formSpec}
          values={draft}
          onChange={handleVariableChange}
        />
      ) : (
        <p className="text-muted-foreground text-xs">{g.noTemplateSelected}</p>
      )}

      {templateId && html ? (
        <HtmlFramePreview
          rawHtml={html}
          variables={draft}
          identity={templateId}
          title={g.previewTitle}
        />
      ) : null}
    </div>
  );
}
