import { useMemo, useState } from 'react';

import { useLanguage } from '@/shared/providers/language-provider';
import type { VideoTemplate } from '@/shared/types/video';

interface TemplateUseFormProps {
  template: VideoTemplate;
  busy?: boolean;
  onUse: (inputs: Record<string, unknown>) => Promise<void>;
}

export function TemplateUseForm({
  template,
  busy,
  onUse,
}: TemplateUseFormProps) {
  const { t } = useLanguage();
  const initialInputs = useMemo(
    () =>
      Object.fromEntries(
        template.inputs.map((input) => [input.key, input.default ?? '']),
      ),
    [template],
  );
  const [inputs, setInputs] = useState<Record<string, unknown>>(initialInputs);
  const [error, setError] = useState<string | null>(null);

  const missingRequired = template.inputs.some(
    (input) => input.required && !String(inputs[input.key] ?? '').trim(),
  );

  return (
    <div className="space-y-3">
      {template.inputs.map((input) => (
        <label key={input.key} className="block space-y-1 text-xs">
          <span className="text-muted-foreground">
            {input.label}
            {input.required ? ` ${t.video.templates.form.required}` : ''}
          </span>
          {input.kind === 'longText' ? (
            <textarea
              value={String(inputs[input.key] ?? '')}
              onChange={(event) =>
                setInputs((prev) => ({
                  ...prev,
                  [input.key]: event.target.value,
                }))
              }
              className="border-input bg-background text-foreground min-h-20 w-full rounded-md border px-3 py-2"
            />
          ) : input.kind === 'enum' ? (
            <select
              value={String(inputs[input.key] ?? '')}
              onChange={(event) =>
                setInputs((prev) => ({
                  ...prev,
                  [input.key]: event.target.value,
                }))
              }
              className="border-input bg-background text-foreground w-full rounded-md border px-3 py-2"
            >
              {(input.enum ?? []).map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          ) : (
            <input
              type={
                input.kind === 'number'
                  ? 'number'
                  : input.kind === 'color'
                    ? 'color'
                    : 'text'
              }
              value={String(inputs[input.key] ?? '')}
              onChange={(event) =>
                setInputs((prev) => ({
                  ...prev,
                  [input.key]:
                    input.kind === 'number'
                      ? Number(event.target.value)
                      : event.target.value,
                }))
              }
              className="border-input bg-background text-foreground w-full rounded-md border px-3 py-2"
            />
          )}
        </label>
      ))}
      <button
        type="button"
        disabled={busy || missingRequired}
        className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-3 py-2 text-xs font-medium disabled:opacity-60"
        onClick={async () => {
          setError(null);
          try {
            await onUse(inputs);
          } catch (err) {
            setError(
              err instanceof Error
                ? err.message
                : t.video.templates.form.failed,
            );
          }
        }}
      >
        {missingRequired
          ? t.video.templates.form.fillAllToContinue
          : t.video.templates.detail.useTemplate}
      </button>
      {error ? <p className="text-destructive text-xs">{error}</p> : null}
    </div>
  );
}
