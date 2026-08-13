import { useCallback, useEffect, useRef, useState } from 'react';

import { FileVideo, Folder } from 'lucide-react';
import { toast } from 'sonner';

import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@/components/ui/hover-card';
import { API_BASE_URL } from '@/config';
import { useLanguage } from '@/shared/providers/language-provider';
import type { VideoProject, VideoRenderOutput } from '@/shared/types/video';

import { openRenderedOutput } from '../preview/previewOutputActions';
import { filenameFromPath } from './ProjectAssetTile';

interface ProjectOutputsSectionProps {
  project: VideoProject;
}

export function ProjectOutputsSection({ project }: ProjectOutputsSectionProps) {
  const { t } = useLanguage();
  const outputs = project.outputs ?? [];
  if (outputs.length === 0) return null;

  return (
    <section className="space-y-2">
      <header className="flex items-center justify-between">
        <h3 className="text-foreground text-xs font-semibold">
          {t.video.editor.assetsRail.outputs}
        </h3>
        <span className="text-muted-foreground text-[10px]">
          {outputs.length}
        </span>
      </header>
      <div className="space-y-1.5">
        {outputs.map((output) => (
          <OutputTile
            key={output.aspectRatio}
            project={project}
            output={output}
          />
        ))}
      </div>
    </section>
  );
}

function OutputTile({
  project,
  output,
}: {
  project: VideoProject;
  output: VideoRenderOutput;
}) {
  const { t } = useLanguage();
  const filename = filenameFromPath(output.path);
  const posterUrl = output.posterPath
    ? `${API_BASE_URL}/video/projects/${encodeURIComponent(project.id)}/poster?aspectRatio=${encodeURIComponent(output.aspectRatio)}&v=${project.render?.updatedAt ?? ''}`
    : undefined;
  const videoUrl = `${API_BASE_URL}/video/projects/${encodeURIComponent(project.id)}/output?aspectRatio=${encodeURIComponent(output.aspectRatio)}&v=${project.render?.updatedAt ?? ''}`;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  // Radix fires onOpenChange synchronously before HoverCardContent (and the
  // <video> inside it) is committed to the DOM, so videoRef.current is null
  // on the first open. Drive playback from an effect that runs after commit.
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (previewOpen) {
      el.currentTime = 0;
      void el.play().catch(() => {});
    } else {
      el.pause();
    }
  }, [previewOpen]);

  const handleReveal = useCallback(async () => {
    try {
      await openRenderedOutput(project, output);
    } catch (err) {
      toast.error(
        `${t.video.editor.preview.openOutput}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }, [output, project, t.video.editor.preview.openOutput]);

  return (
    <HoverCard
      openDelay={150}
      closeDelay={80}
      open={previewOpen}
      onOpenChange={setPreviewOpen}
    >
      <HoverCardTrigger asChild>
        <div
          className="border-border bg-background hover:border-primary/50 group flex items-center gap-2 rounded-md border p-1.5"
          title={output.path}
        >
          <Thumbnail posterUrl={posterUrl} />
          <div className="min-w-0 flex-1">
            <div className="text-foreground truncate text-[11px] font-medium">
              {filename}
            </div>
            <div className="text-muted-foreground flex items-center gap-1.5 text-[10px] uppercase">
              <span>{output.aspectRatio}</span>
              {output.durationSec ? (
                <span>· {output.durationSec.toFixed(1)}s</span>
              ) : null}
              {output.fileSize ? (
                <span>· {formatBytes(output.fileSize)}</span>
              ) : null}
            </div>
          </div>
          <button
            type="button"
            aria-label={t.video.editor.preview.openOutput}
            onClick={(event) => {
              event.stopPropagation();
              void handleReveal();
            }}
            className="text-muted-foreground hover:text-foreground opacity-0 transition-opacity group-hover:opacity-100"
          >
            <Folder className="size-3.5" />
          </button>
        </div>
      </HoverCardTrigger>
      {posterUrl ? (
        <HoverCardContent side="right" align="start" className="w-72 p-2">
          <video
            ref={videoRef}
            src={videoUrl}
            poster={posterUrl}
            muted
            loop
            playsInline
            preload="metadata"
            className="w-full rounded-md bg-black"
          />
          <div className="text-muted-foreground mt-2 truncate text-[11px]">
            {filename}
          </div>
          <div className="text-muted-foreground mt-0.5 flex items-center gap-1.5 text-[10px] uppercase">
            <span>{output.aspectRatio}</span>
            {output.durationSec ? (
              <span>· {output.durationSec.toFixed(1)}s</span>
            ) : null}
            {output.fileSize ? (
              <span>· {formatBytes(output.fileSize)}</span>
            ) : null}
          </div>
        </HoverCardContent>
      ) : null}
    </HoverCard>
  );
}

function Thumbnail({ posterUrl }: { posterUrl?: string }) {
  if (posterUrl) {
    return (
      <div className="bg-muted size-10 shrink-0 overflow-hidden rounded">
        <img
          src={posterUrl}
          alt=""
          className="size-full object-cover"
          loading="lazy"
          onError={(event) => {
            event.currentTarget.style.display = 'none';
          }}
        />
      </div>
    );
  }
  return (
    <div className="bg-muted text-muted-foreground flex size-10 shrink-0 items-center justify-center rounded">
      <FileVideo className="size-4" />
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}
