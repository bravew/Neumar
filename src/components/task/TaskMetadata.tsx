import { useCallback, useEffect, useState } from 'react';

import { Bot, ChevronDown, X } from 'lucide-react';

import { API_BASE_URL } from '@/config';
import { useAgentProfiles } from '@/shared/hooks/useAgentProfiles';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

// ============================================================================
// Types
// ============================================================================

interface Project {
  id: string;
  name: string;
  color: string | null;
}

interface TaskMetadataProps {
  taskId: string;
  projectId?: string | null;
  priority?: string;
  labels?: string | null;
  blockedReason?: string | null;
  assigneeProfileId?: string | null;
}

const PRIORITY_OPTIONS = [
  { value: 'urgent', label: 'Urgent', color: 'bg-red-500' },
  { value: 'high', label: 'High', color: 'bg-orange-500' },
  { value: 'medium', label: 'Medium', color: 'bg-blue-500' },
  { value: 'low', label: 'Low', color: 'bg-gray-400' },
] as const;

// ============================================================================
// Component
// ============================================================================

export function TaskMetadata({
  taskId,
  projectId,
  priority = 'medium',
  labels,
  blockedReason,
  assigneeProfileId,
}: TaskMetadataProps) {
  const { t } = useLanguage();
  const [projects, setProjects] = useState<Project[]>([]);
  const [currentProjectId, setCurrentProjectId] = useState(projectId || '');
  const [currentPriority, setCurrentPriority] = useState(priority);
  const [currentProfileId, setCurrentProfileId] = useState(
    assigneeProfileId || '',
  );
  const [currentLabels, setCurrentLabels] = useState<string[]>(() => {
    try {
      return labels ? JSON.parse(labels) : [];
    } catch {
      return [];
    }
  });
  const [newLabel, setNewLabel] = useState('');
  const [showPriorityMenu, setShowPriorityMenu] = useState(false);
  const { profiles } = useAgentProfiles('active');

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${API_BASE_URL}/db/projects?status=active`, {
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : []))
      .then(setProjects)
      .catch(() => {});
    return () => controller.abort();
  }, []);

  const patchTask = useCallback(
    (updates: Record<string, unknown>) => {
      fetch(`${API_BASE_URL}/db/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      }).catch(() => {});
    },
    [taskId],
  );

  const handleProjectChange = useCallback(
    (value: string) => {
      setCurrentProjectId(value);
      patchTask({ project_id: value || null });
    },
    [patchTask],
  );

  const handlePriorityChange = useCallback(
    (value: string) => {
      setCurrentPriority(value);
      setShowPriorityMenu(false);
      patchTask({ priority: value });
    },
    [patchTask],
  );

  const handleProfileChange = useCallback(
    (value: string) => {
      setCurrentProfileId(value);
      patchTask({ assignee_profile_id: value || null });
    },
    [patchTask],
  );

  const handleAddLabel = useCallback(() => {
    if (!newLabel.trim()) return;
    const updated = [...currentLabels, newLabel.trim()];
    setCurrentLabels(updated);
    setNewLabel('');
    patchTask({ labels: JSON.stringify(updated) });
  }, [newLabel, currentLabels, patchTask]);

  const handleRemoveLabel = useCallback(
    (index: number) => {
      const updated = currentLabels.filter((_, i) => i !== index);
      setCurrentLabels(updated);
      patchTask({
        labels: updated.length > 0 ? JSON.stringify(updated) : null,
      });
    },
    [currentLabels, patchTask],
  );

  const priorityOption = PRIORITY_OPTIONS.find(
    (p) => p.value === currentPriority,
  );

  const selectedProfile = profiles.find((p) => p.id === currentProfileId);

  return (
    <div className="space-y-4">
      {/* Project */}
      <div>
        <label className="text-muted-foreground mb-1.5 block text-xs font-medium">
          {t.task.assignToProject ?? 'Project'}
        </label>
        <select
          value={currentProjectId}
          onChange={(e) => handleProjectChange(e.target.value)}
          className="bg-background border-border text-foreground w-full rounded-lg border px-3 py-1.5 text-sm"
        >
          <option value="">{t.task.noProject ?? 'No project'}</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      {/* Assigned Agent Profile */}
      <div>
        <label className="text-muted-foreground mb-1.5 block text-xs font-medium">
          {t.profiles.assignedAgent}
        </label>
        <div className="relative">
          <select
            value={currentProfileId}
            onChange={(e) => handleProfileChange(e.target.value)}
            className="bg-background border-border text-foreground w-full appearance-none rounded-lg border py-1.5 pr-8 pl-8 text-sm"
          >
            <option value="">{t.profiles.noAgent}</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.role ? ` — ${p.role}` : ''}
              </option>
            ))}
          </select>
          <div className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2">
            {selectedProfile ? (
              <div
                className="flex size-4 items-center justify-center rounded-full"
                style={{
                  backgroundColor: selectedProfile.avatar_color || '#6366f1',
                }}
              >
                <Bot className="size-2.5 text-white" />
              </div>
            ) : (
              <Bot className="text-muted-foreground size-4" />
            )}
          </div>
          <ChevronDown className="text-muted-foreground pointer-events-none absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2" />
        </div>
      </div>

      {/* Priority */}
      <div>
        <label className="text-muted-foreground mb-1.5 block text-xs font-medium">
          {t.task.priority ?? 'Priority'}
        </label>
        <div className="relative">
          <button
            onClick={() => setShowPriorityMenu((p) => !p)}
            className="bg-background border-border text-foreground flex w-full items-center gap-2 rounded-lg border px-3 py-1.5 text-sm"
          >
            <div
              className={cn(
                'size-2 rounded-full',
                priorityOption?.color || 'bg-blue-500',
              )}
            />
            {priorityOption?.label || 'Medium'}
            <ChevronDown className="ml-auto size-3.5" />
          </button>
          {showPriorityMenu && (
            <div className="bg-popover border-border absolute z-10 mt-1 w-full rounded-lg border py-1 shadow-md">
              {PRIORITY_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => handlePriorityChange(opt.value)}
                  className="hover:bg-accent flex w-full items-center gap-2 px-3 py-1.5 text-sm"
                >
                  <div className={cn('size-2 rounded-full', opt.color)} />
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Labels */}
      <div>
        <label className="text-muted-foreground mb-1.5 block text-xs font-medium">
          {t.task.labels ?? 'Labels'}
        </label>
        <div className="flex flex-wrap gap-1.5">
          {currentLabels.map((label, i) => (
            <span
              key={i}
              className="bg-accent text-accent-foreground flex items-center gap-1 rounded-md px-2 py-0.5 text-xs"
            >
              {label}
              <button
                onClick={() => handleRemoveLabel(i)}
                className="hover:text-destructive"
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
          <input
            type="text"
            placeholder={t.task.addLabel ?? 'Add label...'}
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddLabel()}
            className="text-foreground min-w-[80px] flex-1 bg-transparent py-0.5 text-xs outline-none placeholder:text-gray-400"
          />
        </div>
      </div>

      {/* Blocked Reason */}
      {blockedReason && (
        <div>
          <label className="text-muted-foreground mb-1.5 block text-xs font-medium">
            {t.task.blockedReason ?? 'Blocked'}
          </label>
          <p className="text-destructive text-sm">{blockedReason}</p>
        </div>
      )}
    </div>
  );
}
