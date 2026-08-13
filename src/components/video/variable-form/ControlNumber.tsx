import type { FormField } from '@/shared/video/useFormSpec';

import { FieldShell } from './FieldShell';
import type { ControlProps } from './types';

type NumberField = Extract<FormField, { kind: 'number' }>;

export function ControlNumber({
  field,
  value,
  onChange,
  disabled,
}: ControlProps<NumberField>) {
  const numericValue =
    typeof value === 'number'
      ? value
      : typeof field.defaultValue === 'number'
        ? field.defaultValue
        : '';
  return (
    <FieldShell field={field}>
      <input
        type="number"
        className="w-full rounded border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        value={numericValue === '' ? '' : String(numericValue)}
        min={field.minimum}
        max={field.maximum}
        step={field.integer ? 1 : 'any'}
        required={field.required}
        disabled={disabled}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === '') {
            onChange(null);
            return;
          }
          const parsed = field.integer ? parseInt(raw, 10) : parseFloat(raw);
          if (Number.isFinite(parsed)) onChange(parsed);
        }}
        aria-label={field.label}
      />
    </FieldShell>
  );
}
