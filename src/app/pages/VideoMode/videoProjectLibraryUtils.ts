import type { VideoProjectListItem } from '@/shared/types/video';

export type VideoProjectSort =
  | 'updated-desc'
  | 'updated-asc'
  | 'name-asc'
  | 'name-desc';

export function parseVideoProjectSort(value: string): VideoProjectSort {
  switch (value) {
    case 'updated-desc':
    case 'updated-asc':
    case 'name-asc':
    case 'name-desc':
      return value;
    default:
      return 'updated-desc';
  }
}

interface VideoProjectLibraryQuery {
  query: string;
  renderStatus: string;
  sort: VideoProjectSort;
  template: string;
}

export function filterAndSortVideoProjects(
  projects: VideoProjectListItem[],
  filters: VideoProjectLibraryQuery,
): VideoProjectListItem[] {
  const query = filters.query.trim().toLocaleLowerCase();
  const filtered = projects.filter(
    (project) =>
      (filters.template === 'all' || project.template === filters.template) &&
      (filters.renderStatus === 'all' ||
        project.renderStatus === filters.renderStatus) &&
      (!query || project.name.toLocaleLowerCase().includes(query)),
  );

  return filtered.sort((left, right) => {
    switch (filters.sort) {
      case 'updated-desc':
        return compareUpdatedAt(right, left);
      case 'updated-asc':
        return compareUpdatedAt(left, right);
      case 'name-asc':
        return left.name.localeCompare(right.name);
      case 'name-desc':
        return right.name.localeCompare(left.name);
    }
  });
}

export function toggleProjectSelection(
  selectedIds: ReadonlySet<string>,
  projectId: string,
): Set<string> {
  const next = new Set(selectedIds);
  if (next.has(projectId)) next.delete(projectId);
  else next.add(projectId);
  return next;
}

export function toggleVisibleProjectSelection(
  selectedIds: ReadonlySet<string>,
  visibleProjectIds: string[],
): Set<string> {
  const next = new Set(selectedIds);
  const allVisibleSelected = visibleProjectIds.every((id) => next.has(id));
  for (const id of visibleProjectIds) {
    if (allVisibleSelected) next.delete(id);
    else next.add(id);
  }
  return next;
}

function compareUpdatedAt(
  left: VideoProjectListItem,
  right: VideoProjectListItem,
): number {
  return Date.parse(left.updatedAt) - Date.parse(right.updatedAt);
}
