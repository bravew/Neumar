import { useRef } from 'react';

import { Plus, X } from 'lucide-react';

import { useLanguage } from '@/shared/providers/language-provider';
import { randomUUID } from '@/shared/utils/uuid';
import type { FormField } from '@/shared/video/useFormSpec';

import { FieldShell } from './FieldShell';
import type { RecursiveControlProps, VariableValue } from './types';

type TableField = Extract<FormField, { kind: 'table' }>;

// Follow-up to Slice K — table control: rows of column sub-fields (each row a
// record keyed by column.key), rendered via the injected `renderField`.
// minItems/maxItems gate the remove/add buttons.

function toRows(value: VariableValue): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? (value as Array<Record<string, unknown>>).filter(
        (r): r is Record<string, unknown> =>
          Boolean(r) && typeof r === 'object' && !Array.isArray(r),
      )
    : [];
}

export function ControlTable({
  field,
  value,
  onChange,
  disabled,
  renderField,
}: RecursiveControlProps<TableField>) {
  const { t } = useLanguage();
  const g = t.video.htmlGallery;
  const rows = toRows(value);
  const minItems = field.minItems ?? 0;
  const atMax = field.maxItems != null && rows.length >= field.maxItems;

  // Read the current value in handlers (not the render-time `rows` closure) so a
  // batched/async sequence of edits never spreads stale state.
  const valueRef = useRef(value);
  valueRef.current = value;

  // Stable per-row keys kept OUT of the persisted data (a `__rowId` in the row
  // object would leak into the saved template variables). Managed alongside the
  // structural ops; the render-time block resyncs length on external loads.
  const idsRef = useRef<string[]>([]);
  if (idsRef.current.length !== rows.length) {
    const next = idsRef.current.slice(0, rows.length);
    while (next.length < rows.length) next.push(randomUUID());
    idsRef.current = next;
  }

  const addRow = () => {
    idsRef.current = [...idsRef.current, randomUUID()];
    onChange([...toRows(valueRef.current), {}]);
  };
  const removeRow = (index: number) => {
    idsRef.current = idsRef.current.filter((_, i) => i !== index);
    onChange(toRows(valueRef.current).filter((_, i) => i !== index));
  };
  const setCell = (index: number, key: string, next: VariableValue) =>
    onChange(
      toRows(valueRef.current).map((r, i) =>
        i === index ? { ...r, [key]: next } : r,
      ),
    );

  return (
    <FieldShell field={field}>
      <div className="space-y-2">
        {rows.map((row, index) => (
          <div
            key={idsRef.current[index] ?? String(index)}
            className="border-border flex items-start gap-2 rounded border p-2"
          >
            <div className="flex-1 space-y-2">
              {field.columns.map((col) => (
                <div key={col.key}>
                  {renderField({
                    field: col,
                    value: (row[col.key] ?? null) as VariableValue,
                    onChange: (next) => setCell(index, col.key, next),
                    disabled,
                  })}
                </div>
              ))}
            </div>
            <button
              type="button"
              disabled={disabled || rows.length <= minItems}
              onClick={() => removeRow(index)}
              aria-label={g.removeRow}
              className="text-muted-foreground hover:text-foreground disabled:opacity-40"
            >
              <X className="size-4" />
            </button>
          </div>
        ))}
        <button
          type="button"
          disabled={disabled || atMax}
          onClick={addRow}
          className="border-border text-muted-foreground hover:bg-accent inline-flex items-center gap-1 rounded border px-2 py-1 text-xs disabled:opacity-40"
        >
          <Plus className="size-3" />
          {g.addRow}
        </button>
      </div>
    </FieldShell>
  );
}
