import { useState } from 'react';

import { Search } from 'lucide-react';

import type { Task } from '@/shared/db';
import { useMode } from '@/shared/modes/useMode';
import { useLanguage } from '@/shared/providers/language-provider';

import { DesignRecents } from './recents/DesignRecents';
import { TasksRecents } from './recents/TasksRecents';

interface SidebarRecentsProps {
  tasks: Task[];
  currentTaskId?: string;
  runningTaskIds: string[];
  onDeleteTask?: (taskId: string, deleteFolder?: boolean) => void;
  onToggleFavorite?: (taskId: string, favorite: boolean) => void;
}

export function SidebarRecents({
  tasks,
  currentTaskId,
  runningTaskIds,
  onDeleteTask,
  onToggleFavorite,
}: SidebarRecentsProps) {
  const { activeMode } = useMode();
  const { t } = useLanguage();
  const [searchQuery, setSearchQuery] = useState('');

  return (
    <div className="flex min-h-0 flex-1 flex-col px-3">
      <div className="flex shrink-0 items-center justify-between px-2 py-1.5">
        <span className="text-sidebar-foreground/50 text-xs font-medium tracking-wider">
          {t.nav.recents}
        </span>
      </div>
      <label className="bg-sidebar-accent/50 text-sidebar-foreground/60 mb-2 flex h-8 items-center gap-2 rounded-lg px-2 text-xs">
        <Search className="size-3.5 shrink-0" />
        <input
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder={t.nav.searchPlaceholder}
          className="placeholder:text-sidebar-foreground/40 min-w-0 flex-1 bg-transparent outline-none"
        />
      </label>
      <div className="scrollbar-hide min-h-0 flex-1 overflow-y-auto">
        {activeMode.id === 'design' ? (
          <DesignRecents searchQuery={searchQuery} activeId={currentTaskId} />
        ) : activeMode.id === 'tasks' ? (
          <TasksRecents
            tasks={tasks}
            currentTaskId={currentTaskId}
            runningTaskIds={runningTaskIds}
            searchQuery={searchQuery}
            onDeleteTask={onDeleteTask}
            onToggleFavorite={onToggleFavorite}
          />
        ) : (
          <p className="text-sidebar-foreground/50 px-2 py-2 text-xs">
            {t.nav.noRecentItems}
          </p>
        )}
      </div>
    </div>
  );
}
