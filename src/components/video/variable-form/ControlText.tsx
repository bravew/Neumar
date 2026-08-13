import type { FormField } from '@/shared/video/useFormSpec';

import { FieldShell } from './FieldShell';
import type { ControlProps } from './types';

type TextField = Extract<FormField, { kind: 'text' }>;

export function ControlText({
  field,
  value,
  onChange,
  disabled,
}: ControlProps<TextField>) {
  const stringValue = typeof value === 'string' ? value : '';
  return (
    <FieldShell field={field}>
      <input
        type="text"
        className="w-full rounded border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        value={stringValue}
        maxLength={field.maxLength}
        pattern={field.pattern}
        required={field.required}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        aria-label={field.label}
      />
    </FieldShell>
  );
}

export function ControlTextarea({
  field,
  value,
  onChange,
  disabled,
}: ControlProps<Extract<FormField, { kind: 'textarea' }>>) {
  const stringValue = typeof value === 'string' ? value : '';
  return (
    <FieldShell field={field}>
      <textarea
        className="w-full rounded border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        rows={3}
        value={stringValue}
        maxLength={field.maxLength}
        required={field.required}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        aria-label={field.label}
      />
    </FieldShell>
  );
}
