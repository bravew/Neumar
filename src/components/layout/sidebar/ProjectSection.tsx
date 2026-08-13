import { useState } from 'react';

import { useNavigate } from 'react-router-dom';

import {
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CircleX,
  Loader2,
} from 'lucide-react';

import { cn } from '@/shared/lib/utils';

interface SidebarTask {
  id: string;
  title: string | null;
  prompt: string;
  status: string;
}

interface SidebarProject {
  id: string;
  name: string;
  color: string | null;
  workspace: string | null;
  tasks: SidebarTask[];
  task_count: number;
}

interface ProjectSectionProps {
  project: SidebarProject;
  currentTaskId?: string;
}

function TaskStatusDot({ status }: { status: string }) {
  if (status === 'completed')
    return <CircleCheck className="size-3 shrink-0 text-green-500" />;
  if (status === 'error')
    return <CircleX className="size-3 shrink-0 text-red-500" />;
  if (status === 'running')
    return <Loader2 className="size-3 shrink-0 animate-spin text-blue-500" />;
  return (
    <div className="bg-muted-foreground/30 size-3 shrink-0 rounded-full" />
  );
}

export function ProjectSection({
  project,
  currentTaskId,
}: ProjectSectionProps) {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(false);

  return (
    <div>
      {/* Project header */}
      <button
        onClick={() => setExpanded((p) => !p)}
        className="hover:bg-sidebar-accent/50 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 transition-colors"
      >
        {expanded ? (
          <ChevronDown className="text-sidebar-foreground/40 size-3 shrink-0" />
        ) : (
          <ChevronRight className="text-sidebar-foreground/40 size-3 shrink-0" />
        )}
        <div
          className="size-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: project.color || '#6366f1' }}
        />
        <span
          className="text-sidebar-foreground min-w-0 flex-1 truncate text-left text-sm"
          onClick={(e) => {
            e.stopPropagation();
            navigate(`/projects/${project.id}`);
          }}
        >
          {project.name}
        </span>
        {project.task_count > 0 && (
          <span className="text-sidebar-foreground/40 shrink-0 text-xs tabular-nums">
            {project.task_count}
          </span>
        )}
      </button>

      {/* Expanded task list */}
      {expanded && project.tasks.length > 0 && (
        <div className="ml-5 space-y-0.5 pb-1 pl-2">
          {project.tasks.map((task) => (
            <button
              key={task.id}
              onClick={() => navigate(`/task-v2/${task.id}`, { state: null })}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2 py-1 text-left transition-colors',
                currentTaskId === task.id
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                  : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground',
              )}
            >
              <TaskStatusDot status={task.status} />
              <span className="min-w-0 flex-1 truncate text-xs">
                {task.title || task.prompt}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
