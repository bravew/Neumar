import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface CommonDialogLabels {
  cancel: string;
  save: string;
}

interface RenameDialogLabels {
  renameDialogTitle: string;
}

interface DeleteDialogLabels {
  bulkDeleteDialogBody: string;
  bulkDeleteDialogTitle: string;
  delete: string;
  deleteDialogBody: string;
  deleteDialogTitle: string;
}

interface RenameProjectDialogProps {
  busy: boolean;
  commonLabels: CommonDialogLabels;
  labels: RenameDialogLabels;
  open: boolean;
  value: string;
  onOpenChange: (open: boolean) => void;
  onSubmit: () => void;
  onValueChange: (value: string) => void;
}

interface DeleteProjectDialogProps {
  busy: boolean;
  commonLabels: Pick<CommonDialogLabels, 'cancel'>;
  labels: DeleteDialogLabels;
  open: boolean;
  projectCount: number;
  projectName: string;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
}

export function RenameProjectDialog({
  busy,
  commonLabels,
  labels,
  open,
  value,
  onOpenChange,
  onSubmit,
  onValueChange,
}: RenameProjectDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{labels.renameDialogTitle}</DialogTitle>
        </DialogHeader>
        <input
          aria-label={labels.renameDialogTitle}
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') onSubmit();
          }}
          className="border-input bg-background h-10 rounded-md border px-3"
          autoFocus
        />
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            {commonLabels.cancel}
          </Button>
          <Button
            type="button"
            onClick={onSubmit}
            disabled={busy || !value.trim()}
          >
            {commonLabels.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteProjectDialog({
  busy,
  commonLabels,
  labels,
  open,
  projectCount,
  projectName,
  onConfirm,
  onOpenChange,
}: DeleteProjectDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {projectCount > 1
              ? labels.bulkDeleteDialogTitle
              : labels.deleteDialogTitle}
          </DialogTitle>
          <DialogDescription>
            {projectCount > 1
              ? labels.bulkDeleteDialogBody.replace(
                  '{count}',
                  String(projectCount),
                )
              : labels.deleteDialogBody.replace('{name}', projectName)}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            {commonLabels.cancel}
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={onConfirm}
            disabled={busy}
          >
            {labels.delete}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
