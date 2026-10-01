import { useNavigate } from 'react-router-dom';

import { Clapperboard } from 'lucide-react';

import { preloadRoute } from '@/app/route-preload';
import { AsyncList } from '@/components/common/async-list';
import { useVideoProjects } from '@/shared/hooks/useVideoProject';
import { cn } from '@/shared/lib/utils';
import type { RecentsSourceProps } from '@/shared/modes/types';
import { useLanguage } from '@/shared/providers/language-provider';

export function VideoRecents({ searchQuery, activeId }: RecentsSourceProps) {
  const navigate = useNavigate();
  const { projects, loading, error } = useVideoProjects();
  const { t } = useLanguage();
  const filtered = projects
    .filter((project) =>
      project.name.toLowerCase().includes(searchQuery.toLowerCase()),
    )
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, 30);

  return (
    <AsyncList
      status={loading ? 'loading' : error ? 'error' : 'ready'}
      empty={filtered.length === 0}
      renderSkeleton={() => (
        <div className="space-y-2 px-2 py-2" aria-busy="true">
          <div className="bg-sidebar-accent h-8 animate-pulse rounded-md" />
          <div className="bg-sidebar-accent h-8 animate-pulse rounded-md" />
          <div className="bg-sidebar-accent h-8 animate-pulse rounded-md" />
        </div>
      )}
      renderError={() => (
        <p className="text-sidebar-foreground/50 px-2 py-2 text-xs">
          {t.common.error}
        </p>
      )}
      renderEmpty={() => (
        <p className="text-sidebar-foreground/50 px-2 py-2 text-xs">
          {searchQuery ? t.video.entry.noMatchesTitle : t.nav.noRecentItems}
        </p>
      )}
    >
      <div className="space-y-0.5">
        {filtered.map((project) => {
          const href = `/video/${project.id}`;
          return (
            <button
              key={project.id}
              type="button"
              onPointerEnter={() => preloadRoute(href)}
              onFocus={() => preloadRoute(href)}
              onClick={() => navigate(href)}
              className={cn(
                'flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 text-sm transition-colors',
                activeId === project.id
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                  : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground',
              )}
            >
              <Clapperboard className="size-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate text-left">
                {project.name}
              </span>
            </button>
          );
        })}
      </div>
    </AsyncList>
  );
}
