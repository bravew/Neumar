import { useCallback, useEffect, useState } from 'react';

import { useNavigate, useParams } from 'react-router-dom';

import {
  ArrowLeft,
  CircleCheck,
  CircleX,
  FolderOpen,
  Loader2,
  MessageCirclePlus,
  Plus,
  X,
} from 'lucide-react';
import { motion } from 'motion/react';

import { LeftSidebar, SidebarProvider } from '@/components/layout';
import { API_BASE_URL } from '@/config';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

// ============================================================================
// Constants
// ============================================================================

const PRIORITY_COLOR_MAP: Record<string, string> = {
  urgent: 'bg-red-500',
  high: 'bg-orange-500',
  medium: 'bg-blue-500',
  low: 'bg-gray-400',
};

// ============================================================================
// Types
// ============================================================================

interface Project {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  workspace: string | null;
  status: string;
  task_counts: Record<string, number>;
  created_at: string;
  updated_at: string;
}

interface Task {
  id: string;
  prompt: string;
  title: string | null;
  status: string;
  priority: string;
  created_at: string;
}

// ============================================================================
// Page Component
// ============================================================================

export function ProjectDetailPage() {
  return (
    <SidebarProvider>
      <ProjectDetailContent />
    </SidebarProvider>
  );
}

// ============================================================================
// Content
// ============================================================================

function ProjectDetailContent() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useLanguage();
  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAssignPicker, setShowAssignPicker] = useState(false);
  const [unassignedTasks, setUnassignedTasks] = useState<Task[]>([]);

  const fetchProject = useCallback(
    async (signal?: AbortSignal) => {
      if (!id) return;
      try {
        const [projRes, projectTasksRes, unassignedTasksRes] =
          await Promise.all([
            fetch(`${API_BASE_URL}/db/projects/${id}`, { signal }),
            fetch(
              `${API_BASE_URL}/db/tasks?project_id=${encodeURIComponent(id)}`,
              { signal },
            ),
            fetch(`${API_BASE_URL}/db/tasks?unassigned=true`, { signal }),
          ]);
        if (projRes.ok) setProject(await projRes.json());
        if (projectTasksRes.ok) {
          setTasks((await projectTasksRes.json()) as Task[]);
        }
        if (unassignedTasksRes.ok) {
          setUnassignedTasks((await unassignedTasksRes.json()) as Task[]);
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return;
      } finally {
        setLoading(false);
      }
    },
    [id],
  );

  useEffect(() => {
    const controller = new AbortController();
    fetchProject(controller.signal);
    return () => controller.abort();
  }, [fetchProject]);

  const handleAssignTask = useCallback(
    async (taskId: string) => {
      if (!id) return;
      try {
        await fetch(`${API_BASE_URL}/db/tasks/${taskId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ project_id: id }),
        });
        fetchProject();
      } catch {
        // ignore
      }
    },
    [id, fetchProject],
  );

  const handleUnassignTask = useCallback(
    async (taskId: string) => {
      try {
        await fetch(`${API_BASE_URL}/db/tasks/${taskId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ project_id: null }),
        });
        fetchProject();
      } catch {
        // ignore
      }
    },
    [fetchProject],
  );

  if (loading) {
    return (
      <div className="bg-sidebar flex h-screen overflow-hidden">
        <LeftSidebar tasks={[]} />
        <main className="bg-background my-2 mr-2 flex flex-1 items-center justify-center overflow-hidden rounded-l-2xl shadow-sm">
          <Loader2 className="text-muted-foreground size-6 animate-spin" />
        </main>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="bg-sidebar flex h-screen overflow-hidden">
        <LeftSidebar tasks={[]} />
        <main className="bg-background my-2 mr-2 flex flex-1 items-center justify-center overflow-hidden rounded-l-2xl shadow-sm">
          <p className="text-muted-foreground">{t.projects.notFound}</p>
        </main>
      </div>
    );
  }

  return (
    <div className="bg-sidebar flex h-screen overflow-hidden">
      <LeftSidebar tasks={[]} />
      <main
        className="bg-background my-2 mr-2 flex flex-1 flex-col overflow-hidden rounded-l-2xl shadow-sm"
        data-testid="project-detail"
      >
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl px-6 py-8">
            <div className="w-full max-w-3xl">
              {/* Header */}
              <div className="mb-6">
                <button
                  onClick={() => navigate('/projects')}
                  className="text-muted-foreground hover:text-foreground mb-3 flex items-center gap-1 text-sm transition-colors"
                >
                  <ArrowLeft className="size-4" />
                  {t.projects.title}
                </button>
                <div className="flex items-center gap-3">
                  <div
                    className="size-5 shrink-0 rounded-full"
                    style={{
                      backgroundColor: project.color || '#6366f1',
                    }}
                  />
                  <h1 className="text-foreground text-2xl font-semibold">
                    {project.name}
                  </h1>
                </div>
                {project.description && (
                  <p className="text-muted-foreground mt-2">
                    {project.description}
                  </p>
                )}
                {/* Workspace + New Task row */}
                <div className="mt-3 flex items-center gap-3">
                  {project.workspace && (
                    <span
                      className="text-muted-foreground flex items-center gap-1.5 text-sm"
                      data-testid="project-workspace"
                    >
                      <FolderOpen className="size-3.5" />
                      {project.workspace}
                    </span>
                  )}
                  <div className="flex-1" />
                  <button
                    onClick={() =>
                      navigate('/', {
                        state: {
                          projectId: project.id,
                          projectWorkspace: project.workspace,
                          projectName: project.name,
                        },
                      })
                    }
                    data-testid="project-new-task-button"
                    className="bg-primary text-primary-foreground flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors hover:opacity-90"
                  >
                    <MessageCirclePlus className="size-4" />
                    {t.projects.newTaskInProject}
                  </button>
                </div>
              </div>

              {/* Tasks Section */}
              <section>
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-foreground text-lg font-medium">
                    {t.projects.tasksInProject}
                    {tasks.length > 0 && (
                      <span className="text-muted-foreground ml-1.5 text-sm font-normal">
                        ({tasks.length})
                      </span>
                    )}
                  </h2>
                  <button
                    onClick={() => setShowAssignPicker((p) => !p)}
                    className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-sm transition-colors"
                  >
                    <Plus className="size-4" />
                    {t.common.add}
                  </button>
                </div>

                {/* Assign Task Picker */}
                {showAssignPicker && (
                  <div className="bg-card border-border mb-3 max-h-48 overflow-y-auto rounded-lg border">
                    {unassignedTasks.length === 0 ? (
                      <p className="text-muted-foreground p-3 text-sm">
                        {t.common.noData}
                      </p>
                    ) : (
                      unassignedTasks.map((task) => (
                        <button
                          key={task.id}
                          onClick={() => handleAssignTask(task.id)}
                          className="hover:bg-accent/50 flex w-full items-center gap-2 px-3 py-2 text-left transition-colors"
                        >
                          <Plus className="text-muted-foreground size-3.5 shrink-0" />
                          <span className="text-foreground min-w-0 flex-1 truncate text-sm">
                            {task.title || task.prompt}
                          </span>
                          <TaskStatusIcon status={task.status} />
                        </button>
                      ))
                    )}
                  </div>
                )}

                {tasks.length === 0 && !showAssignPicker ? (
                  <p className="text-muted-foreground py-4 text-sm">
                    {t.projects.noTasksInProject}
                  </p>
                ) : (
                  <div className="space-y-2">
                    {tasks.map((task) => (
                      <motion.div
                        key={task.id}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="bg-card border-border hover:bg-accent/50 group flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors"
                        onClick={() =>
                          navigate(`/task-v2/${task.id}`, { state: null })
                        }
                      >
                        <TaskStatusIcon status={task.status} />
                        <span className="text-foreground min-w-0 flex-1 truncate text-sm">
                          {task.title || task.prompt}
                        </span>
                        <PriorityDot priority={task.priority} />
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleUnassignTask(task.id);
                          }}
                          className="text-muted-foreground hover:text-destructive shrink-0 opacity-0 transition-all group-hover:opacity-100"
                          title={t.task.removeFromProject}
                        >
                          <X className="size-3.5" />
                        </button>
                      </motion.div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

// ============================================================================
// Sub-components
// ============================================================================

function TaskStatusIcon({ status }: { status: string }) {
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

function PriorityDot({ priority }: { priority: string }) {
  return (
    <div
      className={cn(
        'size-2 shrink-0 rounded-full',
        PRIORITY_COLOR_MAP[priority] || 'bg-blue-500',
      )}
    />
  );
}
