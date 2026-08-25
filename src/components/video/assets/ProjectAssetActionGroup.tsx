import type { ReactNode } from 'react';

import {
  CloudDownload,
  FolderOpen,
  HardDriveDownload,
  Link2,
  Plus,
  Trash2,
} from 'lucide-react';

import { cn } from '@/shared/lib/utils';

interface ProjectAssetActionGroupProps {
  placeLabel: string;
  downloadLabel: string;
  deleteLabel: string;
  /** Only needed when the matching handler is supplied. */
  consolidateLabel?: string;
  relinkLabel?: string;
  revealLabel?: string;
  assetName?: string;
  canDownload: boolean;
  onPlace?: () => void;
  onDownload?: () => void;
  onDelete?: () => void;
  /** Copy an external master into the project. Absent for managed assets. */
  onConsolidate?: () => void;
  /** Point an external master at its new home. Offered when it's missing. */
  onRelink?: () => void;
  /** Open the OS file manager on the asset's own master file. */
  onReveal?: () => void;
  className?: string;
}

export function ProjectAssetActionGroup({
  placeLabel,
  downloadLabel,
  deleteLabel,
  consolidateLabel,
  relinkLabel,
  revealLabel,
  assetName,
  canDownload,
  onPlace,
  onDownload,
  onDelete,
  onConsolidate,
  onRelink,
  onReveal,
  className,
}: ProjectAssetActionGroupProps) {
  if (
    !onPlace &&
    !onDownload &&
    !onDelete &&
    !onConsolidate &&
    !onRelink &&
    !onReveal
  ) {
    return null;
  }
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
      {onReveal ? (
        <ActionButton
          label={assetActionLabel(revealLabel ?? '', assetName)}
          onClick={onReveal}
        >
          <FolderOpen className="size-3.5" aria-hidden />
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
      {onRelink ? (
        <ActionButton
          label={assetActionLabel(relinkLabel ?? '', assetName)}
          onClick={onRelink}
        >
          <Link2 className="size-3.5" aria-hidden />
        </ActionButton>
      ) : null}
      {onConsolidate ? (
        <ActionButton
          label={assetActionLabel(consolidateLabel ?? '', assetName)}
          onClick={onConsolidate}
        >
          <HardDriveDownload className="size-3.5" aria-hidden />
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
