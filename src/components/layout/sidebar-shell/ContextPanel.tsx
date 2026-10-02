import { PanelLeft } from 'lucide-react';

import { useMode } from '@/shared/modes/useMode';
import { useLanguage } from '@/shared/providers/language-provider';

import { SidebarPrimaryAction } from './SidebarPrimaryAction';
import { SidebarRecents } from './SidebarRecents';

interface ContextPanelProps {
  currentTaskId?: string;
  onDeleteTask?: (taskId: string, deleteFolder?: boolean) => void;
  onToggleFavorite?: (taskId: string, favorite: boolean) => void;
  runningTaskIds?: string[];
}

/**
 * The simple shell's panel beside the rail. The rail already carries the
 * logo, mode switching, the menu, and the account, and the mode sections
 * either repeat rail destinations or the page's own tabs, so the panel holds
 * only the mode's primary action and its recents.
 */
export function ContextPanel({
  currentTaskId,
  onDeleteTask,
  onToggleFavorite,
  runningTaskIds = [],
}: ContextPanelProps) {
  const { activeMode } = useMode();
  const { tt, t } = useLanguage();

  return (
    <aside
      data-testid="context-panel"
      className="left-sidebar bg-sidebar border-border relative z-30 flex h-full w-66 shrink-0 flex-col border-r"
    >
      <div className="flex shrink-0 items-center justify-between gap-2 py-3 pr-2 pl-5">
        <h2 className="text-sidebar-foreground truncate text-sm font-semibold">
          {tt(activeMode.labelKey)}
        </h2>
        <button
          type="button"
          onClick={() =>
            window.dispatchEvent(new CustomEvent('shell:cycle-panel'))
          }
          aria-label={t.nav.collapseSidebar}
          title={`${t.nav.collapseSidebar} (⌘B)`}
          className="text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg transition-colors"
        >
          <PanelLeft className="size-4" />
        </button>
      </div>
      <div className="px-3 pb-3">
        <SidebarPrimaryAction />
      </div>
      <SidebarRecents
        currentTaskId={currentTaskId}
        runningTaskIds={runningTaskIds}
        onDeleteTask={onDeleteTask}
        onToggleFavorite={onToggleFavorite}
      />
    </aside>
  );
}
