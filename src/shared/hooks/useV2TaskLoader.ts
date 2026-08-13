import { useCallback, useEffect, useState } from 'react';

import { useNavigate } from 'react-router-dom';

import type { Task } from '@/shared/db';
import { deleteTask, getAllTasks, getTask, updateTask } from '@/shared/db';
import { deleteSessionFolder } from '@/shared/lib/session';

/**
 * Manages sidebar task list state for the V2 route.
 * Mirrors the task-loading logic from TaskDetail.tsx but scoped to V2's needs.
 *
 * Exposes `addTask()` for optimistic insertion — callers should use this after
 * `createTask()` returns rather than relying on the async `task-created` event,
 * avoiding the race where `getAllTasks()` response overwrites a newly-added task.
 */
export function useV2TaskLoader(taskId: string | undefined) {
  const navigate = useNavigate();
  const [allTasks, setAllTasks] = useState<Task[]>([]);

  // Initial load + refresh when taskId changes.
  // Uses functional update to merge rather than replace — prevents overwriting
  // a task that was added optimistically via addTask() before this fetch returns.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const dbTasks = await getAllTasks();
        if (!cancelled) {
          setAllTasks((prev) => {
            // Merge: keep any optimistic tasks that aren't in the DB result yet
            const dbIds = new Set(dbTasks.map((t) => t.id));
            const optimistic = prev.filter((t) => !dbIds.has(t.id));
            return [...optimistic, ...dbTasks];
          });
        }
      } catch {
        // ignore — sidebar is non-critical
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [taskId]);

  // Listen for title updates from the title-generation service
  useEffect(() => {
    function handleTitleUpdate(e: Event) {
      const { taskId: updatedId, title } = (
        e as CustomEvent<{ taskId: string; title: string }>
      ).detail;
      setAllTasks((prev) =>
        prev.map((t) => (t.id === updatedId ? { ...t, title } : t)),
      );
    }
    window.addEventListener('task-title-updated', handleTitleUpdate);
    return () =>
      window.removeEventListener('task-title-updated', handleTitleUpdate);
  }, []);

  // Optimistic add — call directly after createTask() to avoid race conditions.
  // Synchronously prepends the task to the sidebar list.
  const addTask = useCallback((task: Task) => {
    setAllTasks((prev) => {
      if (prev.some((t) => t.id === task.id)) return prev;
      return [task, ...prev];
    });
  }, []);

  const handleDeleteTask = useCallback(
    async (id: string, deleteFolder?: boolean) => {
      try {
        const taskToDelete = await getTask(id);
        await deleteTask(id);
        setAllTasks((prev) => prev.filter((t) => t.id !== id));
        if (id === taskId) navigate('/');
        if (deleteFolder && taskToDelete) {
          await deleteSessionFolder(
            taskToDelete.id,
            taskToDelete.work_dir,
            taskToDelete.session_id,
          );
        }
      } catch {
        // ignore — deletion errors are surfaced by the sidebar dialog
      }
    },
    [taskId, navigate],
  );

  const handleToggleFavorite = useCallback(
    async (id: string, favorite: boolean) => {
      try {
        await updateTask(id, { favorite });
        setAllTasks((prev) =>
          prev.map((t) => (t.id === id ? { ...t, favorite } : t)),
        );
      } catch {
        // ignore
      }
    },
    [],
  );

  return { allTasks, addTask, handleDeleteTask, handleToggleFavorite };
}
