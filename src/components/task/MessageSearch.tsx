import { useCallback, useEffect, useRef, useState } from 'react';

import { Search, X } from 'lucide-react';

import { searchMessages } from '@/shared/db/database';
import type { Message } from '@/shared/db/types';
import { useLanguage } from '@/shared/providers/language-provider';

const DEBOUNCE_MS = 300;

interface MessageSearchProps {
  taskId: string;
  onSelectResult: (messageId: number) => void;
  onClose: () => void;
}

export function MessageSearch({
  taskId,
  onSelectResult,
  onClose,
}: MessageSearchProps) {
  const { t } = useLanguage();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Message[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Cleanup debounce and mounted flag on unmount
  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const handleSearch = useCallback(
    (value: string) => {
      setQuery(value);
      if (debounceRef.current) clearTimeout(debounceRef.current);

      if (!value.trim()) {
        setResults([]);
        return;
      }

      debounceRef.current = setTimeout(async () => {
        if (!mountedRef.current) return;
        setIsSearching(true);
        try {
          const msgs = await searchMessages(taskId, value.trim());
          if (!mountedRef.current) return;
          setResults(msgs);
        } catch {
          if (!mountedRef.current) return;
          setResults([]);
        } finally {
          if (mountedRef.current) setIsSearching(false);
        }
      }, DEBOUNCE_MS);
    },
    [taskId],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    },
    [onClose],
  );

  return (
    <div className="border-border bg-background absolute top-0 right-0 left-0 z-10 border-b p-2 shadow-sm">
      <div className="flex items-center gap-2">
        <Search className="text-muted-foreground size-4 shrink-0" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => handleSearch(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t.task.searchPlaceholder}
          className="flex-1 bg-transparent text-sm outline-none"
        />
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground cursor-pointer rounded p-1 transition-colors"
          aria-label={t.common.close}
        >
          <X className="size-4" />
        </button>
      </div>

      {/* Results */}
      {query.trim() && (
        <div className="mt-2 max-h-48 overflow-y-auto">
          {isSearching ? (
            <p className="text-muted-foreground px-2 py-1 text-xs">
              {t.task.searchMessages}...
            </p>
          ) : results.length === 0 ? (
            <p className="text-muted-foreground px-2 py-1 text-xs">
              {t.task.searchNoResults}
            </p>
          ) : (
            results.map((msg) => (
              <button
                key={msg.id}
                onClick={() => onSelectResult(msg.id)}
                className="hover:bg-muted w-full cursor-pointer rounded px-2 py-1.5 text-left text-xs transition-colors"
              >
                <span className="text-muted-foreground mr-2 font-mono">
                  {msg.type}
                </span>
                <span className="line-clamp-1">
                  {msg.content?.slice(0, 120)}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
