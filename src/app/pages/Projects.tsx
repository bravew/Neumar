import { useCallback, useEffect, useState } from 'react';

import { useNavigate } from 'react-router-dom';

import { Archive, FolderKanban, FolderOpen, Loader2, Plus } from 'lucide-react';
import { motion } from 'motion/react';

import { LeftSidebar, SidebarProvider } from '@/components/layout';
import { API_BASE_URL } from '@/config';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import { randomUUID } from '@/shared/utils/uuid';

// ============================================================================
// Types
// ============================================================================

interface Project {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  status: 'active' | 'archived';
  created_at: string;
  updated_at: string;
}

// ============================================================================
// Page Component
// ============================================================================

export function ProjectsPage() {
  return (
    <SidebarProvider>
      <ProjectsContent />
    </SidebarProvider>
  );
}

// ============================================================================
// Content
// ============================================================================

function ProjectsContent() {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newColor, setNewColor] = useState('#6366f1');
  const [newWorkspace, setNewWorkspace] = useState('');
  const [creating, setCreating] = useState(false);

  const fetchProjects = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch(`${API_BASE_URL}/db/projects?status=active`, {
        signal,
      });
      if (res.ok) {
        const data = await res.json();
        setProjects(data);
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchProjects(controller.signal);
    return () => controller.abort();
  }, [fetchProjects]);

  const handleCreate = useCallback(async () => {
    if (!newName.trim() || creating) return;
    setCreating(true);
    try {
      const res = await fetch(`${API_BASE_URL}/db/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: randomUUID(),
          name: newName.trim(),
          description: newDescription.trim() || undefined,
          color: newColor,
          workspace: newWorkspace.trim() || undefined,
        }),
      });
      if (res.ok) {
        setNewName('');
        setNewDescription('');
        setNewWorkspace('');
        setShowForm(false);
        fetchProjects();
      }
    } catch {
      // ignore
    } finally {
      setCreating(false);
    }
  }, [
    newName,
    newDescription,
    newColor,
    newWorkspace,
    creating,
    fetchProjects,
  ]);

  const handleArchive = useCallback(
    async (id: string) => {
      try {
        await fetch(`${API_BASE_URL}/db/projects/${id}`, {
          method: 'DELETE',
        });
        fetchProjects();
      } catch {
        // ignore
      }
    },
    [fetchProjects],
  );

  return (
    <div className="bg-sidebar flex h-screen overflow-hidden">
      <LeftSidebar tasks={[]} />
      <main
        className="bg-background my-2 mr-2 flex flex-1 flex-col overflow-hidden rounded-l-2xl shadow-sm"
        data-testid="projects-page"
      >
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto flex max-w-3xl flex-col items-center px-6 py-8">
            <div className="w-full max-w-3xl">
              <div className="mb-6 flex items-center justify-between">
                <h1 className="text-foreground text-2xl font-semibold">
                  {t.projects.title}
                </h1>
                <button
                  onClick={() => setShowForm((p) => !p)}
                  data-testid="project-create-toggle"
                  className="bg-primary text-primary-foreground flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors hover:opacity-90"
                >
                  <Plus className="size-4" />
                  {t.projects.newProject}
                </button>
              </div>

              {showForm && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  className="bg-card border-border mb-6 overflow-hidden rounded-xl border p-4"
                >
                  <div className="space-y-3">
                    <input
                      type="text"
                      placeholder={t.projects.projectName}
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      data-testid="project-name-input"
                      className="bg-background border-border text-foreground w-full rounded-lg border px-3 py-2 text-sm"
                      autoFocus
                    />
                    <input
                      type="text"
                      placeholder={t.projects.description}
                      value={newDescription}
                      onChange={(e) => setNewDescription(e.target.value)}
                      data-testid="project-description-input"
                      className="bg-background border-border text-foreground w-full rounded-lg border px-3 py-2 text-sm"
                    />
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder={t.projects.workspacePlaceholder}
                        value={newWorkspace}
                        onChange={(e) => setNewWorkspace(e.target.value)}
                        data-testid="project-workspace-input"
                        className="bg-background border-border text-foreground flex-1 rounded-lg border px-3 py-2 text-sm"
                      />
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            const { open } =
                              await import('@tauri-apps/plugin-dialog');
                            const selected = await open({
                              directory: true,
                              multiple: false,
                              title: t.projects.workspace,
                            });
                            if (selected && typeof selected === 'string') {
                              setNewWorkspace(selected);
                            }
                          } catch {
                            // Web fallback: prompt
                            const path = window.prompt(
                              t.projects.workspacePlaceholder,
                            );
                            if (path?.trim()) setNewWorkspace(path.trim());
                          }
                        }}
                        className="border-border text-muted-foreground hover:text-foreground hover:bg-accent shrink-0 rounded-lg border px-3 py-2 transition-colors"
                      >
                        <FolderOpen className="size-4" />
                      </button>
                    </div>
                    <div className="flex items-center gap-3">
                      <label className="text-muted-foreground text-sm">
                        {t.projects.color}
                      </label>
                      <input
                        type="color"
                        value={newColor}
                        onChange={(e) => setNewColor(e.target.value)}
                        className="h-8 w-8 cursor-pointer rounded border-none"
                      />
                    </div>
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => setShowForm(false)}
                        className="text-muted-foreground hover:text-foreground rounded-lg px-3 py-1.5 text-sm transition-colors"
                      >
                        {t.common.cancel}
                      </button>
                      <button
                        onClick={handleCreate}
                        disabled={!newName.trim() || creating}
                        data-testid="project-submit-button"
                        className="bg-primary text-primary-foreground rounded-lg px-4 py-1.5 text-sm font-medium transition-colors hover:opacity-90 disabled:opacity-50"
                      >
                        {creating ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          t.projects.newProject
                        )}
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}

              {loading ? (
                <div className="flex items-center justify-center py-20">
                  <Loader2 className="text-muted-foreground size-6 animate-spin" />
                </div>
              ) : projects.length === 0 ? (
                <div className="text-muted-foreground flex flex-col items-center py-20 text-center">
                  <FolderKanban className="mb-3 size-12 opacity-30" />
                  <p>{t.projects.noProjects}</p>
                </div>
              ) : (
                <div className="grid gap-3" data-testid="project-list">
                  {projects.map((project) => (
                    <ProjectCard
                      key={project.id}
                      project={project}
                      onClick={() => navigate(`/projects/${project.id}`)}
                      onArchive={() => handleArchive(project.id)}
                      archiveLabel={t.projects.archiveProject}
                    />
                  ))}
                </div>
              )}
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

function ProjectCard({
  project,
  onClick,
  onArchive,
  archiveLabel,
}: {
  project: Project;
  onClick: () => void;
  onArchive: () => void;
  archiveLabel: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        'bg-card border-border group flex cursor-pointer items-center gap-4 rounded-xl border p-4 transition-colors',
        'hover:bg-accent/50',
      )}
      onClick={onClick}
      data-testid={`project-card-${project.id}`}
    >
      <div
        className="size-4 shrink-0 rounded-full"
        style={{ backgroundColor: project.color || '#6366f1' }}
      />
      <div className="min-w-0 flex-1">
        <h3 className="text-foreground truncate font-medium">{project.name}</h3>
        {project.description && (
          <p className="text-muted-foreground mt-0.5 truncate text-sm">
            {project.description}
          </p>
        )}
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onArchive();
        }}
        className="text-muted-foreground hover:text-destructive shrink-0 opacity-0 transition-all group-hover:opacity-100"
        title={archiveLabel}
      >
        <Archive className="size-4" />
      </button>
    </motion.div>
  );
}
