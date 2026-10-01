import { useCallback, useEffect, useRef, useState } from 'react';

import { useNavigate } from 'react-router-dom';

import { PanelLeft, PanelLeftOpen } from 'lucide-react';

import ImageLogo from '@/assets/logo.png';
import { useSidebar } from '@/components/layout/sidebar-context';
import { APP_NAME } from '@/config';
import { useSettingsValue } from '@/shared/db/settings';
import { cn } from '@/shared/lib/utils';
import { useMode } from '@/shared/modes/useMode';
import { useLanguage } from '@/shared/providers/language-provider';

import { ContextPanel } from './ContextPanel';
import { ModeSwitcher } from './ModeSwitcher';
import { SidebarFooter } from './SidebarFooter';
import { SidebarHoverHotzone } from './SidebarHoverHotzone';
import { SidebarPrimaryAction } from './SidebarPrimaryAction';
import { SidebarRecents } from './SidebarRecents';
import { SidebarSections } from './SidebarSections';

interface SidebarShellProps {
  currentTaskId?: string;
  onDeleteTask?: (taskId: string, deleteFolder?: boolean) => void;
  onToggleFavorite?: (taskId: string, favorite: boolean) => void;
  runningTaskIds?: string[];
}

export function SidebarShell(props: SidebarShellProps) {
  const simpleShell = useSettingsValue().ui.simpleShell;
  return simpleShell ? (
    <ContextPanel {...props} />
  ) : (
    <LegacySidebar {...props} />
  );
}

function LegacySidebar({
  currentTaskId,
  onDeleteTask,
  onToggleFavorite,
  runningTaskIds = [],
}: SidebarShellProps) {
  const navigate = useNavigate();
  const { activeMode } = useMode();
  const { leftOpen, toggleLeft } = useSidebar();
  const { t } = useLanguage();
  const [previewOpen, setPreviewOpen] = useState(false);
  const previewTimerRef = useRef<number | null>(null);

  const clearPreviewTimer = useCallback(() => {
    if (previewTimerRef.current === null) return;
    window.clearTimeout(previewTimerRef.current);
    previewTimerRef.current = null;
  }, []);

  const closePreview = useCallback(() => {
    clearPreviewTimer();
    previewTimerRef.current = window.setTimeout(() => {
      previewTimerRef.current = null;
      setPreviewOpen(false);
    }, 200);
  }, [clearPreviewTimer]);

  useEffect(() => {
    if (leftOpen) setPreviewOpen(false);
  }, [leftOpen]);

  useEffect(() => clearPreviewTimer, [clearPreviewTimer]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPreviewOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const visible = leftOpen || previewOpen;

  return (
    <>
      {!leftOpen && (
        <SidebarHoverHotzone onPreview={() => setPreviewOpen(true)} />
      )}
      {/* Persistent expand affordance while the sidebar is auto-hidden
          (like Claude desktop): hovering shows the sidebar as a quick flyout,
          clicking pins it open. Sits BELOW the sidebar (z-20 < aside z-30) so
          the flyout cleanly covers it once it slides in — no overlap. */}
      {!leftOpen && (
        <button
          type="button"
          onClick={toggleLeft}
          onMouseEnter={() => {
            clearPreviewTimer();
            setPreviewOpen(true);
          }}
          onMouseLeave={closePreview}
          aria-label={t.nav.expandSidebar}
          title={t.nav.expandSidebar}
          className={cn(
            'fixed top-2.5 left-2.5 z-20 flex size-8 items-center justify-center rounded-lg',
            'bg-sidebar/80 text-sidebar-foreground/70 shadow-sm backdrop-blur',
            'hover:bg-sidebar hover:text-sidebar-foreground cursor-pointer transition-colors',
          )}
        >
          <PanelLeftOpen className="size-4" />
        </button>
      )}
      <aside
        data-preview={previewOpen ? 'true' : undefined}
        onMouseEnter={() => {
          clearPreviewTimer();
        }}
        onMouseLeave={() => {
          if (!leftOpen) closePreview();
        }}
        className={cn(
          'left-sidebar border-sidebar-border bg-sidebar z-30 flex h-full w-72 shrink-0 flex-col border-none transition-all duration-300',
          leftOpen ? 'relative' : 'absolute top-0 left-0 shadow-2xl',
          visible ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 px-4 pt-4 pb-2">
          <button
            type="button"
            onClick={() => navigate('/')}
            aria-label={t.nav.home}
            title={t.nav.home}
            className="-ml-1 flex min-w-0 cursor-pointer items-center gap-2.5 rounded-lg px-1 py-0.5 transition-opacity hover:opacity-80"
          >
            <img
              src={ImageLogo}
              alt={APP_NAME}
              className="text-primary size-9 shrink-0 object-contain"
            />
            <span className="text-sidebar-foreground truncate font-mono text-lg font-medium tracking-wide">
              {APP_NAME}
            </span>
          </button>
          <button
            type="button"
            onClick={toggleLeft}
            aria-label={leftOpen ? t.nav.collapseSidebar : t.nav.expandSidebar}
            className="text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg transition-colors"
          >
            <PanelLeft className="size-4" />
          </button>
        </div>

        <div className="px-4 pb-2">
          <ModeSwitcher />
        </div>

        <div className="px-3 pb-2">
          <SidebarPrimaryAction />
        </div>

        <SidebarSections sections={activeMode.sidebar.sections} />
        <div className="bg-sidebar-border/60 my-3 h-px shrink-0" />
        <SidebarRecents
          currentTaskId={currentTaskId}
          runningTaskIds={runningTaskIds}
          onDeleteTask={onDeleteTask}
          onToggleFavorite={onToggleFavorite}
        />
        <SidebarFooter />
      </aside>
    </>
  );
}
