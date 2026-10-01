import { useState } from 'react';

import { Link2, MessageCircle, Plus, Search } from 'lucide-react';

import { AsyncList } from '@/components/common/async-list';
import type { SidebarTasksStatus } from '@/components/layout/sidebar-shell/useSidebarTasks';
import type { Task } from '@/shared/db';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

import { isSideChatPrompt } from './side-chat';

const MAX_RECENT = 40;

export function sessionLabel(task: Task): string {
  return task.title || task.prompt || '';
}

/** Muse-style chat list: New chat, then side chats, then everything else. */
export function DockSessionList({
  tasks,
  status,
  activeId,
  onSelect,
  onNewChat,
}: {
  tasks: Task[];
  status: SidebarTasksStatus;
  activeId: string | null;
  onSelect: (taskId: string) => void;
  onNewChat: () => void;
}) {
  const { t } = useLanguage();
  const [query, setQuery] = useState('');
  const matches = tasks.filter((task) =>
    sessionLabel(task).toLowerCase().includes(query.trim().toLowerCase()),
  );
  const side = matches.filter((task) => isSideChatPrompt(task.prompt));
  const recent = matches
    .filter((task) => !isSideChatPrompt(task.prompt))
    .slice(0, MAX_RECENT);

  const row = (task: Task, sideChat: boolean) => {
    const Icon = sideChat ? Link2 : MessageCircle;
    return (
      <button
        key={task.id}
        type="button"
        data-testid="dock-session"
        aria-current={activeId === task.id ? 'true' : undefined}
        onClick={() => onSelect(task.id)}
        className={cn(
          'flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 text-sm transition-colors',
          activeId === task.id
            ? 'bg-sidebar-accent text-sidebar-accent-foreground'
            : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground',
        )}
      >
        <Icon className="size-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-left">
          {sessionLabel(task)}
        </span>
      </button>
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 px-3">
      <label className="bg-sidebar-accent/50 text-sidebar-foreground/60 flex h-8 shrink-0 items-center gap-2 rounded-lg px-2 text-xs">
        <Search className="size-3.5 shrink-0" />
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t.nav.searchPlaceholder}
          className="placeholder:text-sidebar-foreground/40 min-w-0 flex-1 bg-transparent outline-none"
        />
      </label>
      <button
        type="button"
        onClick={onNewChat}
        className="text-sidebar-foreground hover:bg-sidebar-accent/50 flex shrink-0 cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 text-sm font-medium transition-colors"
      >
        <Plus className="size-4 shrink-0" />
        {t.modes.chat.primaryAction}
      </button>
      <div className="scrollbar-hide min-h-0 flex-1 overflow-y-auto pb-3">
        <AsyncList
          status={status}
          empty={matches.length === 0}
          renderSkeleton={() => (
            <div className="space-y-2 py-2" aria-busy="true">
              <div className="bg-sidebar-accent h-8 animate-pulse rounded-md" />
              <div className="bg-sidebar-accent h-8 animate-pulse rounded-md" />
              <div className="bg-sidebar-accent h-8 animate-pulse rounded-md" />
            </div>
          )}
          renderError={() => (
            <p className="text-sidebar-foreground/50 px-2 py-2 text-xs">
              {t.nav.tasksLoadError}
            </p>
          )}
          renderEmpty={() => (
            <p className="text-sidebar-foreground/50 px-2 py-2 text-xs">
              {t.nav.noTasksYet}
            </p>
          )}
        >
          {side.length > 0 ? (
            <section className="mb-3 space-y-0.5">
              <h3 className="text-sidebar-foreground/50 px-2 py-1.5 text-xs font-medium tracking-wider">
                {t.task.dockSideChats}
              </h3>
              {side.map((task) => row(task, true))}
            </section>
          ) : null}
          {recent.length > 0 ? (
            <section className="space-y-0.5">
              <h3 className="text-sidebar-foreground/50 px-2 py-1.5 text-xs font-medium tracking-wider">
                {t.nav.recents}
              </h3>
              {recent.map((task) => row(task, false))}
            </section>
          ) : null}
        </AsyncList>
      </div>
    </div>
  );
}
