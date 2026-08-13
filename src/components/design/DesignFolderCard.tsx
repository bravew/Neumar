import { useEffect, useMemo, useState } from 'react';

import { MoreHorizontal } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { API_BASE_URL } from '@/config';
import { designBlobUrl, listDesignFiles } from '@/shared/hooks/useDesignMode';
import { useLanguage } from '@/shared/providers/language-provider';
import type {
  DesignFileEntry,
  DesignProject,
  DesignSystemRecord,
} from '@/shared/types/design-mode';

import {
  categoryChipForProject,
  relativeTime,
  surfaceLabel,
} from './constants';
import { scheduleProjectCoverDiscovery } from './project-cover-pool';

type Cover =
  | { kind: 'html'; path: string; url: string }
  | { kind: 'image'; path: string; url: string }
  | { kind: 'video'; path: string; url: string }
  | { kind: 'fallback'; initial: string; gradient: string };

const coverCache = new Map<string, { version: string; cover: Cover }>();

export function clearDesignProjectCoverCache(projectId: string): void {
  coverCache.delete(projectId);
}

function coverVersion(project: DesignProject): string {
  return [
    project.updatedAt,
    project.brief.entryFile ?? '',
    project.brief.importEntrypoint ?? '',
  ].join(':');
}

export function DesignFolderCard({
  project,
  designSystem,
  selectable,
  selected,
  tabIndex,
  onOpen,
  onRename,
  onDelete,
  onSelectToggle,
  onRangeSelect,
  onNavigate,
}: {
  project: DesignProject;
  designSystem?: DesignSystemRecord;
  selectable?: boolean;
  selected?: boolean;
  tabIndex?: number;
  onOpen: () => void;
  onRename?: () => void;
  onDelete?: () => void;
  onSelectToggle?: () => void;
  onRangeSelect?: () => void;
  onNavigate?: (
    key: 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown',
  ) => void;
}) {
  const { t } = useLanguage();
  const [cover, setCover] = useState<Cover>(() => fallbackCover(project));
  const category = categoryChipForProject(project, t.design.categoryChips);

  useEffect(() => {
    const ac = new AbortController();
    const version = coverVersion(project);
    const cached = coverCache.get(project.id);
    if (cached?.version === version) {
      setCover(cached.cover);
      return () => ac.abort();
    }
    scheduleProjectCoverDiscovery(ac.signal, () =>
      resolveCover(project, ac.signal),
    )
      .then((next) => {
        const resolved = next ?? fallbackCover(project);
        coverCache.set(project.id, { version, cover: resolved });
        if (!ac.signal.aborted) setCover(resolved);
      })
      .catch(() => {
        if (!ac.signal.aborted) setCover(fallbackCover(project));
      });
    return () => ac.abort();
  }, [project]);

  return (
    <article
      className="group border-border bg-card hover:border-primary/30 relative rounded-md border transition-all hover:shadow-xs"
      onClick={(event) => {
        if (selectable) {
          if (event.shiftKey) onRangeSelect?.();
          else onSelectToggle?.();
          return;
        }
        onOpen();
      }}
      onDoubleClick={onOpen}
      onKeyDown={(event) => {
        if (
          event.key === 'ArrowLeft' ||
          event.key === 'ArrowRight' ||
          event.key === 'ArrowUp' ||
          event.key === 'ArrowDown'
        ) {
          event.preventDefault();
          onNavigate?.(event.key);
          return;
        }
        if (event.key === ' ') {
          event.preventDefault();
          onSelectToggle?.();
        }
        if (event.key === 'Enter') onOpen();
      }}
      tabIndex={tabIndex}
      data-testid="design-folder-card"
    >
      {selectable && (
        <input
          type="checkbox"
          checked={Boolean(selected)}
          onChange={onSelectToggle}
          onClick={(event) => event.stopPropagation()}
          className="absolute top-3 left-3 z-10 size-4"
          aria-label={t.design.selectProject}
        />
      )}
      <ProjectCover cover={cover} title={project.title} />
      <div className="space-y-2 p-4">
        <div className="flex items-start justify-between gap-3">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onOpen();
            }}
            className="min-w-0 flex-1 text-left"
          >
            <span className="block truncate text-sm font-semibold">
              {project.title}
            </span>
            <span className="text-muted-foreground mt-1 block text-xs">
              {relativeTime(project.updatedAt, t.design.relativeTime)}
            </span>
          </button>
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t.design.projectCardActions}
                onClick={(event) => event.stopPropagation()}
              >
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onRename}>
                {t.design.renameProject}
              </DropdownMenuItem>
              <DropdownMenuItem className="text-destructive" onClick={onDelete}>
                {t.design.deleteProject}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="text-muted-foreground flex min-w-0 flex-wrap gap-1 text-xs">
          {category && (
            <span className="bg-muted max-w-full truncate rounded px-1.5 py-0.5">
              {category}
            </span>
          )}
          <span className="bg-muted max-w-full truncate rounded px-1.5 py-0.5">
            {surfaceLabel(project.surface)}
          </span>
          {designSystem && (
            <span className="bg-muted max-w-full truncate rounded px-1.5 py-0.5">
              {designSystem.title}
            </span>
          )}
          {project.designSystemId && !designSystem && (
            <span className="bg-destructive/10 text-destructive rounded px-1.5 py-0.5">
              {t.design.missingDesignSystem}
            </span>
          )}
        </div>
      </div>
    </article>
  );
}

function ProjectCover({ cover, title }: { cover: Cover; title: string }) {
  const content = useMemo(() => {
    if (cover.kind === 'html') {
      return (
        <iframe
          title={`${title} preview`}
          src={cover.url}
          sandbox="allow-scripts allow-downloads"
          loading="lazy"
          referrerPolicy="no-referrer"
          className="h-full w-full border-0 bg-white"
        />
      );
    }
    if (cover.kind === 'image') {
      return (
        <img
          src={cover.url}
          alt=""
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover"
        />
      );
    }
    if (cover.kind === 'video') {
      return (
        <video
          src={cover.url}
          preload="metadata"
          className="h-full w-full object-cover"
        />
      );
    }
    return (
      <div
        className="flex h-full w-full items-center justify-center text-4xl font-semibold text-white"
        style={{ background: cover.gradient }}
      >
        {cover.initial}
      </div>
    );
  }, [cover, title]);
  return (
    <div className="pointer-events-none h-36 overflow-hidden rounded-t-md border-b">
      {content}
    </div>
  );
}

async function resolveCover(project: DesignProject, signal: AbortSignal) {
  const fromBrief = project.brief.entryFile ?? project.brief.importEntrypoint;
  const direct =
    typeof fromBrief === 'string' ? coverForPath(project.id, fromBrief) : null;
  if (direct) return direct;

  const files = flattenFiles(
    (await listDesignFiles(project.id, { signal })).files,
  );
  const preferred =
    files.find((file) => /(?:^|\/)index\.html?$/i.test(file.path)) ??
    newest(files.filter((file) => /\.html?$/i.test(file.path))) ??
    newest(
      files.filter((file) => /\.(png|jpe?g|webp|gif|svg)$/i.test(file.path)),
    ) ??
    newest(files.filter((file) => /\.(mp4|webm|mov)$/i.test(file.path)));
  return preferred ? coverForPath(project.id, preferred.path) : null;
}

function coverForPath(projectId: string, filePath: string): Cover | null {
  if (/\.html?$/i.test(filePath)) {
    return {
      kind: 'html',
      path: filePath,
      url: `${API_BASE_URL}/design/projects/${encodeURIComponent(projectId)}/export/file?path=${encodeURIComponent(filePath)}&inline=1`,
    };
  }
  if (/\.(png|jpe?g|webp|gif|svg)$/i.test(filePath)) {
    return {
      kind: 'image',
      path: filePath,
      url: designBlobUrl(projectId, filePath),
    };
  }
  if (/\.(mp4|webm|mov)$/i.test(filePath)) {
    return {
      kind: 'video',
      path: filePath,
      url: designBlobUrl(projectId, filePath),
    };
  }
  return null;
}

function flattenFiles(files: DesignFileEntry[]): DesignFileEntry[] {
  return files.flatMap((file) => [
    file,
    ...(file.children ? flattenFiles(file.children) : []),
  ]);
}

function newest(files: DesignFileEntry[]) {
  return [...files].sort(
    (a, b) => Date.parse(b.updatedAt ?? '') - Date.parse(a.updatedAt ?? ''),
  )[0];
}

function fallbackCover(project: DesignProject): Cover {
  const hue = hashHue(project.id);
  return {
    kind: 'fallback',
    initial: project.title.trim().charAt(0).toUpperCase() || 'D',
    gradient: `linear-gradient(135deg, hsl(${hue} 74% 44%), hsl(${(hue + 48) % 360} 70% 52%))`,
  };
}

function hashHue(value: string) {
  let hash = 0;
  for (const char of value) hash = (hash * 31 + char.charCodeAt(0)) % 360;
  return hash;
}
