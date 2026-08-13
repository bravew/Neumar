import { useLanguage } from '@/shared/providers/language-provider';
import type { FormSpec } from '@/shared/video/useFormSpec';

import { renderField } from './variable-form/renderField';
import type { VariableMap, VariableValue } from './variable-form/types';

// Phase 6 M2 / Slice K — schema-driven variable form. Every FormField kind is
// wired; the per-kind dispatch + recursive controls live in `renderField`.

interface VariableFormProps {
  formSpec: FormSpec;
  values: VariableMap;
  onChange: (next: VariableMap) => void;
  disabled?: boolean;
}

export function VariableForm({
  formSpec,
  values,
  onChange,
  disabled,
}: VariableFormProps) {
  const { t } = useLanguage();
  const handleChange = (key: string, next: VariableValue) => {
    onChange({ ...values, [key]: next });
  };

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => e.preventDefault()}
      aria-label={t.video.htmlGallery.variablesLabel}
    >
      {formSpec.warnings.length > 0 ? (
        <div className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
          {formSpec.warnings[0]}
          {formSpec.warnings.length > 1
            ? ` (+${formSpec.warnings.length - 1} more)`
            : ''}
        </div>
      ) : null}
      {formSpec.fields.map((field) => (
        <div key={field.key}>
          {renderField({
            field,
            value: values[field.key] ?? null,
            onChange: (v) => handleChange(field.key, v),
            disabled,
          })}
        </div>
      ))}
    </form>
  );
}
