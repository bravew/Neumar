import { useNavigate, useLocation } from 'react-router-dom';

import {
  Bot,
  Clapperboard,
  Library,
  Paintbrush,
  SlidersHorizontal,
} from 'lucide-react';

import ImageLogo from '@/assets/logo.png';
import { SidebarFooter } from '@/components/layout/sidebar-shell/SidebarFooter';
import { APP_NAME } from '@/config';
import { ModeRegistry } from '@/shared/modes/ModeRegistry';
import { useMode } from '@/shared/modes/useMode';
import { useLanguage } from '@/shared/providers/language-provider';

import { RailItem } from './RailItem';
import { RailMenu, usePendingApprovalCount } from './RailMenu';

const ICONS = {
  tasks: Bot,
  automate: SlidersHorizontal,
  design: Paintbrush,
  video: Clapperboard,
} as const;

export function AppRail() {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useLanguage();
  const { setActiveMode } = useMode();
  const pending = usePendingApprovalCount();
  const modes = ModeRegistry.list().filter((mode) => mode.railItem);
  const primary = modes.filter((mode) => mode.railItem?.group === 'primary');
  const studios = modes.filter((mode) => mode.railItem?.group === 'studios');
  const labels = t.modes as unknown as Record<string, { label?: string }>;

  const modeActive = (id: string, root: string) => {
    if (id === 'tasks') {
      return location.pathname === '/' || location.pathname.startsWith('/task');
    }
    return (
      location.pathname === root || location.pathname.startsWith(`${root}/`)
    );
  };

  return (
    <nav
      data-testid="app-rail"
      aria-label={t.nav.menu}
      className="border-border flex w-14 shrink-0 flex-col items-center gap-2 border-r py-3"
    >
      {/* Always Home, never the resumed task: the logo is the way out. */}
      <RailItem
        label={t.nav.home}
        data-testid="rail-home-logo"
        onSelect={() => navigate('/')}
        className="mb-1"
      >
        <img src={ImageLogo} alt={APP_NAME} className="size-7 object-contain" />
      </RailItem>
      {primary.map((mode) => {
        const Icon = ICONS[mode.id as keyof typeof ICONS] ?? Bot;
        return (
          <RailItem
            key={mode.id}
            label={labels[mode.id]?.label ?? mode.id}
            shortcut={mode.shortcutSlot ? `⌘${mode.shortcutSlot}` : undefined}
            active={modeActive(mode.id, mode.rootPath)}
            badge={mode.id === 'tasks' && pending > 0}
            onSelect={() => setActiveMode(mode.id)}
          >
            <Icon className="size-4" />
          </RailItem>
        );
      })}
      <RailItem
        label={t.library.title}
        active={location.pathname.startsWith('/library')}
        onSelect={() => navigate('/library')}
      >
        <Library className="size-4" />
      </RailItem>
      <div className="bg-border my-1 h-px w-6" />
      {studios.map((mode) => {
        const Icon = ICONS[mode.id as keyof typeof ICONS] ?? Paintbrush;
        return (
          <RailItem
            key={mode.id}
            label={labels[mode.id]?.label ?? mode.id}
            shortcut={mode.shortcutSlot ? `⌘${mode.shortcutSlot}` : undefined}
            active={modeActive(mode.id, mode.rootPath)}
            onSelect={() => setActiveMode(mode.id)}
          >
            <Icon className="size-4" />
          </RailItem>
        );
      })}
      <div className="mt-auto flex flex-col items-center gap-2">
        <RailMenu />
        <SidebarFooter variant="collapsed" />
      </div>
    </nav>
  );
}
