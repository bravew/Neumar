import { ArrowDownAZ, ArrowUpAZ, Layers3, ListFilter } from 'lucide-react';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import type {
  FileWorkspaceGroupKey,
  FileWorkspaceKindFilter,
  FileWorkspaceSortDirection,
  FileWorkspaceSortKey,
} from './file-workspace-utils';

export function FileWorkspaceControls({
  sortBy,
  sortDirection,
  groupBy,
  kindFilter,
  labels,
  onSortByChange,
  onSortDirectionChange,
  onGroupByChange,
  onKindFilterChange,
}: {
  sortBy: FileWorkspaceSortKey;
  sortDirection: FileWorkspaceSortDirection;
  groupBy: FileWorkspaceGroupKey;
  kindFilter: FileWorkspaceKindFilter;
  labels: {
    filterByKind: string;
    filterAll: string;
    filterHtml: string;
    filterImage: string;
    filterSvg: string;
    filterPdf: string;
    filterAudio: string;
    filterVideo: string;
    sortBy: string;
    sortName: string;
    sortKind: string;
    sortModified: string;
    groupBy: string;
    groupNone: string;
    groupKind: string;
    groupModified: string;
    ascending: string;
    descending: string;
  };
  onSortByChange: (value: FileWorkspaceSortKey) => void;
  onSortDirectionChange: (value: FileWorkspaceSortDirection) => void;
  onGroupByChange: (value: FileWorkspaceGroupKey) => void;
  onKindFilterChange: (value: FileWorkspaceKindFilter) => void;
}) {
  return (
    <div className="border-border mb-3 space-y-2 border-b pb-3">
      <label className="text-muted-foreground flex items-center gap-2 text-xs">
        <ArrowDownAZ className="size-3" />
        <span className="sr-only">{labels.sortBy}</span>
        <Select
          value={sortBy}
          onValueChange={(value) =>
            onSortByChange(value as FileWorkspaceSortKey)
          }
        >
          <SelectTrigger
            aria-label={labels.sortBy}
            className="h-7 min-w-0 flex-1 px-2 py-1 text-xs"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="name">{labels.sortName}</SelectItem>
            <SelectItem value="kind">{labels.sortKind}</SelectItem>
            <SelectItem value="updatedAt">{labels.sortModified}</SelectItem>
          </SelectContent>
        </Select>
        <button
          type="button"
          aria-label={
            sortDirection === 'asc' ? labels.ascending : labels.descending
          }
          className="hover:bg-accent rounded p-1"
          onClick={() =>
            onSortDirectionChange(sortDirection === 'asc' ? 'desc' : 'asc')
          }
        >
          {sortDirection === 'asc' ? (
            <ArrowDownAZ className="size-4" />
          ) : (
            <ArrowUpAZ className="size-4" />
          )}
        </button>
      </label>
      <label className="text-muted-foreground flex items-center gap-2 text-xs">
        <ListFilter className="size-3" />
        <span className="sr-only">{labels.filterByKind}</span>
        <Select
          value={kindFilter}
          onValueChange={(value) =>
            onKindFilterChange(value as FileWorkspaceKindFilter)
          }
        >
          <SelectTrigger
            aria-label={labels.filterByKind}
            className="h-7 min-w-0 flex-1 px-2 py-1 text-xs"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{labels.filterAll}</SelectItem>
            <SelectItem value="html">{labels.filterHtml}</SelectItem>
            <SelectItem value="image">{labels.filterImage}</SelectItem>
            <SelectItem value="svg">{labels.filterSvg}</SelectItem>
            <SelectItem value="pdf">{labels.filterPdf}</SelectItem>
            <SelectItem value="audio">{labels.filterAudio}</SelectItem>
            <SelectItem value="video">{labels.filterVideo}</SelectItem>
          </SelectContent>
        </Select>
      </label>
      <label className="text-muted-foreground flex items-center gap-2 text-xs">
        <Layers3 className="size-3" />
        <span className="sr-only">{labels.groupBy}</span>
        <Select
          value={groupBy}
          onValueChange={(value) =>
            onGroupByChange(value as FileWorkspaceGroupKey)
          }
        >
          <SelectTrigger
            aria-label={labels.groupBy}
            className="h-7 min-w-0 flex-1 px-2 py-1 text-xs"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">{labels.groupNone}</SelectItem>
            <SelectItem value="kind">{labels.groupKind}</SelectItem>
            <SelectItem value="updatedAt">{labels.groupModified}</SelectItem>
          </SelectContent>
        </Select>
      </label>
    </div>
  );
}
