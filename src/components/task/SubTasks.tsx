import { useCallback, useEffect, useState } from 'react';

import { useNavigate } from 'react-router-dom';

import {
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CircleX,
  Loader2,
  Plus,
} from 'lucide-react';

import { API_BASE_URL } from '@/config';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import { randomUUID } from '@/shared/utils/uuid';

interface SubTask {
  id: string;
  prompt: string;
  title: string | null;
  status: string;
  priority: string;
}

interface SubTasksProps {
  taskId: string;
  sessionId: string;
}

const PRIORITY_COLORS: Record<string, string> = {
  urgent: 'bg-red-500',
  high: 'bg-orange-500',
  medium: 'bg-blue-500',
  low: 'bg-gray-400',
};

export function SubTasks({ taskId, sessionId }: SubTasksProps) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [children, setChildren] = useState<SubTask[]>([]);
  const [expanded, setExpanded] = useState(true);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [creating, setCreating] = useState(false);

  const fetchChildren = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const res = await fetch(`${API_BASE_URL}/db/tasks/${taskId}/children`, {
          signal,
        });
        if (res.ok) setChildren(await res.json());
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return;
      } finally {
        setLoading(false);
      }
    },
    [taskId],
  );

  useEffect(() => {
    const controller = new AbortController();
    fetchChildren(controller.signal);
    return () => controller.abort();
  }, [fetchChildren]);

  const handleCreate = useCallback(async () => {
    if (!newTitle.trim() || creating) return;
    setCreating(true);
    try {
      const res = await fetch(`${API_BASE_URL}/db/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: randomUUID(),
          session_id: sessionId,
          task_index: 0,
          prompt: newTitle.trim(),
          parent_task_id: taskId,
        }),
      });
      if (res.ok) {
        setNewTitle('');
        setShowForm(false);
        fetchChildren();
      }
    } catch {
      // ignore
    } finally {
      setCreating(false);
    }
  }, [newTitle, creating, sessionId, taskId, fetchChildren]);

  return (
    <div className="border-border rounded-lg border">
      <button
        onClick={() => setExpanded((p) => !p)}
        className="hover:bg-accent/50 flex w-full items-center gap-2 px-4 py-3 text-sm font-medium transition-colors"
      >
        {expanded ? (
          <ChevronDown className="size-4" />
        ) : (
          <ChevronRight className="size-4" />
        )}
        <span className="text-foreground">
          {t.task.subTasks ?? 'Sub-tasks'}
        </span>
        {children.length > 0 && (
          <span className="text-muted-foreground text-xs">
            ({children.length})
          </span>
        )}
      </button>

      {expanded && (
        <div className="border-border border-t px-4 py-2">
          {loading ? (
            <div className="flex justify-center py-4">
              <Loader2 className="text-muted-foreground size-4 animate-spin" />
            </div>
          ) : (
            <>
              {children.length === 0 && !showForm && (
                <p className="text-muted-foreground py-2 text-sm">
                  {t.common.noData}
                </p>
              )}
              <div className="space-y-1">
                {children.map((child) => (
                  <button
                    key={child.id}
                    onClick={() =>
                      navigate(`/task-v2/${child.id}`, { state: null })
                    }
                    className="hover:bg-accent/50 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors"
                  >
                    <StatusIcon status={child.status} />
                    <span className="text-foreground min-w-0 flex-1 truncate text-sm">
                      {child.title || child.prompt}
                    </span>
                    <div
                      className={cn(
                        'size-2 shrink-0 rounded-full',
                        PRIORITY_COLORS[child.priority] || 'bg-blue-500',
                      )}
                    />
                  </button>
                ))}
              </div>

              {showForm && (
                <div className="mt-2 flex gap-2">
                  <input
                    type="text"
                    placeholder={t.task.addSubTask ?? 'Add sub-task'}
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                    className="bg-background border-border text-foreground flex-1 rounded-md border px-2 py-1 text-sm"
                    autoFocus
                  />
                  <button
                    onClick={handleCreate}
                    disabled={!newTitle.trim() || creating}
                    className="bg-primary text-primary-foreground rounded-md px-2 py-1 text-sm disabled:opacity-50"
                  >
                    {creating ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      t.common.add
                    )}
                  </button>
                </div>
              )}

              <button
                onClick={() => setShowForm((p) => !p)}
                className="text-muted-foreground hover:text-foreground mt-2 flex items-center gap-1 text-xs transition-colors"
              >
                <Plus className="size-3" />
                {t.task.addSubTask ?? 'Add sub-task'}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'completed':
      return <CircleCheck className="size-4 shrink-0 text-green-500" />;
    case 'error':
      return <CircleX className="size-4 shrink-0 text-red-500" />;
    case 'running':
      return <Loader2 className="size-4 shrink-0 animate-spin text-blue-500" />;
    default:
      return (
        <div className="bg-muted-foreground/30 size-4 shrink-0 rounded-full" />
      );
  }
}
