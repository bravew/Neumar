import { useState } from 'react';

import { ChevronDown } from 'lucide-react';

import type { LibraryFile, Task } from '@/shared/db';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

import { FileCard } from './FileCard';

interface TaskFileGroupProps {
  task: Task;
  files: LibraryFile[];
  viewMode: 'grid' | 'list';
  onToggleFavorite?: (fileId: number) => void;
}

/** Default locale used when the language context value is unavailable. */
const DEFAULT_LOCALE = 'en-US';

/**
 * Format a date string using the user's locale for consistent display.
 *
 * `localeCode` maps directly to a BCP 47 tag (e.g. 'en-US', 'zh-CN').
 * Falls back to {@link DEFAULT_LOCALE} when the value is missing so we
 * never pass `undefined` to `toLocaleDateString`.
 */
function formatDate(dateString: string, localeCode: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString(localeCode || DEFAULT_LOCALE, {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  });
}

/** Number of files to show before collapsing into "show more" */
const INITIAL_SHOW_COUNT = 3;

export function TaskFileGroup({
  task,
  files,
  viewMode,
  onToggleFavorite,
}: TaskFileGroupProps) {
  const { language, t, tt } = useLanguage();
  const [isExpanded, setIsExpanded] = useState(true);
  const hasMoreFiles = files.length > INITIAL_SHOW_COUNT;
  const displayFiles = isExpanded ? files : files.slice(0, INITIAL_SHOW_COUNT);

  return (
    <div className="space-y-4">
      {/* Task header */}
      <div className="flex items-center justify-between">
        <h3 className="text-foreground flex-1 truncate text-base font-semibold">
          {task.prompt}
        </h3>
        <span className="text-muted-foreground ml-4 shrink-0 text-sm">
          {formatDate(task.created_at, language)}
        </span>
      </div>

      {/* Files grid/list */}
      <div
        className={cn(
          viewMode === 'grid'
            ? 'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3'
            : 'flex flex-col gap-3',
        )}
      >
        {displayFiles.map((file) => (
          <FileCard
            key={file.id}
            file={file}
            onToggleFavorite={onToggleFavorite}
          />
        ))}
      </div>

      {/* Show more/less button */}
      {hasMoreFiles && (
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          aria-label={isExpanded ? t.common.showLess : t.common.showMore}
          className="text-muted-foreground hover:text-foreground flex cursor-pointer items-center gap-1.5 text-sm transition-colors duration-200"
        >
          <ChevronDown
            className={cn(
              'size-4 transition-transform duration-200',
              isExpanded && 'rotate-180',
            )}
          />
          <span>
            {isExpanded
              ? t.common.showLess
              : tt('common.showMoreCount', {
                  count: files.length - INITIAL_SHOW_COUNT,
                })}
          </span>
        </button>
      )}
    </div>
  );
}
