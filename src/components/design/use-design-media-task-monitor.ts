import { useCallback, useEffect, useRef, useState } from 'react';

import {
  getDesignProject,
  listDesignMediaTasks,
  waitDesignMedia,
} from '@/shared/hooks/useDesignMode';
import type {
  DesignProject,
  DesignTaskRecord,
} from '@/shared/types/design-mode';

interface UseDesignMediaTaskMonitorOptions {
  projectId: string;
  onProjectChange: (project: DesignProject) => void;
  onRefreshBudget: () => void | Promise<void>;
}

export function useDesignMediaTaskMonitor({
  projectId,
  onProjectChange,
  onRefreshBudget,
}: UseDesignMediaTaskMonitorOptions) {
  const [tasks, setTasks] = useState<DesignTaskRecord[]>([]);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [tasksHydrated, setTasksHydrated] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const monitoringTaskIdRef = useRef<string | null>(null);

  const isMonitoringTask = useCallback(
    () => Boolean(monitoringTaskIdRef.current),
    [],
  );

  const monitorDesignTask = useCallback(
    async (task: DesignTaskRecord) => {
      if (monitoringTaskIdRef.current === task.taskId) return;
      monitoringTaskIdRef.current = task.taskId;
      setActiveTaskId(task.taskId);
      let latest = task;
      let reachedTerminalState = isTerminalTaskState(latest.state);
      try {
        while (!isTerminalTaskState(latest.state)) {
          const result = await waitDesignMedia(projectId, task.taskId);
          latest = result.task;
          setTasks((prev) =>
            prev.map((item) =>
              item.taskId === task.taskId ? result.task : item,
            ),
          );
        }
        reachedTerminalState = true;
        const fresh = await getDesignProject(projectId);
        onProjectChange(fresh.project);
        void onRefreshBudget();
      } catch (err) {
        setSendError(err instanceof Error ? err.message : String(err));
      } finally {
        if (monitoringTaskIdRef.current === task.taskId) {
          monitoringTaskIdRef.current = null;
          if (reachedTerminalState) setActiveTaskId(null);
        }
      }
    },
    [onProjectChange, onRefreshBudget, projectId],
  );

  useEffect(() => {
    setTasksHydrated(false);
    const ac = new AbortController();
    void listDesignMediaTasks(projectId, { signal: ac.signal })
      .then((data) => {
        if (ac.signal.aborted) return;
        const runtimeTasks = Array.isArray(data.tasks) ? data.tasks : [];
        setTasks(runtimeTasks);
        const activeTask = runtimeTasks.find(
          (task) => !isTerminalTaskState(task.state),
        );
        if (activeTask) {
          void monitorDesignTask(activeTask);
        } else if (!monitoringTaskIdRef.current) {
          setActiveTaskId(null);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!ac.signal.aborted) setTasksHydrated(true);
      });
    return () => ac.abort();
  }, [monitorDesignTask, projectId]);

  return {
    activeTaskId,
    isMonitoringTask,
    monitorDesignTask,
    sendError,
    setActiveTaskId,
    setSendError,
    setTasks,
    tasks,
    tasksHydrated,
  };
}

function isTerminalTaskState(state: DesignTaskRecord['state']) {
  return state === 'done' || state === 'failed' || state === 'cancelled';
}
