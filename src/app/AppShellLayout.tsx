import { useCallback, useEffect, useMemo, useState } from 'react';

import { Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';

import { RouteViewTransition } from '@/app/RouteViewTransition';
import { ChatDock } from '@/components/chat-dock/ChatDock';
import { LeftSidebar, SidebarProvider } from '@/components/layout';
import { AppRail } from '@/components/layout/rail/AppRail';
import { ModeSlotShortcuts } from '@/components/layout/sidebar-shell/ModeSlotShortcuts';
import { SidebarToggleShortcut } from '@/components/layout/sidebar-shell/SidebarToggleShortcut';
import { deleteTask, getTask, updateTask } from '@/shared/db';
import { getSettings, useSettingsValue } from '@/shared/db/settings';
import { useShortcut } from '@/shared/hotkeys/useShortcut';
import {
  cyclePanel,
  defaultCanvasPanelRecord,
  defaultPanelRecord,
  isCanvasPath,
  isDesignPath,
  toggleFocus,
  type PanelRecord,
} from '@/shared/layout/panelState';
import {
  subscribeToBackgroundTasks,
  type BackgroundTask,
} from '@/shared/lib/background-tasks';
import { deleteSessionFolder } from '@/shared/lib/session';
import { useThreadStore } from '@/shared/stores/thread-store';
import { selectRunningTaskIds } from '@/shared/stores/thread-store';

type PanelKind = 'page' | 'canvas';

export function AppShellLayout() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { taskId } = useParams();
  const threadRunning = useThreadStore(selectRunningTaskIds);
  const [backgroundTasks, setBackgroundTasks] = useState<BackgroundTask[]>([]);

  useEffect(() => subscribeToBackgroundTasks(setBackgroundTasks), []);

  const simpleShell = useSettingsValue().ui.simpleShell;
  const [dockOpen, setDockOpen] = useState(false);
  const [dockTaskId, setDockTaskId] = useState<string | null>(null);
  // Editors keep their own record so collapsing the panel for a canvas does
  // not collapse it on ordinary pages, and the reverse.
  const [panels, setPanels] = useState<Record<PanelKind, PanelRecord>>(() => ({
    page: defaultPanelRecord(
      typeof window === 'undefined' ? 1280 : window.innerWidth,
    ),
    canvas: defaultCanvasPanelRecord(),
  }));
  const panelKind: PanelKind = isCanvasPath(pathname) ? 'canvas' : 'page';
  const panel = panels[panelKind];
  const updatePanel = useCallback(
    (update: (record: PanelRecord) => PanelRecord) =>
      setPanels((current) => ({
        ...current,
        [panelKind]: update(current[panelKind]),
      })),
    [panelKind],
  );

  useEffect(() => {
    const openDock = (event: Event) => {
      const detail = event instanceof CustomEvent ? event.detail : undefined;
      const taskId = detail?.taskId;
      if (typeof taskId === 'string') setDockTaskId(taskId);
      setDockOpen(true);
    };
    window.addEventListener('shell:open-dock', openDock);
    return () => window.removeEventListener('shell:open-dock', openDock);
  }, []);

  useShortcut({
    id: 'shell.chat-dock',
    chord: 'mod+j',
    scope: 'global',
    descriptionKey: 'shortcuts.sidebarToggle.description',
    group: 'navigation',
    handler: (event) => {
      event?.preventDefault();
      if (!getSettings().ui.simpleShell) return;
      setDockOpen((open) => !open);
    },
  });

  useEffect(() => {
    const onCycle = () => updatePanel(cyclePanel);
    window.addEventListener('shell:cycle-panel', onCycle);
    return () => window.removeEventListener('shell:cycle-panel', onCycle);
  }, [updatePanel]);

  useShortcut({
    id: 'shell.focus',
    chord: 'mod+.',
    scope: 'global',
    descriptionKey: 'shortcuts.sidebarToggle.description',
    group: 'navigation',
    handler: () => {
      if (!getSettings().ui.simpleShell) return;
      updatePanel(toggleFocus);
    },
  });

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

  // Design Mode draws its own full-page layout under the legacy shell.
  const showSidebar = simpleShell
    ? panel.state === 'A'
    : !isDesignPath(pathname);

  return (
    <SidebarProvider>
      <ModeSlotShortcuts />
      <SidebarToggleShortcut onCyclePanel={() => updatePanel(cyclePanel)} />
      <div className="bg-sidebar flex h-svh overflow-hidden">
        {simpleShell && panel.state !== 'C' ? <AppRail /> : null}
        {simpleShell && dockOpen && panel.state !== 'C' ? (
          <ChatDock
            taskId={dockTaskId}
            pageTaskId={taskId}
            onTaskId={setDockTaskId}
            onClose={() => setDockOpen(false)}
          />
        ) : showSidebar ? (
          <LeftSidebar
            currentTaskId={taskId}
            runningTaskIds={runningTaskIds}
            onDeleteTask={onDeleteTask}
            onToggleFavorite={onToggleFavorite}
          />
        ) : null}
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
