import { useCallback, useEffect, useState } from 'react';

import { getAllTasks, type Task } from '@/shared/db';

export type SidebarTasksStatus = 'loading' | 'ready' | 'error';

export function useSidebarTasks() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [status, setStatus] = useState<SidebarTasksStatus>('loading');

  useEffect(() => {
    const controller = new AbortController();
    getAllTasks({ signal: controller.signal })
      .then((loaded) => {
        if (controller.signal.aborted) return;
        setTasks(loaded);
        setStatus('ready');
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }
        setStatus('error');
      });
    return () => {
      controller.abort();
    };
  }, []);

  const removeTask = useCallback((taskId: string) => {
    setTasks((current) => current.filter((task) => task.id !== taskId));
  }, []);

  const setTaskFavorite = useCallback((taskId: string, favorite: boolean) => {
    setTasks((current) =>
      current.map((task) =>
        task.id === taskId ? { ...task, favorite } : task,
      ),
    );
  }, []);

  return { tasks, status, removeTask, setTaskFavorite };
}
