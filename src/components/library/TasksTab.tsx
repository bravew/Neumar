/**
 * TasksTab — task-history browser extracted from LibraryPage so the page can
 * host a top-level Tabs strip (Tasks | Plugins | Marketplace) while each
 * child stays under the 350-line ceiling.
 *
 * State that the LeftSidebar also needs (`tasks`, `runningTaskIds`,
 * delete + favorite handlers) is owned by LibraryPage and passed in as
 * props to keep the data flow one-way.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useNavigate } from 'react-router-dom';

import { motion } from 'motion/react';

import {
  LibraryDeleteDialog,
  LibraryTaskRow,
  LibraryToolbar,
} from '@/components/library';
import type { FilterOption, SortOption } from '@/components/library';
import { API_BASE_URL } from '@/config';
import { DURATION, EASE, SkeletonShimmer } from '@/config/animation';
import { APP_DATA_DIR } from '@/config/branding';
import type { Task } from '@/shared/db';
import { batchDeleteTasks, getTask } from '@/shared/db';
import { getSettings } from '@/shared/db/settings';
import { useAgentProfiles } from '@/shared/hooks/useAgentProfiles';
import { expandPath } from '@/shared/lib/paths';
import { useLanguage } from '@/shared/providers/language-provider';

interface TasksTabProps {
  tasks: Task[];
  isLoading: boolean;
  runningTaskIds: string[];
  onTasksChange: (next: Task[]) => void;
  onToggleFavorite: (taskId: string, favorite: boolean) => void;
}

export function TasksTab({
  tasks,
  isLoading,
  runningTaskIds,
  onTasksChange,
  onToggleFavorite,
}: TasksTabProps) {
  const navigate = useNavigate();
  const { t } = useLanguage();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTasks, setSelectedTasks] = useState<Set<string>>(new Set());
  const [sortBy, setSortBy] = useState<SortOption>('newest');
  const [filterBy, setFilterBy] = useState<FilterOption>('all');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteAlsoFolder, setDeleteAlsoFolder] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const searchInputRef = useRef<HTMLInputElement>(null);

  const { profiles } = useAgentProfiles('active');
  const profileMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const p of profiles) map[p.id] = p.name;
    return map;
  }, [profiles]);

  const filteredTasks = useMemo(() => {
    let result = tasks;
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (task) =>
          (task.title || '').toLowerCase().includes(query) ||
          task.prompt.toLowerCase().includes(query),
      );
    }
    switch (filterBy) {
      case 'running':
        return result.filter((task) => task.status === 'running');
      case 'completed':
        return result.filter((task) => task.status === 'completed');
      case 'error':
        return result.filter((task) => task.status === 'error');
      case 'favorites':
        return result.filter((task) => task.favorite);
      default:
        return result;
    }
  }, [tasks, searchQuery, filterBy]);

  const filteredAndSortedTasks = useMemo(() => {
    const sorted = [...filteredTasks];
    switch (sortBy) {
      case 'newest':
        sorted.sort(
          (a, b) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        );
        break;
      case 'oldest':
        sorted.sort(
          (a, b) =>
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
        );
        break;
      case 'name-az':
        sorted.sort((a, b) => a.prompt.localeCompare(b.prompt));
        break;
      case 'name-za':
        sorted.sort((a, b) => b.prompt.localeCompare(a.prompt));
        break;
      case 'recently-updated':
        sorted.sort(
          (a, b) =>
            new Date(b.updated_at || b.created_at).getTime() -
            new Date(a.updated_at || a.created_at).getTime(),
        );
        break;
    }
    return sorted;
  }, [filteredTasks, sortBy]);

  const statusCounts = useMemo(() => {
    const counts = {
      all: tasks.length,
      running: 0,
      completed: 0,
      error: 0,
      favorites: 0,
    };
    for (const task of tasks) {
      if (task.status === 'running') counts.running++;
      if (task.status === 'completed') counts.completed++;
      if (task.status === 'error') counts.error++;
      if (task.favorite) counts.favorites++;
    }
    return counts;
  }, [tasks]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (
        document.activeElement === searchInputRef.current &&
        e.key !== 'Escape'
      )
        return;

      if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
        e.preventDefault();
        setSelectedTasks(new Set(filteredAndSortedTasks.map((x) => x.id)));
      }
      if (e.key === 'Escape') {
        if (showDeleteConfirm) setShowDeleteConfirm(false);
        else if (selectedTasks.size > 0) setSelectedTasks(new Set());
        else if (searchQuery) setSearchQuery('');
      }
      if (
        (e.key === 'Delete' || e.key === 'Backspace') &&
        selectedTasks.size > 0 &&
        document.activeElement !== searchInputRef.current
      ) {
        e.preventDefault();
        setShowDeleteConfirm(true);
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [selectedTasks, showDeleteConfirm, searchQuery, filteredAndSortedTasks]);

  const handleToggleSelect = useCallback((taskId: string) => {
    setSelectedTasks((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  }, []);

  const handleNavigate = useCallback(
    (taskId: string) => {
      navigate(`/task-v2/${taskId}`, { state: null });
    },
    [navigate],
  );

  const handleSelectAll = useCallback(() => {
    setSelectedTasks((prev) =>
      prev.size === filteredAndSortedTasks.length
        ? new Set()
        : new Set(filteredAndSortedTasks.map((x) => x.id)),
    );
  }, [filteredAndSortedTasks]);

  const handleBatchDelete = useCallback(async () => {
    if (selectedTasks.size === 0) return;
    setIsDeleting(true);
    try {
      const ids = Array.from(selectedTasks);
      if (deleteAlsoFolder) {
        for (const id of ids) {
          try {
            const task = await getTask(id);
            if (task) {
              const settings = getSettings();
              const workDir = settings.workDir || `~/${APP_DATA_DIR}`;
              const expanded = await expandPath(workDir);
              await fetch(`${API_BASE_URL}/files/delete-dir`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  path: `${expanded}/sessions/session-${task.id}`,
                }),
              });
            }
          } catch {
            /* continue */
          }
        }
      }
      await batchDeleteTasks(ids);
      onTasksChange(tasks.filter((x) => !selectedTasks.has(x.id)));
      setSelectedTasks(new Set());
      setShowDeleteConfirm(false);
      setDeleteAlsoFolder(false);
    } catch (error) {
      if (import.meta.env.DEV) console.error('Failed to batch delete:', error);
    } finally {
      setIsDeleting(false);
    }
  }, [selectedTasks, deleteAlsoFolder, tasks, onTasksChange]);

  const handleOpenFolder = useCallback(
    async (taskId: string) => {
      try {
        const task = tasks.find((x) => x.id === taskId);
        const settings = getSettings();
        const workDir = settings.workDir || `~/${APP_DATA_DIR}`;
        const expandedWorkDir = await expandPath(workDir);
        const folderName = task?.session_id || `session-${taskId}`;
        const folderPath = `${expandedWorkDir}/sessions/${folderName}`;
        await fetch(`${API_BASE_URL}/files/open`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: folderPath, createIfMissing: true }),
        });
      } catch {
        // best-effort
      }
    },
    [tasks],
  );

  return (
    <>
      <LibraryToolbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        filterBy={filterBy}
        onFilterChange={setFilterBy}
        sortBy={sortBy}
        onSortChange={setSortBy}
        totalCount={filteredAndSortedTasks.length}
        selectedCount={selectedTasks.size}
        statusCounts={statusCounts}
        onSelectAll={handleSelectAll}
        onDeleteSelected={() => setShowDeleteConfirm(true)}
        t={t}
      />

      {isLoading ? (
        <div className="py-12">
          <SkeletonShimmer lines={5} className="mx-1" />
        </div>
      ) : filteredAndSortedTasks.length === 0 ? (
        <motion.div
          className="flex flex-col items-center justify-center py-20 text-center"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: DURATION.moderate, ease: EASE.out }}
        >
          <h3 className="text-foreground mb-2 text-lg font-medium">
            {searchQuery || filterBy !== 'all'
              ? t.library.noChatsFound
              : t.library.noChatsYet}
          </h3>
          <p className="text-muted-foreground text-sm">
            {searchQuery || filterBy !== 'all'
              ? t.library.adjustSearch
              : t.library.startNewTask}
          </p>
        </motion.div>
      ) : (
        <div className="border-border border-t">
          {filteredAndSortedTasks.map((task, index) => (
            <LibraryTaskRow
              key={task.id}
              task={task}
              index={index}
              isSelected={selectedTasks.has(task.id)}
              isRunningBg={runningTaskIds.includes(task.id)}
              profileName={
                profileMap[task.assignee_profile_id ?? ''] ?? undefined
              }
              t={t}
              onToggleSelect={handleToggleSelect}
              onNavigate={handleNavigate}
              onToggleFavorite={onToggleFavorite}
              onOpenFolder={handleOpenFolder}
            />
          ))}
        </div>
      )}

      <LibraryDeleteDialog
        open={showDeleteConfirm}
        count={selectedTasks.size}
        isDeleting={isDeleting}
        deleteAlsoFolder={deleteAlsoFolder}
        onDeleteAlsoFolderChange={setDeleteAlsoFolder}
        onConfirm={handleBatchDelete}
        onCancel={() => {
          setShowDeleteConfirm(false);
          setDeleteAlsoFolder(false);
        }}
        t={t}
      />
    </>
  );
}
