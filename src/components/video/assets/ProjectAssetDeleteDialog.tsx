import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useLanguage } from '@/shared/providers/language-provider';

interface ProjectAssetDeleteDialogProps {
  // When set, these assets are pending deletion — a single-entry list for
  // the per-tile delete action, multiple for a bulk selection delete. Null
  // keeps the dialog closed.
  pending: { assetNames: string[]; clipCount: number } | null;
  deleting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ProjectAssetDeleteDialog({
  pending,
  deleting,
  onConfirm,
  onCancel,
}: ProjectAssetDeleteDialogProps) {
  const { t } = useLanguage();
  const labels = t.video.editor.assetsRail.deleteConfirm;
  const count = pending?.assetNames.length ?? 0;
  const isMany = count > 1;
  const title = isMany
    ? labels.titleMany.replace('{count}', String(count))
    : labels.title;
  const body = isMany
    ? labels.bodyMany
        .replace('{count}', String(count))
        .replace('{clipCount}', String(pending?.clipCount ?? 0))
    : labels.body
        .replace('{name}', pending?.assetNames[0] ?? '')
        .replace('{count}', String(pending?.clipCount ?? 0));
  const confirm = isMany
    ? labels.confirmMany.replace('{count}', String(count))
    : labels.confirm;
  return (
    <Dialog
      open={pending !== null}
      onOpenChange={(open) => {
        if (!open && !deleting) onCancel();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{body}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={deleting}>
            {labels.cancel}
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={deleting}>
            {confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
