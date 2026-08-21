import { type SyntheticEvent, useState } from 'react';

import {
  AlertTriangle,
  Clapperboard,
  FolderOpen,
  MoreHorizontal,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { API_BASE_URL } from '@/config';
import { useLanguage } from '@/shared/providers/language-provider';
import type { VideoProjectListItem } from '@/shared/types/video';

export function VideoFolderCard({
  project,
  selectionMode,
  selected,
  onSelectToggle,
  onOpen,
  onRename,
  onDelete,
  onOpenFolder,
}: {
  project: VideoProjectListItem;
  selectionMode: boolean;
  selected: boolean;
  onSelectToggle: () => void;
  onOpen: () => void;
  onRename: () => void;
  onDelete: () => void;
  onOpenFolder: () => void;
}) {
  const { t } = useLanguage();
  const posterSrc = project.posterPath
    ? `${API_BASE_URL}/video/projects/${encodeURIComponent(
        project.id,
      )}/poster?v=${encodeURIComponent(project.updatedAt)}`
    : undefined;
  const videoSrc =
    project.posterPath || project.hasOutput
      ? `${API_BASE_URL}/video/projects/${encodeURIComponent(
          project.id,
        )}/output?v=${encodeURIComponent(project.updatedAt)}`
      : undefined;
  const [hoverPlaying, setHoverPlaying] = useState(false);
  const handleHoverStart = () => {
    if (!videoSrc) return;
    setHoverPlaying(true);
  };
  const handleHoverEnd = () => {
    setHoverPlaying(false);
  };
  const qaWarningCount = project.qaWarningCount ?? 0;
  const qaLabel = t.video.editor.qa.projectBadge.replace(
    '{count}',
    String(qaWarningCount),
  );
  const renderStatusLabels: Readonly<Record<string, string>> =
    t.video.entry.renderStatuses;

  return (
    <article
      className={`group bg-card relative cursor-pointer overflow-hidden rounded-lg border transition-all hover:shadow-xs ${
        selected
          ? 'border-primary ring-primary/20 ring-2'
          : 'border-border hover:border-primary/30'
      }`}
      onClick={selectionMode ? onSelectToggle : onOpen}
      onDoubleClick={selectionMode ? undefined : onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          if (selectionMode) onSelectToggle();
          else onOpen();
        }
      }}
      onMouseEnter={handleHoverStart}
      onMouseLeave={handleHoverEnd}
      tabIndex={0}
      role="button"
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={onSelectToggle}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
        className="accent-primary absolute top-2 left-2 z-20 size-4"
        aria-label={t.video.entry.selectProject.replace('{name}', project.name)}
      />
      {qaWarningCount > 0 ? (
        <span
          className="bg-destructive text-destructive-foreground absolute top-2 left-9 z-10 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium"
          title={qaLabel}
          aria-label={qaLabel}
        >
          <AlertTriangle className="size-3" />
          {qaWarningCount}
        </span>
      ) : null}
      <div className="absolute top-2 right-2 z-10 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="secondary"
              size="icon-sm"
              className="bg-background/85 backdrop-blur"
              aria-label={t.video.entry.cardActions}
              onClick={(event) => event.stopPropagation()}
            >
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            onClick={(event) => event.stopPropagation()}
          >
            <DropdownMenuItem onClick={onRename}>
              {t.video.entry.rename}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onOpenFolder}>
              <FolderOpen className="size-4" />
              {t.video.entry.openFolder}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={onDelete}
            >
              {t.video.entry.delete}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {posterSrc ? (
        <div className="bg-muted relative aspect-video w-full">
          <img
            src={posterSrc}
            alt=""
            className="absolute inset-0 size-full object-cover"
          />
          {videoSrc && hoverPlaying ? (
            <video
              src={videoSrc}
              autoPlay
              muted
              loop
              playsInline
              preload="none"
              className="absolute inset-0 size-full object-cover"
            />
          ) : null}
        </div>
      ) : videoSrc ? (
        <div className="bg-muted relative aspect-video w-full">
          <video
            src={videoSrc}
            muted
            playsInline
            preload="metadata"
            aria-hidden="true"
            onLoadedMetadata={seekVideoPreviewFrame}
            className="absolute inset-0 size-full object-cover"
          />
        </div>
      ) : (
        <div className="bg-muted text-muted-foreground flex aspect-video w-full items-center justify-center">
          <Clapperboard className="size-7" />
        </div>
      )}
      <div className="p-4">
        <div className="text-foreground truncate text-sm font-medium">
          {project.name}
        </div>
        <div className="text-muted-foreground mt-2 flex items-center justify-between gap-3 text-xs">
          <span className="truncate">
            {t.video.templates[project.template]}
          </span>
          <span className="shrink-0">
            {renderStatusLabels[project.renderStatus] ?? project.renderStatus}
          </span>
        </div>
      </div>
    </article>
  );
}

function seekVideoPreviewFrame(event: SyntheticEvent<HTMLVideoElement>) {
  const video = event.currentTarget;
  if (Number.isFinite(video.duration) && video.duration > 0) {
    video.currentTime = Math.min(0.1, video.duration / 10);
  }
}
