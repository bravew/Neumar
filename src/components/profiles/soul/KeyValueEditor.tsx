import { useCallback, useRef, useState } from 'react';

import { Plus, Trash2 } from 'lucide-react';

import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

import { SOUL_INPUT_CLASS } from './soul-constants';

// ============================================================================
// KeyValueEditor — add/remove key-value rows
// ============================================================================

export interface KeyValueEditorProps {
  entries: Record<string, string>;
  onChange: (entries: Record<string, string>) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
}

export function KeyValueEditor({
  entries,
  onChange,
  keyPlaceholder,
  valuePlaceholder,
}: KeyValueEditorProps) {
  const { t } = useLanguage();
  const resolvedKeyPlaceholder = keyPlaceholder ?? t.profiles.soulModeName;
  const resolvedValuePlaceholder =
    valuePlaceholder ?? t.profiles.soulModeDescription;
  const [newKey, setNewKey] = useState('');
  const [newVal, setNewVal] = useState('');
  const keyRef = useRef<HTMLInputElement>(null);
  const pairs = Object.entries(entries);

  const addEntry = useCallback(() => {
    const trimKey = newKey.trim();
    const trimVal = newVal.trim();
    if (!trimKey) return;
    onChange({ ...entries, [trimKey]: trimVal });
    setNewKey('');
    setNewVal('');
    keyRef.current?.focus();
  }, [newKey, newVal, entries, onChange]);

  const removeEntry = useCallback(
    (key: string) => {
      const next = { ...entries };
      delete next[key];
      onChange(next);
    },
    [entries, onChange],
  );

  const updateValue = useCallback(
    (key: string, value: string) => {
      onChange({ ...entries, [key]: value });
    },
    [entries, onChange],
  );

  return (
    <div className="space-y-1.5">
      {pairs.map(([key, val]) => (
        <div key={key} className="flex items-center gap-1.5">
          <span className="bg-muted text-foreground/80 shrink-0 rounded-md px-2 py-1.5 text-xs font-medium">
            {key}
          </span>
          <input
            type="text"
            value={val}
            onChange={(e) => updateValue(key, e.target.value)}
            className={cn(SOUL_INPUT_CLASS, 'flex-1')}
          />
          <button
            type="button"
            onClick={() => removeEntry(key)}
            className="text-muted-foreground hover:bg-muted hover:text-foreground shrink-0 rounded p-1 transition-colors"
            title={t.profiles.soulRemove}
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      ))}

      {/* Add new entry */}
      <div className="flex items-center gap-1.5">
        <input
          ref={keyRef}
          type="text"
          placeholder={resolvedKeyPlaceholder}
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
          className={cn(SOUL_INPUT_CLASS, 'w-36 shrink-0 border-dashed')}
        />
        <input
          type="text"
          placeholder={resolvedValuePlaceholder}
          value={newVal}
          onChange={(e) => setNewVal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addEntry();
            }
          }}
          className={cn(SOUL_INPUT_CLASS, 'flex-1 border-dashed')}
        />
        <button
          type="button"
          onClick={addEntry}
          disabled={!newKey.trim()}
          className={cn(
            'shrink-0 rounded p-1 transition-colors',
            !newKey.trim()
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
