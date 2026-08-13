import { useNavigate } from 'react-router-dom';

import { PanelLeft } from 'lucide-react';

import { useSidebar } from '@/components/layout';
import { AvatarSvg } from '@/components/profiles/avatar-options';
import type { ProfileDisplayInfo } from '@/components/task/InitialMessageSender';
import { PulsingDot } from '@/config/animation';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

/** Max display length for task title in the header. */
const TITLE_DISPLAY_TRUNCATION = 50;

export function TaskV2Header({
  title,
  isRunning,
  isRightSidebarVisible,
  onToggleRightSidebar,
  profileInfo,
}: {
  title: string;
  isRunning: boolean;
  isRightSidebarVisible: boolean;
  onToggleRightSidebar: () => void;
  profileInfo?: ProfileDisplayInfo | null;
}) {
  const { toggleLeft } = useSidebar();
  const { t } = useLanguage();
  const navigate = useNavigate();

  return (
    <header className="border-border/30 flex shrink-0 items-center gap-2 border-b px-4 py-2.5">
      {/* Mobile: toggle left sidebar */}
      <button
        onClick={toggleLeft}
        className="text-muted-foreground hover:bg-accent hover:text-foreground flex cursor-pointer items-center justify-center rounded-lg p-2 transition-colors md:hidden"
        aria-label="Toggle sidebar"
      >
        <PanelLeft className="size-5" />
      </button>

      {/* Task title */}
      <h1 className="text-foreground min-w-0 flex-1 truncate text-sm font-normal">
        {title.slice(0, TITLE_DISPLAY_TRUNCATION)}
        {title.length > TITLE_DISPLAY_TRUNCATION && '...'}
      </h1>

      {/* Running indicator */}
      {isRunning && <PulsingDot color="bg-primary" size="size-2" />}

      {/* Agent profile badge — click navigates to profile detail */}
      {profileInfo && (
        <button
          onClick={() => navigate(`/org/${profileInfo.id}`)}
          className="border-border bg-muted/50 hover:bg-muted flex cursor-pointer items-center gap-1.5 rounded-full border py-0.5 pr-2.5 pl-0.5 transition-colors"
          title={
            profileInfo.role
              ? `${profileInfo.name} — ${profileInfo.role}`
              : profileInfo.name
          }
          aria-label={
            profileInfo.role
              ? `${profileInfo.name} — ${profileInfo.role}`
              : profileInfo.name
          }
        >
          <AvatarSvg
            avatarId={profileInfo.avatarIcon ?? null}
            color={profileInfo.avatarColor ?? '#6366f1'}
            className="size-5 shrink-0 overflow-hidden rounded-full"
          />
          <span className="text-foreground max-w-24 truncate text-xs font-medium">
            {profileInfo.name}
          </span>
        </button>
      )}

      {/* Toggle right sidebar */}
      <button
        onClick={onToggleRightSidebar}
        className={cn(
          'text-muted-foreground hover:bg-accent hover:text-foreground flex cursor-pointer items-center justify-center rounded-lg p-2 transition-colors',
          isRightSidebarVisible && 'bg-accent/50',
        )}
        title={isRightSidebarVisible ? t.task.hideSidebar : t.task.showSidebar}
        aria-label={
          isRightSidebarVisible ? 'Hide right sidebar' : 'Show right sidebar'
        }
      >
        <PanelLeft className="size-4 rotate-180" />
      </button>
    </header>
  );
}
