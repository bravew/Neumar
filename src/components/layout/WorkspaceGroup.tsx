import { useState } from 'react';

import {
  ChevronDown,
  ChevronRight,
  FolderOpen,
  Pin,
  PinOff,
} from 'lucide-react';

import type { Task } from '@/shared/db';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

import { TaskItem } from './sidebar/TaskItem';

interface WorkspaceGroupProps {
  workDir: string | null;
  tasks: Task[];
  currentTaskId?: string;
  loadingTaskId?: string;
  runningTaskIds?: string[];
  pinned?: boolean;
  onPin?: () => void;
  onSelect?: (taskId: string) => void;
  onDelete?: (taskId: string, e: React.MouseEvent) => void;
  onToggleFavorite?: (task: Task, e: React.MouseEvent) => void;
  onViewFolder?: (taskId: string, e: React.MouseEvent) => void;
  onRename?: (taskId: string, newTitle: string) => Promise<void>;
  onRegenerate?: (taskId: string) => Promise<void>;
  taskTitleOverrides?: Record<string, string>;
}

function basename(p: string): string {
  return p.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? p;
}

function storageKey(workDir: string | null): string {
  return `workspace-group-${workDir ?? 'default'}`;
}

function loadExpanded(workDir: string | null): boolean {
  try {
    const v = localStorage.getItem(storageKey(workDir));
    return v === null ? true : v === 'true';
  } catch {
    return true;
  }
}

export function WorkspaceGroup({
  workDir,
  tasks,
  currentTaskId,
  loadingTaskId,
  runningTaskIds = [],
  pinned = false,
  onPin,
  onSelect,
  onDelete,
  onToggleFavorite,
  onViewFolder,
  onRename,
  onRegenerate,
  taskTitleOverrides,
}: WorkspaceGroupProps) {
  const { t } = useLanguage();
  const [expanded, setExpanded] = useState(() => loadExpanded(workDir));
  const [hovered, setHovered] = useState(false);

  const toggleExpanded = () => {
    const next = !expanded;
    setExpanded(next);
    try {
      localStorage.setItem(storageKey(workDir), String(next));
    } catch {
      // ignore
    }
  };

  const displayName = workDir
    ? basename(workDir)
    : (t.home.workspaceDefault ?? 'Default');

  const totalCost = tasks.reduce((acc, t) => acc + (t.cost ?? 0), 0);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Group header */}
      <button
        onClick={toggleExpanded}
        className="hover:bg-sidebar-accent/50 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 transition-colors"
      >
        {expanded ? (
          <ChevronDown className="text-sidebar-foreground/40 size-3 shrink-0" />
        ) : (
          <ChevronRight className="text-sidebar-foreground/40 size-3 shrink-0" />
        )}
        <FolderOpen className="text-sidebar-foreground/60 size-3.5 shrink-0" />
        <span className="text-sidebar-foreground min-w-0 flex-1 truncate text-left text-sm">
          {displayName}
        </span>

        {/* Task count badge */}
        {tasks.length > 0 && (
          <span className="text-sidebar-foreground/40 shrink-0 text-xs tabular-nums">
            {tasks.length}
          </span>
        )}

        {/* Total cost */}
        {totalCost > 0 && (
          <span className="text-sidebar-foreground/30 shrink-0 text-xs tabular-nums">
            ${totalCost.toFixed(3)}
          </span>
        )}

        {/* Pin/unpin button — shown on hover */}
        {onPin && hovered && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onPin();
            }}
            className={cn(
              'text-sidebar-foreground/40 hover:text-sidebar-foreground shrink-0 transition-colors',
              pinned && 'text-primary',
            )}
            title={
              pinned
                ? (t.home.workspacePinned ?? 'Unpin workspace')
                : (t.home.workspacePin ?? 'Pin workspace')
            }
            aria-label={
              pinned
                ? (t.home.workspacePinned ?? 'Unpin workspace')
                : (t.home.workspacePin ?? 'Pin workspace')
            }
          >
            {pinned ? (
              <PinOff className="size-3" />
            ) : (
              <Pin className="size-3" />
            )}
          </button>
        )}
      </button>

      {/* Task list */}
      {expanded && tasks.length > 0 && (
        <div className="ml-3 space-y-0.5 pb-1 pl-2">
          {tasks.map((task) => {
            const displayTask = taskTitleOverrides?.[task.id]
              ? { ...task, title: taskTitleOverrides[task.id] }
              : task;
            return (
              <TaskItem
                key={task.id}
                task={displayTask}
                isActive={currentTaskId === task.id}
                isLoading={loadingTaskId === task.id}
                isRunning={runningTaskIds.includes(task.id)}
                variant="sidebar"
                t={t}
                onSelect={onSelect ?? (() => {})}
                onDelete={onDelete ?? (() => {})}
                onToggleFavorite={onToggleFavorite ?? (() => {})}
                onViewFolder={onViewFolder ?? (() => {})}
                onRename={onRename ?? (async () => {})}
                onRegenerate={onRegenerate ?? (async () => {})}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
