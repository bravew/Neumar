/**
 * Automation Page
 *
 * Main automation dashboard with list and detail views.
 * Follows the Home.tsx pattern: SidebarProvider wrapper + content component.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { useSearchParams } from 'react-router-dom';

import { AutomationDetail } from '@/components/automation/AutomationDetail';
import { AutomationList } from '@/components/automation/AutomationList';
import { LeftSidebar, SidebarProvider } from '@/components/layout';
import { API_BASE_URL } from '@/config';
import type { Task } from '@/shared/db';
import { deleteTask, getAllTasks, getTask, updateTask } from '@/shared/db';
import { useAutomations } from '@/shared/hooks/useAutomation';
import {
  subscribeToBackgroundTasks,
  type BackgroundTask,
} from '@/shared/lib/background-tasks';
import { deleteSessionFolder } from '@/shared/lib/session';
import type {
  CreateAutomationInput,
  UpdateAutomationInput,
} from '@/shared/types/automation';

export function AutomationPage() {
  return (
    <SidebarProvider>
      <AutomationContent />
    </SidebarProvider>
  );
}

function AutomationContent() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [backgroundTasks, setBackgroundTasks] = useState<BackgroundTask[]>([]);
  const [selectedAutomationId, setSelectedAutomationId] = useState<
    string | null
  >(null);

  // Auto-select automation from URL query param (e.g., /automation?id=abc123)
  // Used by notification click-through
  useEffect(() => {
    const idFromUrl = searchParams.get('id');
    if (idFromUrl) {
      setSelectedAutomationId(idFromUrl);
      // Clean the URL param after consuming it
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const {
    automations,
    loading,
    create,
    update,
    remove,
    toggle,
    trigger,
    refresh,
  } = useAutomations();

  // Derive selected automation from the list — always in sync, no extra effect
  const selectedAutomation = useMemo(
    () => automations.find((a) => a.id === selectedAutomationId) ?? null,
    [automations, selectedAutomationId],
  );

  // Subscribe to background tasks for sidebar
  useEffect(() => {
    const unsubscribe = subscribeToBackgroundTasks(setBackgroundTasks);
    return unsubscribe;
  }, []);

  // Load tasks for sidebar
  useEffect(() => {
    async function loadTasks() {
      try {
        const allTasks = await getAllTasks();
        setTasks(allTasks);
      } catch {
        // Sidebar task loading is non-critical
      }
    }
    loadTasks();
  }, []);

  const handleDeleteTask = useCallback(
    async (taskId: string, deleteFolder?: boolean) => {
      try {
        const task = await getTask(taskId);
        await deleteTask(taskId);
        setTasks((prev) => prev.filter((t) => t.id !== taskId));
        if (deleteFolder && task) {
          await deleteSessionFolder(task.id, task.work_dir, task.session_id);
        }
      } catch {
        // Sidebar task deletion is non-critical
      }
    },
    [],
  );

  const handleToggleFavorite = useCallback(
    async (taskId: string, favorite: boolean) => {
      try {
        await updateTask(taskId, { favorite });
        setTasks((prev) =>
          prev.map((t) => (t.id === taskId ? { ...t, favorite } : t)),
        );
      } catch {
        // Sidebar favorite toggle is non-critical
      }
    },
    [],
  );

  // Automation handlers — no selectedAutomation in deps, use ID-based approach
  const handleCreate = useCallback(
    async (input: CreateAutomationInput) => {
      await create(input);
    },
    [create],
  );

  const handleUpdate = useCallback(
    async (id: string, input: UpdateAutomationInput) => {
      await update(id, input);
    },
    [update],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      await remove(id);
      setSelectedAutomationId((prev) => (prev === id ? null : prev));
    },
    [remove],
  );

  const handleToggle = useCallback(
    async (id: string, enabled: boolean) => {
      await toggle(id, enabled);
    },
    [toggle],
  );

  const handleTrigger = useCallback(
    async (id: string) => {
      await trigger(id);
      await refresh();
    },
    [trigger, refresh],
  );

  const handleCancelRun = useCallback(async (runId: string) => {
    try {
      const res = await fetch(
        `${API_BASE_URL}/automation/runs/${runId}/cancel`,
        { method: 'POST' },
      );
      const data = await res.json();
      if (!data.success) {
        // Cancel failure is non-critical — run will time out eventually
      }
    } catch {
      // Network errors on cancel are non-critical
    }
  }, []);

  return (
    <div
      className="bg-sidebar flex h-screen overflow-hidden"
      data-testid="automation-page"
    >
      <LeftSidebar
        tasks={tasks}
        onDeleteTask={handleDeleteTask}
        onToggleFavorite={handleToggleFavorite}
        runningTaskIds={backgroundTasks
          .filter((t) => t.isRunning)
          .map((t) => t.taskId)}
      />

      <div className="bg-background my-2 mr-2 flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl shadow-sm">
        <div className="flex-1 overflow-auto p-6">
          {selectedAutomation ? (
            <AutomationDetail
              automation={selectedAutomation}
              onBack={() => setSelectedAutomationId(null)}
              onToggle={(enabled) =>
                handleToggle(selectedAutomation.id, enabled)
              }
              onTrigger={() => handleTrigger(selectedAutomation.id)}
              onUpdate={handleUpdate}
              onDelete={() => handleDelete(selectedAutomation.id)}
              onCancelRun={handleCancelRun}
            />
          ) : (
            <AutomationList
              automations={automations}
              loading={loading}
              onSelect={(a) => setSelectedAutomationId(a.id)}
              onCreate={handleCreate}
              onToggle={handleToggle}
              onTrigger={handleTrigger}
              onDelete={handleDelete}
            />
          )}
        </div>
      </div>
    </div>
  );
}
