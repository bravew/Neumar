import { useRef, useState } from 'react';

import { ArrowLeft, Pencil } from 'lucide-react';
import { toast } from 'sonner';

import { useLanguage } from '@/shared/providers/language-provider';
import type { VideoProject } from '@/shared/types/video';

import { EditorPanelToggles } from './EditorPanelToggles';

interface ProjectStepperLeadingProps {
  project: VideoProject;
  onBack?: () => void;
  onRename: (name: string) => Promise<void> | void;
}

export function ProjectStepperLeading({
  project,
  onBack,
  onRename,
}: ProjectStepperLeadingProps) {
  const { t } = useLanguage();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(project.name);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const renameLabel = t.video.entry.renameDialogTitle;

  const beginRename = () => {
    setName(project.name);
    setEditing(true);
  };
  const submitRename = async () => {
    if (savingRef.current) return;
    const next = name.trim();
    if (!next || next === project.name) {
      setEditing(false);
      return;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      await onRename(next);
      setEditing(false);
    } catch (error) {
      toast.error(
        t.video.entry.renameFailed.replace(
          '{message}',
          error instanceof Error ? error.message : String(error),
        ),
      );
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

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
        {editing ? (
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            onBlur={() => void submitRename()}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void submitRename();
              if (event.key === 'Escape') setEditing(false);
            }}
            aria-label={renameLabel}
            disabled={saving}
            autoFocus
            className="border-input bg-background h-6 min-w-32 rounded border px-1.5 text-xs font-semibold outline-none focus:ring-1"
          />
        ) : (
          <button
            type="button"
            className="group/title text-foreground flex min-w-0 items-center gap-1 text-left text-xs font-semibold"
            aria-label={renameLabel}
            onClick={beginRename}
          >
            <span className="truncate">
              {project.name ?? t.video.project.title}
            </span>
            <Pencil className="text-muted-foreground size-3 shrink-0 opacity-0 transition-opacity group-hover/title:opacity-100 group-focus-visible/title:opacity-100" />
          </button>
        )}
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
