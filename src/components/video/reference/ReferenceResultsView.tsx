import { useEffect, useState } from 'react';

import { ArrowLeft, MessageSquare } from 'lucide-react';

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

interface ReferenceResultsViewProps {
  projectId: string;
  reference: VideoReference;
  run: VideoReferenceRun | null;
  onBack: () => void;
  onDiscuss: () => void;
}

interface ReferenceReadingPayload {
  analysis: VideoReferenceArtifactEnvelope<VideoReferenceAnalysis> | null;
  timeline: VideoReferenceArtifactEnvelope<VideoReferenceTimelineArtifact> | null;
  evidence: VideoReferenceEvidenceItem[];
  coverage: VideoReferenceCoverage | null;
}

/**
 * A reference's results, in the rail rather than over it.
 *
 * This used to be a modal, which was the wrong shape for the content: a reading
 * is something the user consults *while* working — asking the agent about a
 * section, checking a claim against the timeline — and a modal blocks exactly
 * that. As a drill-down inside the Reference tab it keeps the editor and the
 * chat reachable, and Back returns to the list without losing the run.
 */
export function ReferenceResultsView({
  projectId,
  reference,
  run,
  onBack,
  onDiscuss,
}: ReferenceResultsViewProps) {
  const { t } = useLanguage();
  const labels = t.video.reference;
  const mediaUrl = `${API_BASE_URL}/video/projects/${encodeURIComponent(projectId)}/references/${encodeURIComponent(reference.id)}/media`;
  // Keyed by reference so switching references derives "no data yet" during
  // render instead of clearing state from inside the fetch effect.
  const [readingState, setReadingState] = useState<{
    referenceId: string;
    payload: ReferenceReadingPayload;
  } | null>(null);
  const [frameworkState, setFrameworkState] = useState<{
    referenceId: string;
    framework: VideoFramework;
    stale: boolean;
  } | null>(null);
  const referenceId = reference.id;
  const reading =
    readingState?.referenceId === referenceId ? readingState.payload : null;
  const framework =
    frameworkState?.referenceId === referenceId ? frameworkState : null;

  useEffect(() => {
    const controller = new AbortController();
    const url = `${API_BASE_URL}/video/projects/${encodeURIComponent(projectId)}/references/${encodeURIComponent(referenceId)}/reading`;
    void fetch(url, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return;
        const payload = (await response.json()) as ReferenceReadingPayload;
        if (!controller.signal.aborted) {
          setReadingState({ referenceId, payload });
        }
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [projectId, referenceId]);

  useEffect(() => {
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
  }, [projectId, referenceId]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs"
          onClick={onBack}
        >
          <ArrowLeft className="size-3.5" />
          {labels.backToList}
        </button>
        <button
          type="button"
          className="border-border hover:bg-accent ml-auto flex items-center gap-1 rounded border px-2 py-1 text-[11px]"
          onClick={onDiscuss}
        >
          <MessageSquare className="size-3" />
          {labels.discuss}
        </button>
      </div>
      <p className="text-foreground truncate text-xs font-medium">
        {reference.label}
      </p>
      <details className="border-border rounded border p-2">
        <summary className="cursor-pointer text-xs font-medium">
          {labels.showSteps}
        </summary>
        <div className="mt-2">
          {run ? (
            <ReferenceRunProgress run={run} />
          ) : (
            <p className="text-muted-foreground text-xs">
              {labels.review.noRun}
            </p>
          )}
        </div>
      </details>
      <ReferenceReadingView
        projectId={projectId}
        referenceId={referenceId}
        mediaUrl={mediaUrl}
        analysis={reading?.analysis ?? null}
        timeline={reading?.timeline ?? null}
        evidence={reading?.evidence ?? []}
        coverage={reading?.coverage ?? null}
      />
      <FrameworkReviewPanel
        framework={framework?.framework ?? null}
        stale={framework?.stale}
        onChangeRole={(sectionId, role) => {
          if (!framework) return;
          const next: VideoFramework = {
            ...framework.framework,
            sections: framework.framework.sections.map((section) =>
              section.id === sectionId ? { ...section, role } : section,
            ),
          };
          setFrameworkState({
            referenceId,
            framework: next,
            stale: framework.stale,
          });
          void fetch(
            `${API_BASE_URL}/video/projects/${encodeURIComponent(projectId)}/references/${encodeURIComponent(referenceId)}/framework`,
            {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ framework: next }),
            },
          ).catch(() => undefined);
        }}
        onSaveAsTemplate={() => {
          void fetch(
            `${API_BASE_URL}/video/projects/${encodeURIComponent(projectId)}/references/${encodeURIComponent(referenceId)}/framework/template`,
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
        framework={framework?.framework ?? null}
        stale={framework?.stale}
      />
    </div>
  );
}
