import { useRef } from 'react';

import type { FormField } from '@/shared/video/useFormSpec';

import { FieldShell } from './FieldShell';
import type { RecursiveControlProps, VariableValue } from './types';

type FieldsetField = Extract<FormField, { kind: 'fieldset' }>;

// Follow-up to Slice K — fieldset control: a nested object of sub-fields,
// rendered via the injected `renderField` (no import cycle with the dispatcher).

function toObject(value: VariableValue): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function ControlFieldset({
  field,
  value,
  onChange,
  disabled,
  renderField,
}: RecursiveControlProps<FieldsetField>) {
  const obj = toObject(value);
  // Read the current object in onChange so two sub-field updates in one batch
  // don't spread a stale snapshot and drop the first write.
  const valueRef = useRef(value);
  valueRef.current = value;
  return (
    <FieldShell field={field}>
      <div className="border-border space-y-2 rounded border border-dashed p-2">
        {field.fields.map((sub) => (
          <div key={sub.key}>
            {renderField({
              field: sub,
              value: (obj[sub.key] ?? null) as VariableValue,
              onChange: (next) =>
                onChange({ ...toObject(valueRef.current), [sub.key]: next }),
              disabled,
            })}
          </div>
        ))}
      </div>
    </FieldShell>
  );
}
