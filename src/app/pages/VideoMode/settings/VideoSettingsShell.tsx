import type { ReactNode } from 'react';

import { NavLink, useNavigate } from 'react-router-dom';

import { ArrowLeft } from 'lucide-react';

import { LeftSidebar, SidebarProvider } from '@/components/layout';
import { useLanguage } from '@/shared/providers/language-provider';

interface VideoSettingsShellProps {
  title: string;
  description: string;
  children: ReactNode;
}

const LINKS = [
  { to: '/video/settings/providers', key: 'providers' },
  { to: '/video/settings/templates', key: 'templates' },
  { to: '/video/settings/brand', key: 'brand' },
  { to: '/video/library/assets', key: 'assets' },
  { to: '/video/settings/memory', key: 'memory' },
] as const;

export function VideoSettingsShell({
  title,
  description,
  children,
}: VideoSettingsShellProps) {
  const { t } = useLanguage();
  const navigate = useNavigate();

  return (
    <SidebarProvider>
      <div className="bg-sidebar flex h-screen overflow-hidden">
        <LeftSidebar tasks={[]} />
        <main className="bg-background my-2 mr-2 flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl shadow-sm">
          <header className="border-border flex items-center gap-3 border-b px-5 py-3">
            <button
              type="button"
              className="text-muted-foreground hover:bg-accent hover:text-foreground flex size-8 items-center justify-center rounded-md"
              aria-label={t.video.project.back}
              onClick={() => navigate('/video')}
            >
              <ArrowLeft className="size-4" />
            </button>
            <div className="min-w-0">
              <h1 className="text-foreground truncate text-sm font-semibold">
                {title}
              </h1>
              <p className="text-muted-foreground text-xs">{description}</p>
            </div>
          </header>
          <div className="border-border flex flex-wrap gap-2 border-b px-5 py-2">
            {LINKS.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                className={({ isActive }) =>
                  isActive
                    ? 'bg-primary text-primary-foreground rounded-md px-3 py-1.5 text-xs font-medium'
                    : 'border-border hover:bg-accent rounded-md border px-3 py-1.5 text-xs'
                }
              >
                {t.video.settings[link.key].nav}
              </NavLink>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-5">{children}</div>
        </main>
      </div>
    </SidebarProvider>
  );
}
