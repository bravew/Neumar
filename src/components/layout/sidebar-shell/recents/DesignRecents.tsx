import { useNavigate } from 'react-router-dom';

import { Paintbrush } from 'lucide-react';

import { useDesignProjects } from '@/shared/hooks/useDesignMode';
import { cn } from '@/shared/lib/utils';
import type { RecentsSourceProps } from '@/shared/modes/types';
import { useLanguage } from '@/shared/providers/language-provider';

export function DesignRecents({ searchQuery, activeId }: RecentsSourceProps) {
  const navigate = useNavigate();
  const { projects, loading } = useDesignProjects();
  const { t } = useLanguage();
  const filtered = projects
    .filter((project) =>
      project.title.toLowerCase().includes(searchQuery.toLowerCase()),
    )
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, 30);

  if (loading) {
    return (
      <p className="text-sidebar-foreground/50 px-2 py-2 text-xs">
        {t.common.loading}
      </p>
    );
  }

  if (filtered.length === 0) {
    return (
      <p className="text-sidebar-foreground/50 px-2 py-2 text-xs">
        {t.design.noMatches}
      </p>
    );
  }

  return (
    <div className="space-y-0.5">
      {filtered.map((project) => {
        const active = activeId === project.id;
        return (
          <button
            key={project.id}
            type="button"
            onClick={() => navigate(`/design/${project.id}`)}
            className={cn(
              'flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 text-sm transition-colors',
              active
                ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground',
            )}
          >
            <Paintbrush className="size-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate text-left">
              {project.title}
            </span>
          </button>
        );
      })}
    </div>
  );
}
