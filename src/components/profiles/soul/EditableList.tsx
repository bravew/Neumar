import { useCallback, useMemo, useRef, useState } from 'react';

import { Plus, Trash2 } from 'lucide-react';

import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

import { SOUL_INPUT_CLASS } from './soul-constants';

/** Generate stable keys for string list items (content + first-occurrence index). */
function stableKeys(items: string[]): string[] {
  const seen = new Map<string, number>();
  return items.map((item) => {
    const count = seen.get(item) ?? 0;
    seen.set(item, count + 1);
    return `${item}::${count}`;
  });
}

// ============================================================================
// EditableList
// ============================================================================

export interface EditableListProps {
  items: string[];
  onChange: (items: string[]) => void;
  placeholder?: string;
  minItems?: number;
  /** Apply red/warning styling to items (used for red_lines) */
  variant?: 'default' | 'danger';
}

export function EditableList({
  items,
  onChange,
  placeholder,
  minItems = 0,
  variant = 'default',
}: EditableListProps) {
  const { t } = useLanguage();
  const resolvedPlaceholder = placeholder ?? t.profiles.soulAddItem;
  const [newValue, setNewValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const addItem = useCallback(() => {
    const trimmed = newValue.trim();
    if (!trimmed) return;
    onChange([...items, trimmed]);
    setNewValue('');
    inputRef.current?.focus();
  }, [newValue, items, onChange]);

  const removeItem = useCallback(
    (index: number) => {
      if (items.length <= minItems) return;
      onChange(items.filter((_, i) => i !== index));
    },
    [items, minItems, onChange],
  );

  const updateItem = useCallback(
    (index: number, value: string) => {
      const next = [...items];
      next[index] = value;
      onChange(next);
    },
    [items, onChange],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addItem();
      }
    },
    [addItem],
  );

  const isDanger = variant === 'danger';
  const keys = useMemo(() => stableKeys(items), [items]);

  return (
    <div className="space-y-1.5">
      {/* Existing items */}
      {items.map((item, i) => (
        <div key={keys[i]} className="flex items-center gap-1.5">
          <input
            type="text"
            value={item}
            onChange={(e) => updateItem(i, e.target.value)}
            className={cn(
              SOUL_INPUT_CLASS,
              isDanger &&
                'border-red-500/30 bg-red-500/5 focus:border-red-500/50',
            )}
          />
          <button
            type="button"
            onClick={() => removeItem(i)}
            disabled={items.length <= minItems}
            className={cn(
              'shrink-0 rounded p-1 transition-colors',
              items.length <= minItems
                ? 'text-muted-foreground/30 cursor-not-allowed'
                : isDanger
                  ? 'text-red-400 hover:bg-red-500/10 hover:text-red-300'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
            title={t.profiles.soulRemove}
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      ))}

      {/* Add new item */}
      <div className="flex items-center gap-1.5">
        <input
          ref={inputRef}
          type="text"
          placeholder={resolvedPlaceholder}
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          onKeyDown={handleKeyDown}
          className={cn(SOUL_INPUT_CLASS, 'border-dashed')}
        />
        <button
          type="button"
          onClick={addItem}
          disabled={!newValue.trim()}
          className={cn(
            'shrink-0 rounded p-1 transition-colors',
            !newValue.trim()
              ? 'text-muted-foreground/30 cursor-not-allowed'
              : 'text-primary hover:bg-primary/10',
          )}
          title={t.profiles.soulAdd}
        >
          <Plus className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
