import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { API_BASE_URL } from '@/config';
import { useLanguage } from '@/shared/providers/language-provider';
import type { VideoReference, VideoReferenceRun } from '@/shared/types/video';

import { ReferenceRunProgress } from './ReferenceRunProgress';

interface ReferenceReviewDialogProps {
  projectId: string;
  reference: VideoReference | null;
  run: VideoReferenceRun | null;
  onOpenChange: (open: boolean) => void;
}

export function ReferenceReviewDialog({
  projectId,
  reference,
  run,
  onOpenChange,
}: ReferenceReviewDialogProps) {
  const { t } = useLanguage();
  const open = reference !== null;
  const mediaUrl = reference
    ? `${API_BASE_URL}/video/projects/${encodeURIComponent(projectId)}/references/${encodeURIComponent(reference.id)}/media`
    : '';
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        {reference ? (
          <>
            <DialogHeader>
              <DialogTitle className="truncate text-sm">
                {reference.label}
              </DialogTitle>
              <DialogDescription>
                {t.video.reference.review.description}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 md:grid-cols-2">
              <video
                className="bg-muted aspect-video w-full rounded-md"
                controls
                src={mediaUrl}
              />
              <div className="max-h-80 min-h-0 overflow-auto">
                {run ? (
                  <ReferenceRunProgress run={run} />
                ) : (
                  <p className="text-muted-foreground text-xs">
                    {t.video.reference.review.noRun}
                  </p>
                )}
              </div>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
