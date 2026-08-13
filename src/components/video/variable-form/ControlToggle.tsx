import type { FormField } from '@/shared/video/useFormSpec';

import { FieldShell } from './FieldShell';
import type { ControlProps } from './types';

type ToggleField = Extract<FormField, { kind: 'toggle' }>;

export function ControlToggle({
  field,
  value,
  onChange,
  disabled,
}: ControlProps<ToggleField>) {
  const checked =
    typeof value === 'boolean' ? value : Boolean(field.defaultValue);
  return (
    <FieldShell field={field}>
      <input
        type="checkbox"
        className="h-4 w-4 rounded border-zinc-300"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={field.label}
      />
    </FieldShell>
  );
}
