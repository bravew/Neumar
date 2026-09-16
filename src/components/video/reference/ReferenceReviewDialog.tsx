import { useEffect, useState } from 'react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { API_BASE_URL } from '@/config';
import { useLanguage } from '@/shared/providers/language-provider';
import type {
  VideoReference,
  VideoReferenceAnalysis,
  VideoReferenceArtifactEnvelope,
  VideoReferenceCoverage,
  VideoReferenceEvidenceItem,
  VideoReferenceRun,
  VideoReferenceTimelineArtifact,
} from '@/shared/types/video';

import { ReferenceReadingView } from './ReferenceReadingView';
import { ReferenceRunProgress } from './ReferenceRunProgress';

interface ReferenceReviewDialogProps {
  projectId: string;
  reference: VideoReference | null;
  run: VideoReferenceRun | null;
  onOpenChange: (open: boolean) => void;
}

interface ReferenceReadingPayload {
  analysis: VideoReferenceArtifactEnvelope<VideoReferenceAnalysis> | null;
  timeline: VideoReferenceArtifactEnvelope<VideoReferenceTimelineArtifact> | null;
  evidence: VideoReferenceEvidenceItem[];
  coverage: VideoReferenceCoverage | null;
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
  const [reading, setReading] = useState<{
    referenceId: string;
    payload: ReferenceReadingPayload;
  } | null>(null);
  useEffect(() => {
    if (!reference) return;
    const referenceId = reference.id;
    const controller = new AbortController();
    const url = `${API_BASE_URL}/video/projects/${encodeURIComponent(projectId)}/references/${encodeURIComponent(referenceId)}/reading`;
    void fetch(url, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return;
        const payload = (await response.json()) as ReferenceReadingPayload;
        if (!controller.signal.aborted) {
          setReading({ referenceId, payload });
        }
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [projectId, reference]);
  const activeReading =
    reference && reading?.referenceId === reference.id ? reading.payload : null;
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
            <ReferenceReadingView
              projectId={projectId}
              referenceId={reference.id}
              analysis={activeReading?.analysis ?? null}
              timeline={activeReading?.timeline ?? null}
              evidence={activeReading?.evidence ?? []}
              coverage={activeReading?.coverage ?? null}
            />
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
