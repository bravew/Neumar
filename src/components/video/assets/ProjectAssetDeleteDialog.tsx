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
  // When set, the asset is referenced by `clipCount` timeline clips and the
  // confirm dialog is shown. Null keeps the dialog closed.
  pending: { assetName: string; clipCount: number } | null;
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
  return (
    <Dialog
      open={pending !== null}
      onOpenChange={(open) => {
        if (!open && !deleting) onCancel();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{labels.title}</DialogTitle>
          <DialogDescription>
            {labels.body
              .replace('{name}', pending?.assetName ?? '')
              .replace('{count}', String(pending?.clipCount ?? 0))}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={deleting}>
            {labels.cancel}
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={deleting}>
            {labels.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
