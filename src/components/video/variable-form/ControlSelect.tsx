import type { FormField } from '@/shared/video/useFormSpec';

import { FieldShell } from './FieldShell';
import type { ControlProps } from './types';

type SelectField = Extract<FormField, { kind: 'select' }>;

export function ControlSelect({
  field,
  value,
  onChange,
  disabled,
}: ControlProps<SelectField>) {
  const stringValue =
    typeof value === 'string' ? value : (field.defaultValue ?? '');
  return (
    <FieldShell field={field}>
      <select
        className="w-full rounded border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        value={stringValue}
        required={field.required}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        aria-label={field.label}
      >
        {!field.required && !stringValue ? <option value="">—</option> : null}
        {field.options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}
