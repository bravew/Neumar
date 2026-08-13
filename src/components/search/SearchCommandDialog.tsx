import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { router } from '@/app/router';
import { getTaskIcon } from '@/components/layout/sidebar/utils';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import type { Task } from '@/shared/db';
import { getAllTasks, searchTasks } from '@/shared/db/database';
import { useShortcut } from '@/shared/hotkeys/useShortcut';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import { DESIGN_MEDIA_TASK_PREFIX } from '@/shared/types/design-mode';

const DEBOUNCE_MS = 300;
const MAX_RESULTS = 50;

type TimePeriod = 'today' | 'yesterday' | 'pastWeek' | 'pastMonth' | 'older';

function getTimePeriod(dateStr: string): TimePeriod {
  const date = new Date(dateStr.replace(' ', 'T') + 'Z');
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 7);
  const monthAgo = new Date(today);
  monthAgo.setMonth(monthAgo.getMonth() - 1);

  if (date >= today) return 'today';
  if (date >= yesterday) return 'yesterday';
  if (date >= weekAgo) return 'pastWeek';
  if (date >= monthAgo) return 'pastMonth';
  return 'older';
}

function groupTasksByTime(
  tasks: Task[],
  labels: Record<TimePeriod, string>,
): { label: string; tasks: Task[] }[] {
  const groups = new Map<TimePeriod, Task[]>();
  const order: TimePeriod[] = [
    'today',
    'yesterday',
    'pastWeek',
    'pastMonth',
    'older',
  ];

  for (const task of tasks) {
    const period = getTimePeriod(task.updated_at ?? task.created_at);
    const existing = groups.get(period);
    if (existing) {
      existing.push(task);
    } else {
      groups.set(period, [task]);
    }
  }

  const result: { label: string; tasks: Task[] }[] = [];
  for (const period of order) {
    const periodTasks = groups.get(period);
    if (periodTasks && periodTasks.length > 0) {
      result.push({ label: labels[period], tasks: periodTasks });
    }
  }
  return result;
}

export function SearchCommandDialog() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const { t } = useLanguage();
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const timeLabels = useMemo<Record<TimePeriod, string>>(
    () => ({
      today: t.nav.searchToday,
      yesterday: t.nav.searchYesterday,
      pastWeek: t.nav.searchPastWeek,
      pastMonth: t.nav.searchPastMonth,
      older: t.nav.searchOlder,
    }),
    [t.nav],
  );

  useShortcut({
    id: 'palette.search',
    chord: 'mod+k',
    scope: 'global',
    descriptionKey: 'shortcuts.paletteSearch.description',
    group: 'navigation',
    handler: () => setOpen((prev) => !prev),
  });

  // Listen for custom event from sidebar
  useEffect(() => {
    const handleOpenSearch = () => setOpen(true);
    window.addEventListener('open-search', handleOpenSearch);
    return () => window.removeEventListener('open-search', handleOpenSearch);
  }, []);

  // Load recent tasks when opening with no query
  useEffect(() => {
    if (!open) return;

    if (!query) {
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      getAllTasks({ signal: controller.signal })
        .then((tasks) => {
          if (!controller.signal.aborted) {
            setResults(
              tasks
                .filter((task) => !task.id.startsWith(DESIGN_MEDIA_TASK_PREFIX))
                .slice(0, MAX_RESULTS),
            );
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setResults([]);
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setLoading(false);
          }
        });

      return () => controller.abort();
    }
  }, [open, query]);

  // Debounced search
  const handleSearch = useCallback((value: string) => {
    setQuery(value);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (abortRef.current) abortRef.current.abort();

    if (!value.trim()) return;

    debounceRef.current = setTimeout(() => {
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);

      searchTasks(value, { limit: MAX_RESULTS, signal: controller.signal })
        .then((tasks) => {
          if (!controller.signal.aborted) {
            setResults(tasks);
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setResults([]);
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setLoading(false);
          }
        });
    }, DEBOUNCE_MS);
  }, []);

  const handleSelect = useCallback((taskId: string) => {
    setOpen(false);
    router.navigate(`/task-v2/${taskId}`, {
      viewTransition: true,
      state: null,
    });
  }, []);

  // Cleanup debounce timer and abort controller on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (abortRef.current) abortRef.current.abort();
    };
  }, []);

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      setQuery('');
      setResults([]);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (abortRef.current) abortRef.current.abort();
    }
  }, [open]);

  const grouped = useMemo(
    () => groupTasksByTime(results, timeLabels),
    [results, timeLabels],
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="overflow-hidden p-0 shadow-lg sm:max-w-lg">
        <DialogTitle className="sr-only">{t.nav.search}</DialogTitle>
        <Command
          shouldFilter={false}
          className="[&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group]]:px-2 [&_[cmdk-group]:not([hidden])_~[cmdk-group]]:pt-0 [&_[cmdk-input-wrapper]_svg]:h-5 [&_[cmdk-input-wrapper]_svg]:w-5 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-3 [&_[cmdk-item]_svg]:h-5 [&_[cmdk-item]_svg]:w-5"
        >
          <CommandInput
            placeholder={t.nav.searchPlaceholder}
            value={query}
            onValueChange={handleSearch}
          />
          <CommandList className="max-h-[400px]">
            {!loading && results.length === 0 && query && (
              <CommandEmpty>{t.nav.searchNoResults}</CommandEmpty>
            )}
            {grouped.map((group) => (
              <CommandGroup key={group.label} heading={group.label}>
                {group.tasks.map((task) => {
                  const Icon = getTaskIcon(task.prompt);
                  const displayTitle =
                    task.title ||
                    task.prompt.slice(0, 80) +
                      (task.prompt.length > 80 ? '...' : '');
                  return (
                    <CommandItem
                      key={task.id}
                      value={task.id}
                      onSelect={handleSelect}
                      className="cursor-pointer"
                    >
                      <Icon
                        className={cn(
                          'size-4 shrink-0',
                          task.status === 'completed'
                            ? 'text-green-500'
                            : task.status === 'error'
                              ? 'text-red-500'
                              : 'text-muted-foreground',
                        )}
                      />
                      <span className="truncate">{displayTitle}</span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
