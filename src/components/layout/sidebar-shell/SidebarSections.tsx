import { useLocation, useNavigate } from 'react-router-dom';

import { cn } from '@/shared/lib/utils';
import type { SidebarSection } from '@/shared/modes/types';
import { useLanguage } from '@/shared/providers/language-provider';

interface SidebarSectionsProps {
  sections: SidebarSection[];
}

export function SidebarSections({ sections }: SidebarSectionsProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { tt } = useLanguage();

  return (
    <nav className="flex shrink-0 flex-col gap-1 px-3">
      {sections.map((section) => {
        const Icon = section.icon;
        const [hrefPath = '', hrefHash = ''] = section.href?.split('#') ?? [];
        const targetHash = hrefHash ? `#${hrefHash}` : '';
        const active =
          !!hrefPath &&
          (targetHash
            ? location.pathname === hrefPath && location.hash === targetHash
            : (location.pathname === hrefPath && !location.hash) ||
              (hrefPath !== '/' &&
                location.pathname.startsWith(`${hrefPath}/`)));
        const badge = section.badge?.();
        return (
          <button
            key={section.id}
            type="button"
            onClick={() =>
              section.href && navigate(section.href, { viewTransition: true })
            }
            className={cn(
              'flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
              active
                ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
                : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground',
            )}
          >
            {Icon && <Icon className="size-4 shrink-0" />}
            <span className="min-w-0 flex-1 truncate text-left">
              {tt(section.labelKey)}
            </span>
            {badge ? (
              <span className="bg-primary text-primary-foreground rounded-full px-1.5 py-0.5 text-[10px] font-semibold">
                {badge}
              </span>
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}
