/**
 * Combobox — typeahead input with dropdown suggestions.
 * Used for Role and other free-text fields with preset options.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Check, ChevronDown } from 'lucide-react';

import { cn } from '@/shared/lib/utils';

const INPUT_CLASS =
  'bg-background border-input text-foreground placeholder:text-muted-foreground w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/40 focus:border-ring';

export interface ComboOption {
  value: string;
  label: string;
  description?: string;
}

export function Combobox({
  value,
  onChange,
  options,
  placeholder,
  allowCustom = true,
}: {
  value: string;
  onChange: (val: string) => void;
  options: ComboOption[];
  placeholder?: string;
  allowCustom?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [highlightIdx, setHighlightIdx] = useState(-1);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        o.value.toLowerCase().includes(q) ||
        o.description?.toLowerCase().includes(q),
    );
  }, [query, options]);

  useEffect(() => {
    setHighlightIdx(-1);
  }, [filtered]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleSelect = useCallback(
    (val: string) => {
      onChange(val);
      setQuery('');
      setOpen(false);
      inputRef.current?.blur();
    },
    [onChange],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setOpen(true);
        setHighlightIdx((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlightIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter' && open) {
        e.preventDefault();
        if (highlightIdx >= 0 && highlightIdx < filtered.length) {
          handleSelect(filtered[highlightIdx].value);
        } else if (allowCustom && query.trim()) {
          handleSelect(query.trim());
        }
      } else if (e.key === 'Escape') {
        setOpen(false);
        setQuery('');
      }
    },
    [open, highlightIdx, filtered, handleSelect, allowCustom, query],
  );

  const selectedOption = options.find((o) => o.value === value);
  const displayValue = open ? query : selectedOption?.label || value;

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={displayValue}
          placeholder={placeholder}
          onChange={(e) => {
            setQuery(e.target.value);
            if (allowCustom) onChange(e.target.value);
            if (!open) setOpen(true);
          }}
          onFocus={() => {
            setQuery('');
            setOpen(true);
          }}
          onKeyDown={handleKeyDown}
          className={cn(INPUT_CLASS, 'pr-8')}
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => {
            if (open) {
              setOpen(false);
            } else {
              setQuery('');
              setOpen(true);
              inputRef.current?.focus();
            }
          }}
          className="text-muted-foreground absolute top-1/2 right-2.5 -translate-y-1/2"
        >
          <ChevronDown
            className={cn(
              'size-3.5 transition-transform',
              open && 'rotate-180',
            )}
          />
        </button>
      </div>

      {open && filtered.length > 0 && (
        <div className="border-border bg-popover absolute z-50 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border py-1 shadow-lg">
          {filtered.map((opt, i) => (
            <button
              key={opt.value}
              type="button"
              onMouseEnter={() => setHighlightIdx(i)}
              onClick={() => handleSelect(opt.value)}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors',
                i === highlightIdx
                  ? 'bg-accent text-accent-foreground'
                  : 'hover:bg-accent/50',
              )}
            >
              <div className="min-w-0 flex-1">
                <span className="text-foreground block truncate text-sm">
                  {opt.label}
                </span>
                {opt.description && (
                  <span className="text-muted-foreground block truncate text-xs">
                    {opt.description}
                  </span>
                )}
              </div>
              {opt.value === value && (
                <Check className="text-foreground size-3.5 shrink-0" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
