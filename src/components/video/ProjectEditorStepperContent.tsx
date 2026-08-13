import { ArrowLeft } from 'lucide-react';

import { useLanguage } from '@/shared/providers/language-provider';
import type { VideoProject } from '@/shared/types/video';

import { EditorPanelToggles } from './EditorPanelToggles';

interface ProjectStepperLeadingProps {
  project: VideoProject;
  onBack?: () => void;
}

export function ProjectStepperLeading({
  project,
  onBack,
}: ProjectStepperLeadingProps) {
  const { t } = useLanguage();

  return (
    <>
      {onBack ? (
        <button
          type="button"
          className="text-muted-foreground hover:bg-accent hover:text-foreground flex size-7 shrink-0 items-center justify-center rounded-md"
          aria-label={t.video.project.back}
          onClick={onBack}
        >
          <ArrowLeft className="size-4" />
        </button>
      ) : null}
      <div className="hidden min-w-0 flex-col leading-tight md:flex">
        <h1 className="text-foreground truncate text-xs font-semibold">
          {project.name ?? t.video.project.title}
        </h1>
        <p className="text-muted-foreground truncate text-[10px]">
          {t.video.project.updatedAt.replace(
            '{date}',
            new Date(project.updatedAt).toLocaleString(),
          )}
        </p>
      </div>
      <span
        aria-hidden="true"
        className="bg-border mx-1 hidden h-5 w-px shrink-0 md:block"
      />
    </>
  );
}

interface ProjectStepperTrailingProps {
  timelineRoute: boolean;
  sideRailOpen: boolean;
  agentDockOpen: boolean;
  onToggleTimelineRoute: () => void;
  onToggleSideRail: () => void;
  onToggleAgentDock: () => void;
}

export function ProjectStepperTrailing({
  timelineRoute,
  sideRailOpen,
  agentDockOpen,
  onToggleTimelineRoute,
  onToggleSideRail,
  onToggleAgentDock,
}: ProjectStepperTrailingProps) {
  const { t } = useLanguage();

  return (
    <>
      <button
        type="button"
        className="text-muted-foreground hover:bg-background hover:text-foreground rounded-md px-2.5 py-1.5 text-xs"
        onClick={onToggleTimelineRoute}
      >
        {timelineRoute
          ? t.video.project.backToChat
          : t.video.project.openTimeline}
      </button>
      <EditorPanelToggles
        sideRailOpen={sideRailOpen}
        agentDockOpen={agentDockOpen}
        onToggleSideRail={onToggleSideRail}
        onToggleAgentDock={onToggleAgentDock}
      />
    </>
  );
}
