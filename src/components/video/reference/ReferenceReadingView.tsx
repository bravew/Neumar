import { useLanguage } from '@/shared/providers/language-provider';
import type {
  VideoReferenceAnalysis,
  VideoReferenceArtifactEnvelope,
  VideoReferenceCoverage,
  VideoReferenceEvidenceItem,
  VideoReferenceTimelineArtifact,
} from '@/shared/types/video';

import { ReferenceSectionPlayer } from './ReferenceSectionPlayer';

export interface ReferenceReadingViewProps {
  projectId: string;
  referenceId: string;
  /** Streams the reference itself, so sections are playable in place. */
  mediaUrl: string;
  analysis: VideoReferenceArtifactEnvelope<VideoReferenceAnalysis> | null;
  timeline: VideoReferenceArtifactEnvelope<VideoReferenceTimelineArtifact> | null;
  evidence: VideoReferenceEvidenceItem[];
  coverage: VideoReferenceCoverage | null;
}

export function ReferenceReadingView({
  projectId,
  referenceId,
  mediaUrl,
  analysis,
  timeline,
  evidence,
  coverage,
}: ReferenceReadingViewProps) {
  const { t } = useLanguage();
  const copy = t.video.reference.reading;
  const stale = Boolean(analysis?.stale || timeline?.stale);
  const durationMs = coverage?.totalMs ?? timeline?.data.coverage.totalMs ?? 0;
  if (!analysis && !timeline) {
    return <p className="text-muted-foreground text-xs">{copy.empty}</p>;
  }
  return (
    <div
      className="space-y-3 text-xs"
      data-project-id={projectId}
      data-reference-id={referenceId}
    >
      {stale ? (
        <p className="text-amber-700 dark:text-amber-400">{copy.stale}</p>
      ) : null}
      {coverage && durationMs > 0 ? (
        <CoverageBar
          coverage={coverage}
          durationMs={durationMs}
          label={copy.coverage}
        />
      ) : null}
      {timeline ? (
        <ReferenceSectionPlayer
          mediaUrl={mediaUrl}
          sections={timeline.data.sections}
          evidence={evidence}
        />
      ) : null}
      {analysis ? (
        <div className="space-y-2">
          <section>
            <h3 className="font-medium">{copy.intent}</h3>
            <p>{analysis.data.intent}</p>
          </section>
          <section>
            <h3 className="font-medium">{copy.openQuestions}</h3>
            {analysis.data.openQuestions.length === 0 ? (
              <p className="text-muted-foreground">{copy.none}</p>
            ) : (
              <ul className="list-disc pl-4">
                {analysis.data.openQuestions.map((item) => (
                  <li key={item.question}>
                    {item.question}
                    {item.atMs !== undefined ? ` @ ${item.atMs}ms` : ''}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}

function CoverageBar({
  coverage,
  durationMs,
  label,
}: {
  coverage: VideoReferenceCoverage;
  durationMs: number;
  label: string;
}) {
  return (
    <div>
      <p className="mb-1 font-medium">
        {label} · {coverage.sampleCount}
      </p>
      <div className="bg-muted relative h-3 overflow-hidden rounded">
        {coverage.thinRanges.map((range) => (
          <span
            key={`${range.startMs}-${range.endMs}`}
            className="absolute inset-y-0 bg-amber-400/80"
            style={{
              left: `${(range.startMs / durationMs) * 100}%`,
              width: `${((range.endMs - range.startMs) / durationMs) * 100}%`,
            }}
            title={`${range.startMs}–${range.endMs}ms`}
          />
        ))}
      </div>
    </div>
  );
}
