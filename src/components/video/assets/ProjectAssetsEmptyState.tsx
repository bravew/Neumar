import {
  CloudUpload,
  FilePlus,
  FolderPlus,
  Library,
  Upload,
} from 'lucide-react';

import { useLanguage } from '@/shared/providers/language-provider';

interface ProjectAssetsEmptyStateProps {
  onAddLocalFiles: () => void;
  onAddLocalFolder: () => void;
  onConnectCloud: () => void;
  onOpenCatalog: () => void;
  addingFolder: boolean;
  addingFiles: boolean;
}

// Replaces the bare "No project assets yet." line with a drag-and-drop target
// that doubles as the primary onboarding CTA — the pattern every sample editor
// uses to make "how do I get media in here?" obvious.
export function ProjectAssetsEmptyState({
  onAddLocalFiles,
  onAddLocalFolder,
  onConnectCloud,
  onOpenCatalog,
  addingFolder,
  addingFiles,
}: ProjectAssetsEmptyStateProps) {
  const { t } = useLanguage();
  const labels = t.video.editor.assetsRail;
  const assetLabels = t.assets;

  return (
    <div className="border-border/70 text-muted-foreground flex flex-col items-center gap-3 rounded-lg border border-dashed px-4 py-6 text-center">
      <Upload className="size-5 opacity-70" aria-hidden />
      <div className="space-y-1">
        <p className="text-foreground text-xs font-medium">
          {labels.emptyProjectAssets}
        </p>
        <p className="text-[11px]">{labels.emptyProjectAssetsCta}</p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-1.5">
        <EmptyStateAction
          label={labels.addFiles}
          onClick={onAddLocalFiles}
          disabled={addingFiles}
        >
          <FilePlus className="size-3.5" aria-hidden />
        </EmptyStateAction>
        <EmptyStateAction
          label={labels.addFolder}
          onClick={onAddLocalFolder}
          disabled={addingFolder}
        >
          <FolderPlus className="size-3.5" aria-hidden />
        </EmptyStateAction>
        <EmptyStateAction label={labels.connectCloud} onClick={onConnectCloud}>
          <CloudUpload className="size-3.5" aria-hidden />
        </EmptyStateAction>
        <EmptyStateAction
          label={assetLabels.browseCatalog}
          onClick={onOpenCatalog}
        >
          <Library className="size-3.5" aria-hidden />
        </EmptyStateAction>
      </div>
    </div>
  );
}

function EmptyStateAction({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="border-border bg-background text-foreground hover:border-primary/40 hover:bg-muted focus-visible:ring-primary/40 inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors outline-none focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50"
    >
      {children}
      {label}
    </button>
  );
}
