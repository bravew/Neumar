import { useEffect, useState } from 'react';

import { useNavigate } from 'react-router-dom';

import type { Task } from '@/shared/db';
import { cn } from '@/shared/lib/utils';
import type { RecentsSourceProps } from '@/shared/modes/types';
import { useLanguage } from '@/shared/providers/language-provider';

import { TaskItem } from '../../sidebar';
import type { SidebarTasksStatus } from '../useSidebarTasks';

interface TasksRecentsProps extends RecentsSourceProps {
  tasks: Task[];
  status: SidebarTasksStatus;
  currentTaskId?: string;
  runningTaskIds: string[];
  onDeleteTask?: (taskId: string, deleteFolder?: boolean) => void;
  onToggleFavorite?: (taskId: string, favorite: boolean) => void;
}

export function TasksRecents({
  tasks,
  status,
  currentTaskId,
  runningTaskIds,
  searchQuery,
  onDeleteTask,
  onToggleFavorite,
}: TasksRecentsProps) {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const [loadingTaskId, setLoadingTaskId] = useState<string | null>(null);
  const filtered = tasks
    .filter((task) => {
      const title = task.title || task.prompt || '';
      return title.toLowerCase().includes(searchQuery.toLowerCase());
    })
    .slice(0, 40);

  useEffect(() => {
    if (currentTaskId && currentTaskId === loadingTaskId) {
      setLoadingTaskId(null);
    }
  }, [currentTaskId, loadingTaskId]);

  const handleSelect = (taskId: string) => {
    if (taskId === currentTaskId || taskId === loadingTaskId) return;
    setLoadingTaskId(taskId);
    // The route-level `<ViewTransition>` in AppRouteProviders now drives the
    // cross-fade for every navigation (React 19.3), so this no longer opts
    // into React Router's own `viewTransition` option — running both would
    // fight over the same `document.startViewTransition()` call.
    navigate(`/task-v2/${taskId}`, { state: null });
  };

  if (status === 'loading') {
    return (
      <div
        data-testid="tasks-recents-skeleton"
        className="space-y-2 px-2 py-2"
        aria-busy="true"
      >
        <div className="bg-sidebar-accent h-8 animate-pulse rounded-md" />
        <div className="bg-sidebar-accent h-8 animate-pulse rounded-md" />
        <div className="bg-sidebar-accent h-8 animate-pulse rounded-md" />
      </div>
    );
  }

  if (status === 'error') {
    return (
      <p className="text-sidebar-foreground/50 px-2 py-2 text-xs">
        {t.nav.tasksLoadError}
      </p>
    );
  }

  if (filtered.length === 0) {
    return (
      <p className="text-sidebar-foreground/50 px-2 py-2 text-xs">
        {t.nav.noTasksYet}
      </p>
    );
  }

  return (
    <div className={cn('space-y-0.5')}>
      {filtered.map((task) => (
        <TaskItem
          key={task.id}
          task={task}
          isActive={currentTaskId === task.id}
          isLoading={loadingTaskId === task.id}
          isRunning={runningTaskIds.includes(task.id)}
          variant="sidebar"
          t={t}
          onSelect={handleSelect}
          onDelete={(taskId, event) => {
            event.stopPropagation();
            // Deleting a task from here used to leave its whole session
            // folder behind on disk — only the database row was removed.
            onDeleteTask?.(taskId, true);
          }}
          onToggleFavorite={(nextTask, event) => {
            event.stopPropagation();
            onToggleFavorite?.(nextTask.id, !nextTask.favorite);
          }}
          onViewFolder={(taskId, event) => {
            event.stopPropagation();
            window.dispatchEvent(
              new CustomEvent('open-task-folder', { detail: taskId }),
            );
          }}
          onRename={async () => {}}
          onRegenerate={async () => {}}
        />
      ))}
    </div>
  );
}
