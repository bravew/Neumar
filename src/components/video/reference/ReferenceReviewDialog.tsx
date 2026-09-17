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
  VideoFramework,
  VideoReference,
  VideoReferenceAnalysis,
  VideoReferenceArtifactEnvelope,
  VideoReferenceCoverage,
  VideoReferenceEvidenceItem,
  VideoReferenceRun,
  VideoReferenceTimelineArtifact,
} from '@/shared/types/video';

import { FrameworkApplyPanel } from './FrameworkApplyPanel';
import { FrameworkReviewPanel } from './FrameworkReviewPanel';
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
  const [frameworkState, setFrameworkState] = useState<{
    referenceId: string;
    framework: VideoFramework;
    stale: boolean;
  } | null>(null);
  useEffect(() => {
    if (!reference) return;
    const referenceId = reference.id;
    const controller = new AbortController();
    const url = `${API_BASE_URL}/video/projects/${encodeURIComponent(projectId)}/references/${encodeURIComponent(referenceId)}/framework`;
    void fetch(url, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return;
        const payload = (await response.json()) as {
          framework: VideoFramework | null;
          stale?: boolean;
        };
        if (!controller.signal.aborted && payload.framework) {
          setFrameworkState({
            referenceId,
            framework: payload.framework,
            stale: Boolean(payload.stale),
          });
        }
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [projectId, reference]);
  const activeFramework =
    reference && frameworkState?.referenceId === reference.id
      ? frameworkState
      : null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] max-w-4xl flex-col overflow-hidden">
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
            {/* The reading, framework and apply sections together are taller
                than any viewport, so the dialog body owns the scroll rather
                than overflowing off-screen with no way to reach the rest. */}
            <div className="-mx-1 min-h-0 flex-1 space-y-3 overflow-y-auto px-1">
              <details className="border-border rounded border p-2">
                <summary className="cursor-pointer text-xs font-medium">
                  {t.video.reference.showSteps}
                </summary>
                <div className="mt-2">
                  {run ? (
                    <ReferenceRunProgress run={run} />
                  ) : (
                    <p className="text-muted-foreground text-xs">
                      {t.video.reference.review.noRun}
                    </p>
                  )}
                </div>
              </details>
              <ReferenceReadingView
                projectId={projectId}
                referenceId={reference.id}
                mediaUrl={mediaUrl}
                analysis={activeReading?.analysis ?? null}
                timeline={activeReading?.timeline ?? null}
                evidence={activeReading?.evidence ?? []}
                coverage={activeReading?.coverage ?? null}
              />
              <FrameworkReviewPanel
                framework={activeFramework?.framework ?? null}
                stale={activeFramework?.stale}
                onChangeRole={(sectionId, role) => {
                  if (!activeFramework) return;
                  const next: VideoFramework = {
                    ...activeFramework.framework,
                    sections: activeFramework.framework.sections.map(
                      (section) =>
                        section.id === sectionId
                          ? { ...section, role }
                          : section,
                    ),
                  };
                  setFrameworkState({
                    referenceId: activeFramework.referenceId,
                    framework: next,
                    stale: activeFramework.stale,
                  });
                  void fetch(
                    `${API_BASE_URL}/video/projects/${encodeURIComponent(projectId)}/references/${encodeURIComponent(reference.id)}/framework`,
                    {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ framework: next }),
                    },
                  ).catch(() => undefined);
                }}
                onSaveAsTemplate={() => {
                  void fetch(
                    `${API_BASE_URL}/video/projects/${encodeURIComponent(projectId)}/references/${encodeURIComponent(reference.id)}/framework/template`,
                    {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({}),
                    },
                  ).catch(() => undefined);
                }}
              />
              <FrameworkApplyPanel
                projectId={projectId}
                framework={activeFramework?.framework ?? null}
                stale={activeFramework?.stale}
              />
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
