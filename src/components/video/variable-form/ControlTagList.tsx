import { useState } from 'react';

import { X } from 'lucide-react';

import { cn } from '@/shared/lib/utils';
import type { FormField } from '@/shared/video/useFormSpec';

import { FieldShell } from './FieldShell';
import type { ControlProps } from './types';

type TagListField = Extract<FormField, { kind: 'tagList' }>;

// Slice K — tagList control: add/remove chips. itemType 'number' coerces and
// rejects non-numeric input; the stored value is string[] or number[].

function toItems(value: unknown): Array<string | number> {
  return Array.isArray(value)
    ? value.filter(
        (v): v is string | number =>
          typeof v === 'string' || typeof v === 'number',
      )
    : [];
}

export function ControlTagList({
  field,
  value,
  onChange,
  disabled,
}: ControlProps<TagListField>) {
  const items = toItems(value);
  const [draft, setDraft] = useState('');
  const isNumber = field.itemType === 'number';

  const addItem = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    if (isNumber) {
      const num = Number(trimmed);
      if (!Number.isFinite(num)) return;
      onChange([...(items as number[]), num]);
    } else {
      onChange([...(items as string[]), trimmed]);
    }
    setDraft('');
  };

  const removeAt = (index: number) => {
    onChange(items.filter((_, i) => i !== index) as string[] | number[]);
  };

  return (
    <FieldShell field={field}>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item, index) => (
          <span
            key={`${String(item)}-${index}`}
            className="bg-muted text-foreground inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs"
          >
            {String(item)}
            <button
              type="button"
              disabled={disabled}
              // onMouseDown + preventDefault so the click removes the chip
              // *before* the input's onBlur fires (which would otherwise add the
              // in-progress draft and shift indices).
              onMouseDown={(e) => {
                e.preventDefault();
                removeAt(index);
              }}
              aria-label={`remove ${String(item)}`}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
      </div>
      <input
        type={isNumber ? 'number' : 'text'}
        className={cn(
          'mt-1 w-full rounded border border-zinc-300 bg-white px-2 py-1 text-sm',
          'dark:border-zinc-700 dark:bg-zinc-900',
        )}
        value={draft}
        disabled={disabled}
        aria-label={field.label}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            addItem();
          }
        }}
        onBlur={addItem}
      />
    </FieldShell>
  );
}
