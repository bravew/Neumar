import { useCallback, useRef, useState } from 'react';

import { X } from 'lucide-react';

import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

// ============================================================================
// TagInput — type + Enter to add tags
// ============================================================================

export interface TagInputProps {
  tags: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
}

export function TagInput({ tags, onChange, placeholder }: TagInputProps) {
  const { t } = useLanguage();
  const resolvedPlaceholder = placeholder ?? t.profiles.soulTypeAndEnter;
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const addTag = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || tags.includes(trimmed)) return;
    onChange([...tags, trimmed]);
    setValue('');
  }, [value, tags, onChange]);

  const removeTag = useCallback(
    (index: number) => {
      onChange(tags.filter((_, i) => i !== index));
    },
    [tags, onChange],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addTag();
      }
      if (e.key === 'Backspace' && !value && tags.length > 0) {
        removeTag(tags.length - 1);
      }
    },
    [addTag, removeTag, value, tags.length],
  );

  return (
    <div
      className={cn(
        'bg-muted/50 border-border focus-within:border-primary/50 flex flex-wrap items-center gap-1.5 rounded-lg border px-2 py-1.5 transition-colors',
      )}
      onClick={() => inputRef.current?.focus()}
    >
      {tags.map((tag, i) => (
        <span
          key={tag}
          className="bg-primary/10 text-primary inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium"
        >
          {tag}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              removeTag(i);
            }}
            className="hover:text-primary/70 transition-colors"
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={tags.length === 0 ? resolvedPlaceholder : ''}
        className="min-w-[120px] flex-1 bg-transparent text-sm outline-none"
      />
    </div>
  );
}
