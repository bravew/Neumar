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
import type { VideoTimelineTrack } from '@/shared/types/video';

interface TrackDeleteDialogProps {
  // A track with clips pending deletion. Null keeps the dialog closed.
  pending: VideoTimelineTrack | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export function TrackDeleteDialog({
  pending,
  onConfirm,
  onCancel,
}: TrackDeleteDialogProps) {
  const { t } = useLanguage();
  const labels = t.video.editor.timeline.deleteTrackConfirm;
  return (
    <Dialog
      open={pending !== null}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{labels.title}</DialogTitle>
          <DialogDescription>
            {labels.body
              .replace('{name}', pending?.name ?? '')
              .replace('{count}', String(pending?.clips.length ?? 0))}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            {labels.cancel}
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            {labels.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
