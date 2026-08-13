import { useEffect, useRef, useState } from 'react';

import { useNavigate } from 'react-router-dom';

import type { Task } from '@/shared/db';
import { cn } from '@/shared/lib/utils';
import type { RecentsSourceProps } from '@/shared/modes/types';
import { useLanguage } from '@/shared/providers/language-provider';

import { TaskItem, VIEW_TRANSITION_SETTLE_MS } from '../../sidebar';

interface TasksRecentsProps extends RecentsSourceProps {
  tasks: Task[];
  currentTaskId?: string;
  runningTaskIds: string[];
  onDeleteTask?: (taskId: string, deleteFolder?: boolean) => void;
  onToggleFavorite?: (taskId: string, favorite: boolean) => void;
}

export function TasksRecents({
  tasks,
  currentTaskId,
  runningTaskIds,
  searchQuery,
  onDeleteTask,
  onToggleFavorite,
}: TasksRecentsProps) {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const [loadingTaskId, setLoadingTaskId] = useState<string | null>(null);
  const settleTimerRef = useRef<number | null>(null);
  const filtered = tasks
    .filter((task) => {
      const title = task.title || task.prompt || '';
      return title.toLowerCase().includes(searchQuery.toLowerCase());
    })
    .slice(0, 40);

  useEffect(
    () => () => {
      if (settleTimerRef.current !== null) {
        window.clearTimeout(settleTimerRef.current);
      }
    },
    [],
  );

  const handleSelect = (taskId: string) => {
    if (taskId === currentTaskId || loadingTaskId) return;
    setLoadingTaskId(taskId);
    navigate(`/task-v2/${taskId}`, { viewTransition: true, state: null });
    if (settleTimerRef.current !== null) {
      window.clearTimeout(settleTimerRef.current);
    }
    settleTimerRef.current = window.setTimeout(() => {
      settleTimerRef.current = null;
      setLoadingTaskId(null);
    }, VIEW_TRANSITION_SETTLE_MS);
  };

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
            onDeleteTask?.(taskId, false);
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
