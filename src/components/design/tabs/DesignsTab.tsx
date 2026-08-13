import { useEffect, useMemo, useRef, useState } from 'react';

import { toast } from 'sonner';

import { GalleryFilters } from '@/components/design/GalleryFilters';
import {
  VirtualCardGrid,
  type VirtualCardGridHandle,
} from '@/components/library/VirtualCardGrid';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/shared/providers/language-provider';
import type {
  DesignProject,
  DesignSystemRecord,
} from '@/shared/types/design-mode';

import { localizedSurfaceLabel } from '../constants';
import { DesignFolderCard } from '../DesignFolderCard';
import { DesignProjectDialogs } from '../DesignProjectDialogs';

export function DesignsTab({
  projects,
  designSystems,
  onOpen,
  onRename,
  onDelete,
}: {
  projects: DesignProject[];
  designSystems: DesignSystemRecord[];
  onOpen: (project: DesignProject) => void;
  onRename: (project: DesignProject, title: string) => Promise<void> | void;
  onDelete: (projectIds: string[]) => Promise<void> | void;
}) {
  const { t } = useLanguage();
  const [query, setQuery] = useState('');
  const [surfaceFilter, setSurfaceFilter] = useState('all');
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [renameProject, setRenameProject] = useState<DesignProject | null>(
    null,
  );
  const [renameTitle, setRenameTitle] = useState('');
  const [deleteIds, setDeleteIds] = useState<string[]>([]);
  const gridApiRef = useRef<VirtualCardGridHandle | null>(null);
  const gridRootRef = useRef<HTMLDivElement | null>(null);
  const keyboardFocusRequestedRef = useRef(false);
  const surfaceOptions = useMemo(
    () =>
      [...new Set(projects.map((project) => project.surface))]
        .sort()
        .map((surface) => ({
          label: localizedSurfaceLabel(surface, t.design.surfaces),
          value: surface,
        })),
    [projects, t.design.surfaces],
  );
  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return projects.filter(
      (project) =>
        (surfaceFilter === 'all' || project.surface === surfaceFilter) &&
        (project.title.toLowerCase().includes(q) ||
          project.surface.toLowerCase().includes(q)),
    );
  }, [projects, query, surfaceFilter]);
  const designSystemsById = useMemo(
    () => new Map(designSystems.map((system) => [system.id, system])),
    [designSystems],
  );
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  useEffect(() => {
    setFocusedIndex(0);
    setSelectedIds([]);
    gridApiRef.current?.scrollToIndex(0);
  }, [query, surfaceFilter]);

  useEffect(() => {
    const existingIds = new Set(projects.map((project) => project.id));
    setSelectedIds((previous) =>
      previous.filter((projectId) => existingIds.has(projectId)),
    );
    setFocusedIndex((previous) =>
      Math.min(previous, Math.max(filtered.length - 1, 0)),
    );
  }, [filtered.length, projects]);

  useEffect(() => {
    if (!keyboardFocusRequestedRef.current) return;
    keyboardFocusRequestedRef.current = false;
    gridApiRef.current?.scrollToIndex(focusedIndex);
    let cancelled = false;
    let frame = 0;
    const focusWhenMounted = () => {
      if (cancelled) return;
      const card = gridRootRef.current?.querySelector<HTMLElement>(
        `[data-card-index="${focusedIndex}"] [data-testid="design-folder-card"]`,
      );
      if (card) {
        card.focus();
        return;
      }
      if (frame < 4) {
        frame += 1;
        requestAnimationFrame(focusWhenMounted);
      }
    };
    requestAnimationFrame(focusWhenMounted);
    return () => {
      cancelled = true;
    };
  }, [focusedIndex]);

  const navigateCards = (
    key: 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown',
  ) => {
    const columns = gridApiRef.current?.getColumnCount() ?? 1;
    const delta =
      key === 'ArrowLeft'
        ? -1
        : key === 'ArrowRight'
          ? 1
          : key === 'ArrowUp'
            ? -columns
            : columns;
    keyboardFocusRequestedRef.current = true;
    setFocusedIndex((previous) =>
      Math.min(Math.max(previous + delta, 0), filtered.length - 1),
    );
  };
  const toggleSelected = (projectId: string, range = false) => {
    setSelectedIds((prev) => {
      if (!range) {
        return prev.includes(projectId)
          ? prev.filter((id) => id !== projectId)
          : [...prev, projectId];
      }
      const currentIndex = filtered.findIndex((item) => item.id === projectId);
      const anchorIndex = filtered.findIndex((item) => item.id === prev.at(-1));
      const start = Math.min(
        anchorIndex < 0 ? currentIndex : anchorIndex,
        currentIndex,
      );
      const end = Math.max(
        anchorIndex < 0 ? currentIndex : anchorIndex,
        currentIndex,
      );
      return [
        ...new Set([
          ...prev,
          ...filtered.slice(start, end + 1).map((item) => item.id),
        ]),
      ];
    });
  };
  const selectedCount = selectedIds.length;
  const deleteSelectedProjects = async () => {
    const ids = deleteIds;
    const count = ids.length;
    try {
      await onDelete(ids);
      setSelectedIds((prev) => prev.filter((id) => !ids.includes(id)));
      setDeleteIds([]);
      toast.success(
        t.design.bulkDelete.success.replace('{count}', String(count)),
      );
    } catch (error) {
      toast.error(
        t.design.bulkDelete.error.replace(
          '{message}',
          error instanceof Error ? error.message : String(error),
        ),
      );
    }
  };

  return (
    <div ref={gridRootRef} className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          <span className="bg-primary text-primary-foreground rounded-md px-3 py-1 text-sm">
            {t.design.recent}
          </span>
          <span className="bg-muted rounded-md px-3 py-1 text-sm">
            {t.design.yourDesigns}
          </span>
        </div>
        <GalleryFilters
          query={query}
          onQueryChange={setQuery}
          queryPlaceholder={t.design.searchDesigns}
          searchTestId="designs-search"
          className="min-w-72 flex-1 justify-end"
          filters={[
            {
              label: t.design.surfaceFilter,
              value: surfaceFilter,
              onChange: setSurfaceFilter,
              allLabel: t.design.allSurfaces,
              options: surfaceOptions,
              testId: 'designs-surface-filter',
            },
          ]}
        />
        <Button
          type="button"
          variant={selectMode ? 'default' : 'ghost'}
          size="sm"
          onClick={() => {
            setSelectMode((prev) => !prev);
            setSelectedIds([]);
          }}
        >
          {t.design.selectProjects}
        </Button>
      </div>
      {filtered.length === 0 ? (
        <div className="border-border bg-muted/30 rounded-md border border-dashed p-10 text-center">
          <p className="font-medium">{t.design.noProjectsTitle}</p>
          <p className="text-muted-foreground mt-1 text-sm">
            {t.design.noProjectsBody}
          </p>
        </div>
      ) : (
        <VirtualCardGrid
          items={filtered}
          getKey={(project) => project.id}
          gridClassName="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3"
          mediumBreakpoint={768}
          largeBreakpoint={1280}
          rowEstimate={265}
          apiRef={gridApiRef}
          renderItem={(project, index) => (
            <DesignFolderCard
              project={project}
              designSystem={
                project.designSystemId
                  ? designSystemsById.get(project.designSystemId)
                  : undefined
              }
              selectable={selectMode}
              selected={selectedIdSet.has(project.id)}
              tabIndex={focusedIndex === index ? 0 : -1}
              onOpen={() => onOpen(project)}
              onSelectToggle={() => {
                setFocusedIndex(index);
                toggleSelected(project.id);
              }}
              onRangeSelect={() => toggleSelected(project.id, true)}
              onRename={() => {
                setRenameProject(project);
                setRenameTitle(project.title);
              }}
              onDelete={() => setDeleteIds([project.id])}
              onNavigate={navigateCards}
            />
          )}
        />
      )}
      {selectMode && selectedCount > 0 && (
        <div className="bg-background/95 sticky bottom-3 z-10 mx-auto flex w-fit items-center gap-2 rounded-full border px-3 py-2 shadow-md">
          <span className="text-sm">
            {t.design.selectedProjects.replace(
              '{count}',
              String(selectedCount),
            )}
          </span>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={() => setDeleteIds(selectedIds)}
          >
            {t.design.deleteProject}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setSelectedIds([])}
          >
            {t.common.cancel}
          </Button>
        </div>
      )}
      <DesignProjectDialogs
        renameProject={renameProject}
        renameTitle={renameTitle}
        deleteCount={deleteIds.length}
        onRenameTitleChange={setRenameTitle}
        onCloseRename={() => setRenameProject(null)}
        onSaveRename={async () => {
          if (renameProject && renameTitle.trim()) {
            await onRename(renameProject, renameTitle.trim());
          }
          setRenameProject(null);
        }}
        onCloseDelete={() => setDeleteIds([])}
        onConfirmDelete={() => void deleteSelectedProjects()}
      />
    </div>
  );
}
