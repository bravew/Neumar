import { X } from 'lucide-react';

interface ProjectAssetBulkActionsBarLabels {
  selectedCount: string;
  placeSelected: string;
  deleteSelected: string;
  clearSelection: string;
}

interface ProjectAssetBulkActionsBarProps {
  selectedCount: number;
  labels: ProjectAssetBulkActionsBarLabels;
  onPlace?: () => void;
  onDelete: () => void;
  onClear: () => void;
}

// Reuses the existing "select for context" checkboxes on each tile as the
// multi-select mechanism, rather than introducing a second selection concept
// — checking a tile already means "this is one I've picked."
export function ProjectAssetBulkActionsBar({
  selectedCount,
  labels,
  onPlace,
  onDelete,
  onClear,
}: ProjectAssetBulkActionsBarProps) {
  if (selectedCount === 0) return null;
  return (
    <div className="border-primary/30 bg-primary/5 flex items-center justify-between gap-2 rounded-md border px-2 py-1">
      <span className="text-foreground text-[11px] font-medium">
        {labels.selectedCount.replace('{count}', String(selectedCount))}
      </span>
      <div className="flex items-center gap-2">
        {onPlace ? (
          <button
            type="button"
            onClick={onPlace}
            className="text-primary hover:text-primary/80 text-[11px] font-medium"
          >
            {labels.placeSelected}
          </button>
        ) : null}
        <button
          type="button"
          onClick={onDelete}
          className="text-destructive hover:text-destructive/80 text-[11px] font-medium"
        >
          {labels.deleteSelected}
        </button>
        <button
          type="button"
          onClick={onClear}
          aria-label={labels.clearSelection}
          title={labels.clearSelection}
          className="text-muted-foreground hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
