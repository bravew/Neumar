import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { ManualEditPatchJournalEntry } from '@/shared/types/design-mode';

import { isAppliedManualEditPatch } from './manual-edit-reducer';

interface ManualEditHistoryDialogProps {
  open: boolean;
  entries: ManualEditPatchJournalEntry[];
  labels: {
    title: string;
    description: string;
    empty: string;
    applied: string;
    reverted: string;
  };
  onOpenChange: (open: boolean) => void;
}

export function ManualEditHistoryDialog({
  open,
  entries,
  labels,
  onOpenChange,
}: ManualEditHistoryDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{labels.title}</DialogTitle>
          <DialogDescription>{labels.description}</DialogDescription>
        </DialogHeader>
        {entries.length === 0 ? (
          <p className="text-muted-foreground text-sm">{labels.empty}</p>
        ) : (
          <ol className="max-h-[50vh] space-y-2 overflow-auto pr-1">
            {entries.map((entry) => (
              <li key={entry.patchId} className="rounded-md border p-2 text-sm">
                {isAppliedManualEditPatch(entry) ? (
                  <>
                    <p className="font-medium">{labels.applied}</p>
                    <p className="text-muted-foreground mt-1 text-xs">
                      {entry.sourcePath} · {entry.patch.type}
                    </p>
                    <p className="text-muted-foreground mt-1 text-xs">
                      {entry.appliedAt}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="font-medium">{labels.reverted}</p>
                    <p className="text-muted-foreground mt-1 text-xs">
                      {entry.sourcePath} · {entry.revertedPatchId}
                    </p>
                    <p className="text-muted-foreground mt-1 text-xs">
                      {entry.revertedAt}
                    </p>
                  </>
                )}
              </li>
            ))}
          </ol>
        )}
      </DialogContent>
    </Dialog>
  );
}
