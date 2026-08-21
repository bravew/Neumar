import { useEffect, useMemo, useState } from 'react';

import { Search } from 'lucide-react';

import { RESPONSIVE_PROJECT_GRID_CLASS } from '@/components/library/responsive-project-grid';
import { Button } from '@/components/ui/button';
import { VideoFolderCard } from '@/components/video/VideoFolderCard';
import { useLanguage } from '@/shared/providers/language-provider';
import type { VideoProjectListItem } from '@/shared/types/video';

import {
  filterAndSortVideoProjects,
  parseVideoProjectSort,
  toggleProjectSelection,
  toggleVisibleProjectSelection,
  type VideoProjectSort,
} from './videoProjectLibraryUtils';

interface VideoProjectLibraryProps {
  projects: VideoProjectListItem[];
  onDelete: (projects: VideoProjectListItem[]) => void;
  onOpen: (project: VideoProjectListItem) => void;
  onOpenFolder: (project: VideoProjectListItem) => void;
  onRename: (project: VideoProjectListItem) => void;
}

export function VideoProjectsLibrary({
  projects,
  onDelete,
  onOpen,
  onOpenFolder,
  onRename,
}: VideoProjectLibraryProps) {
  const { t } = useLanguage();
  const [query, setQuery] = useState('');
  const [template, setTemplate] = useState('all');
  const [renderStatus, setRenderStatus] = useState('all');
  const [sort, setSort] = useState<VideoProjectSort>('updated-desc');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const templateOptions = useMemo(
    () => [...new Set(projects.map((project) => project.template))].sort(),
    [projects],
  );
  const renderStatusOptions = useMemo(
    () => [...new Set(projects.map((project) => project.renderStatus))].sort(),
    [projects],
  );
  const visibleProjects = useMemo(
    () =>
      filterAndSortVideoProjects(projects, {
        query,
        template,
        renderStatus,
        sort,
      }),
    [projects, query, renderStatus, sort, template],
  );
  const visibleIds = useMemo(
    () => visibleProjects.map((project) => project.id),
    [visibleProjects],
  );
  const selectedProjects = useMemo(
    () => projects.filter((project) => selectedIds.has(project.id)),
    [projects, selectedIds],
  );
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
  const renderStatusLabels: Readonly<Record<string, string>> =
    t.video.entry.renderStatuses;

  useEffect(() => {
    const projectIds = new Set(projects.map((project) => project.id));
    setSelectedIds((previous) => {
      const next = new Set([...previous].filter((id) => projectIds.has(id)));
      return next.size === previous.size ? previous : next;
    });
  }, [projects]);

  return (
    <div className="mt-6 space-y-4">
      <div className="border-border bg-card flex flex-wrap items-center gap-3 rounded-lg border p-3">
        <label className="border-input flex h-9 min-w-64 flex-1 items-center gap-2 rounded-md border px-3">
          <Search className="text-muted-foreground size-4" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t.video.entry.searchPlaceholder}
            aria-label={t.video.entry.searchPlaceholder}
            className="min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
        </label>
        <select
          value={template}
          onChange={(event) => setTemplate(event.target.value)}
          aria-label={t.video.entry.templateFilter}
          className="border-input bg-background h-9 min-w-40 rounded-md border px-3 text-sm"
        >
          <option value="all">{t.video.entry.allTemplates}</option>
          {templateOptions.map((value) => (
            <option key={value} value={value}>
              {t.video.templates[value]}
            </option>
          ))}
        </select>
        <select
          value={renderStatus}
          onChange={(event) => setRenderStatus(event.target.value)}
          aria-label={t.video.entry.statusFilter}
          className="border-input bg-background h-9 min-w-40 rounded-md border px-3 text-sm"
        >
          <option value="all">{t.video.entry.allStatuses}</option>
          {renderStatusOptions.map((value) => (
            <option key={value} value={value}>
              {renderStatusLabels[value] ?? value}
            </option>
          ))}
        </select>
        <select
          value={sort}
          onChange={(event) =>
            setSort(parseVideoProjectSort(event.target.value))
          }
          aria-label={t.video.entry.sortLabel}
          className="border-input bg-background h-9 min-w-44 rounded-md border px-3 text-sm"
        >
          <option value="updated-desc">{t.video.entry.sortNewest}</option>
          <option value="updated-asc">{t.video.entry.sortOldest}</option>
          <option value="name-asc">{t.video.entry.sortNameAsc}</option>
          <option value="name-desc">{t.video.entry.sortNameDesc}</option>
        </select>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={visibleIds.length === 0}
          onClick={() =>
            setSelectedIds((previous) =>
              toggleVisibleProjectSelection(previous, visibleIds),
            )
          }
        >
          {allVisibleSelected
            ? t.video.entry.clearVisible
            : t.video.entry.selectAllVisible}
        </Button>
      </div>

      {visibleProjects.length > 0 ? (
        <div className={RESPONSIVE_PROJECT_GRID_CLASS}>
          {visibleProjects.map((project) => (
            <VideoFolderCard
              key={project.id}
              project={project}
              selectionMode={selectedIds.size > 0}
              selected={selectedIds.has(project.id)}
              onSelectToggle={() =>
                setSelectedIds((previous) =>
                  toggleProjectSelection(previous, project.id),
                )
              }
              onOpen={() => onOpen(project)}
              onRename={() => onRename(project)}
              onDelete={() => onDelete([project])}
              onOpenFolder={() => onOpenFolder(project)}
            />
          ))}
        </div>
      ) : (
        <div className="border-border bg-muted/30 rounded-lg border border-dashed p-10 text-center">
          <p className="font-medium">{t.video.entry.noMatchesTitle}</p>
          <p className="text-muted-foreground mt-1 text-sm">
            {t.video.entry.noMatchesDescription}
          </p>
        </div>
      )}

      {selectedProjects.length > 0 ? (
        <div className="bg-background/95 sticky bottom-3 z-20 mx-auto flex w-fit items-center gap-2 rounded-full border px-3 py-2 shadow-md backdrop-blur">
          <span className="text-sm">
            {t.video.entry.selectedCount.replace(
              '{count}',
              String(selectedProjects.length),
            )}
          </span>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={() => onDelete(selectedProjects)}
          >
            {t.video.entry.deleteSelected}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setSelectedIds(new Set())}
          >
            {t.video.entry.clearSelection}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
