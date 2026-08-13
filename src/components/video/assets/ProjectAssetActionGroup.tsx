import type { ReactNode } from 'react';

import { CloudDownload, Plus, Trash2 } from 'lucide-react';

import { cn } from '@/shared/lib/utils';

interface ProjectAssetActionGroupProps {
  placeLabel: string;
  downloadLabel: string;
  deleteLabel: string;
  assetName?: string;
  canDownload: boolean;
  onPlace?: () => void;
  onDownload?: () => void;
  onDelete?: () => void;
  className?: string;
}

export function ProjectAssetActionGroup({
  placeLabel,
  downloadLabel,
  deleteLabel,
  assetName,
  canDownload,
  onPlace,
  onDownload,
  onDelete,
  className,
}: ProjectAssetActionGroupProps) {
  if (!onPlace && !onDownload && !onDelete) return null;
  return (
    <div
      className={cn(
        'bg-background/95 border-border absolute top-1 right-1 z-20 inline-flex overflow-hidden rounded-md border opacity-0 shadow-sm transition-opacity group-focus-within:opacity-100 group-hover:opacity-100',
        className,
      )}
    >
      {onPlace ? (
        <ActionButton
          label={assetActionLabel(placeLabel, assetName)}
          onClick={onPlace}
        >
          <Plus className="size-3.5" aria-hidden />
        </ActionButton>
      ) : null}
      {onDownload && canDownload ? (
        <ActionButton
          label={assetActionLabel(downloadLabel, assetName)}
          onClick={onDownload}
        >
          <CloudDownload className="size-3.5" aria-hidden />
        </ActionButton>
      ) : null}
      {onDelete ? (
        <ActionButton
          label={assetActionLabel(deleteLabel, assetName)}
          onClick={onDelete}
          className="hover:text-destructive"
        >
          <Trash2 className="size-3.5" aria-hidden />
        </ActionButton>
      ) : null}
    </div>
  );
}

function assetActionLabel(
  label: string,
  assetName: string | undefined,
): string {
  return assetName ? `${label}: ${assetName}` : label;
}

function ActionButton({
  label,
  onClick,
  className,
  children,
}: {
  label: string;
  onClick: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        'text-muted-foreground hover:text-foreground flex size-7 items-center justify-center',
        className,
      )}
      onClick={(event) => {
        event.stopPropagation();
        event.preventDefault();
        onClick();
      }}
    >
      {children}
    </button>
  );
}
