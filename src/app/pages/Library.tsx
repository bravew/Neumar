/**
 * Library Page — top-level Tasks | Plugins | Marketplace tab strip.
 *
 * The actual task-history surface lives in <TasksTab />; plugin surfaces in
 * <InstalledPluginsTab /> and <MarketplaceTab />. LibraryPage owns the
 * `tasks` cache (so the LeftSidebar stays in sync regardless of which tab is
 * active) and forwards delete/favorite handlers down.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { useSearchParams } from 'react-router-dom';

import * as Tabs from '@radix-ui/react-tabs';

import { LeftSidebar, SidebarProvider } from '@/components/layout';
import {
  AssetsLibraryTab,
  CloudStorageLibraryTab,
  InstalledPluginsTab,
  MarketplaceTab,
  TasksTab,
} from '@/components/library';
import { GraphView } from '@/components/library/GraphView';
import { PublishHistory } from '@/components/publish';
import { API_BASE_URL } from '@/config';
import type { Task } from '@/shared/db';
import { deleteTask, getAllTasks, updateTask } from '@/shared/db';
import {
  subscribeToBackgroundTasks,
  type BackgroundTask,
} from '@/shared/lib/background-tasks';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

const TAB_IDS = [
  'tasks',
  'assets',
  'plugins',
  'marketplace',
  'cloud-storage',
  'publish',
  'graph',
] as const;
type TabId = (typeof TAB_IDS)[number];

export function LibraryPage() {
  return (
    <SidebarProvider>
      <LibraryContent />
    </SidebarProvider>
  );
}

function LibraryContent() {
  const { t } = useLanguage();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = searchParams.get('tab');

  const [tasks, setTasks] = useState<Task[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [backgroundTasks, setBackgroundTasks] = useState<BackgroundTask[]>([]);
  const [assetsEnabled, setAssetsEnabled] = useState<boolean | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>(
    TAB_IDS.includes(initialTab as TabId) ? (initialTab as TabId) : 'tasks',
  );

  useEffect(() => {
    const ctrl = new AbortController();
    fetch(`${API_BASE_URL}/db/settings/assets.catalog_enabled`, {
      signal: ctrl.signal,
    })
      .then((response) =>
        response.ok ? (response.json() as Promise<{ value: string }>) : null,
      )
      .then((body) => {
        // Opt-out flag: unset (404 → null body) is treated as enabled; only an
        // explicit 'false' hides the Assets tab. Mirrors the backend
        // `getFeatureFlag` convention in src-api/.../assets/flags.ts.
        if (!ctrl.signal.aborted) setAssetsEnabled(body?.value !== 'false');
      })
      .catch((error) => {
        if (!ctrl.signal.aborted) setAssetsEnabled(true);
        if (
          !ctrl.signal.aborted &&
          import.meta.env.DEV &&
          (error as { name?: string }).name !== 'AbortError'
        ) {
          console.error('Failed to load assets feature flag:', error);
        }
      });
    return () => ctrl.abort();
  }, []);

  useEffect(() => {
    if (assetsEnabled !== false || activeTab !== 'assets') return;
    setActiveTab('tasks');
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set('tab', 'tasks');
      return next;
    });
  }, [activeTab, assetsEnabled, setSearchParams]);

  const handleTabChange = useCallback(
    (value: string) => {
      const nextTab = value as TabId;
      setActiveTab(nextTab);
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        next.set('tab', nextTab);
        return next;
      });
    },
    [setSearchParams],
  );

  useEffect(() => {
    const unsubscribe = subscribeToBackgroundTasks(setBackgroundTasks);
    return unsubscribe;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      try {
        const all = await getAllTasks();
        if (!cancelled) setTasks(all);
      } catch (error) {
        if (import.meta.env.DEV) console.error('Failed to load tasks:', error);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Reflect title updates emitted by other surfaces.
  useEffect(() => {
    function handleTitleUpdate(e: Event) {
      const { taskId, title } = (
        e as CustomEvent<{ taskId: string; title: string }>
      ).detail;
      setTasks((prev) =>
        prev.map((x) => (x.id === taskId ? { ...x, title } : x)),
      );
    }
    window.addEventListener('task-title-updated', handleTitleUpdate);
    return () =>
      window.removeEventListener('task-title-updated', handleTitleUpdate);
  }, []);

  const runningTaskIds = useMemo(
    () => backgroundTasks.filter((bt) => bt.isRunning).map((bt) => bt.taskId),
    [backgroundTasks],
  );

  const handleDeleteTask = useCallback(async (taskId: string) => {
    try {
      await deleteTask(taskId);
      setTasks((prev) => prev.filter((x) => x.id !== taskId));
    } catch (error) {
      if (import.meta.env.DEV) console.error('Failed to delete task:', error);
    }
  }, []);

  const handleToggleFavorite = useCallback(
    async (taskId: string, favorite: boolean) => {
      try {
        await updateTask(taskId, { favorite });
        setTasks((prev) =>
          prev.map((x) => (x.id === taskId ? { ...x, favorite } : x)),
        );
      } catch (error) {
        if (import.meta.env.DEV) console.error('Failed to update task:', error);
      }
    },
    [],
  );

  return (
    <div
      className="bg-sidebar flex h-screen overflow-hidden"
      data-testid="library-page"
    >
      <LeftSidebar
        tasks={tasks}
        onDeleteTask={handleDeleteTask}
        onToggleFavorite={handleToggleFavorite}
        runningTaskIds={runningTaskIds}
      />

      <main className="bg-background my-2 mr-2 flex flex-1 flex-col overflow-hidden rounded-l-2xl shadow-sm">
        <Tabs.Root
          value={activeTab}
          onValueChange={handleTabChange}
          className="flex flex-1 flex-col overflow-hidden"
        >
          <Tabs.List
            aria-label={t.plugins.title}
            className="border-border flex shrink-0 items-center gap-1 border-b px-6 pt-4"
          >
            <TabTrigger value="tasks" label={t.library.title} />
            {assetsEnabled === true ? (
              <TabTrigger value="assets" label={t.assets.tab} />
            ) : null}
            <TabTrigger value="plugins" label={t.plugins.tabs.installed} />
            <TabTrigger
              value="marketplace"
              label={t.plugins.tabs.marketplace}
            />
            <TabTrigger
              value="cloud-storage"
              label={t.cloudStorage.cloudStorageConnectorsTitle}
            />
            <TabTrigger
              value="publish"
              label={(t.publish as Record<string, string>).historyTab}
            />
            <TabTrigger
              value="graph"
              label={
                (t.library as Record<string, string>).graphifyTab ??
                'Knowledge Graph'
              }
            />
          </Tabs.List>

          <div className="flex-1 overflow-y-auto">
            <div
              className={cn(
                'mx-auto w-full px-6 py-8',
                activeTab === 'assets' ? 'max-w-6xl' : 'max-w-4xl',
              )}
            >
              <Tabs.Content value="tasks" className="outline-none">
                <TasksTab
                  tasks={tasks}
                  isLoading={isLoading}
                  runningTaskIds={runningTaskIds}
                  onTasksChange={setTasks}
                  onToggleFavorite={handleToggleFavorite}
                />
              </Tabs.Content>
              {assetsEnabled === true ? (
                <Tabs.Content value="assets" className="outline-none">
                  <AssetsLibraryTab />
                </Tabs.Content>
              ) : null}
              <Tabs.Content value="plugins" className="outline-none">
                <InstalledPluginsTab />
              </Tabs.Content>
              <Tabs.Content value="marketplace" className="outline-none">
                <MarketplaceTab />
              </Tabs.Content>
              <Tabs.Content value="cloud-storage" className="outline-none">
                <CloudStorageLibraryTab />
              </Tabs.Content>
              <Tabs.Content value="publish" className="outline-none">
                <PublishHistory />
              </Tabs.Content>
              <Tabs.Content value="graph" className="outline-none">
                <GraphView />
              </Tabs.Content>
            </div>
          </div>
        </Tabs.Root>
      </main>
    </div>
  );
}

function TabTrigger({ value, label }: { value: TabId; label: string }) {
  return (
    <Tabs.Trigger
      value={value}
      data-testid={`library-tab-${value}`}
      className={cn(
        'text-muted-foreground data-[state=active]:text-foreground data-[state=active]:border-foreground hover:text-foreground/80 -mb-px border-b-2 border-transparent px-3 py-2 text-sm font-medium transition-colors outline-none',
      )}
    >
      {label}
    </Tabs.Trigger>
  );
}
