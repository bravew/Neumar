import { useCallback, useEffect, useMemo, useState } from 'react';

import { Outlet, useNavigate, useParams } from 'react-router-dom';

import { RouteViewTransition } from '@/app/RouteViewTransition';
import { LeftSidebar, SidebarProvider } from '@/components/layout';
import { ModeSlotShortcuts } from '@/components/layout/sidebar-shell/ModeSlotShortcuts';
import { deleteTask, getTask, updateTask } from '@/shared/db';
import {
  subscribeToBackgroundTasks,
  type BackgroundTask,
} from '@/shared/lib/background-tasks';
import { deleteSessionFolder } from '@/shared/lib/session';
import { useThreadStore } from '@/shared/stores/thread-store';
import { selectRunningTaskIds } from '@/shared/stores/thread-store';

export function AppShellLayout() {
  const navigate = useNavigate();
  const { taskId } = useParams();
  const threadRunning = useThreadStore(selectRunningTaskIds);
  const [backgroundTasks, setBackgroundTasks] = useState<BackgroundTask[]>([]);

  useEffect(() => subscribeToBackgroundTasks(setBackgroundTasks), []);

  const runningTaskIds = useMemo(() => {
    const ids = new Set(threadRunning);
    for (const task of backgroundTasks) {
      if (task.isRunning) ids.add(task.taskId);
    }
    return [...ids];
  }, [backgroundTasks, threadRunning]);

  const onDeleteTask = useCallback(
    async (id: string, deleteFolder?: boolean) => {
      try {
        const task = await getTask(id);
        await deleteTask(id);
        if (id === taskId) navigate('/');
        if (deleteFolder && task) {
          await deleteSessionFolder(task.id, task.work_dir, task.session_id);
        }
        window.dispatchEvent(
          new CustomEvent('sidebar-task-deleted', { detail: id }),
        );
      } catch (error) {
        if (import.meta.env.DEV) console.error('Failed to delete task:', error);
      }
    },
    [navigate, taskId],
  );

  const onToggleFavorite = useCallback(
    async (id: string, favorite: boolean) => {
      try {
        await updateTask(id, { favorite });
        window.dispatchEvent(
          new CustomEvent('sidebar-task-favorite', {
            detail: { taskId: id, favorite },
          }),
        );
      } catch (error) {
        if (import.meta.env.DEV) console.error('Failed to update task:', error);
      }
    },
    [],
  );

  return (
    <SidebarProvider>
      <ModeSlotShortcuts />
      <div className="bg-sidebar flex h-svh overflow-hidden">
        <LeftSidebar
          currentTaskId={taskId}
          runningTaskIds={runningTaskIds}
          onDeleteTask={onDeleteTask}
          onToggleFavorite={onToggleFavorite}
        />
        <div className="flex min-h-0 min-w-0 flex-1">
          <RouteViewTransition>
            <Outlet />
          </RouteViewTransition>
        </div>
      </div>
    </SidebarProvider>
  );
}

export function ChromelessLayout() {
  return (
    <RouteViewTransition>
      <Outlet />
    </RouteViewTransition>
  );
}
