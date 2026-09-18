import { Play, Square } from 'lucide-react';

import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import type {
  VideoReferenceEvidenceItem,
  VideoReferenceTimelineSection,
} from '@/shared/types/video';

interface ReferenceSectionListProps {
  sections: VideoReferenceTimelineSection[];
  evidence: VideoReferenceEvidenceItem[];
  thumbnails: Record<number, string>;
  activeSectionId: string | null;
  clampedSectionId: string | null;
  playing: boolean;
  onPlay: (section: VideoReferenceTimelineSection) => void;
  onStop: () => void;
}

/**
 * The reading's sections as playable rows.
 *
 * Shared by the rail and the fullscreen layout so the analysis reads the same
 * either way — only the column it sits in changes.
 */
export function ReferenceSectionList({
  sections,
  evidence,
  thumbnails,
  activeSectionId,
  clampedSectionId,
  playing,
  onPlay,
  onStop,
}: ReferenceSectionListProps) {
  const { t } = useLanguage();
  const copy = t.video.reference.reading;
  return (
    <ol className="space-y-2">
      {sections.map((section) => {
        const isActive = activeSectionId === section.id;
        const isClamped = clampedSectionId === section.id;
        const thumbnail = thumbnails[section.startMs];
        return (
          <li
            key={section.id}
            className={cn(
              'rounded border p-2 transition-colors',
              isActive ? 'border-primary/60 bg-accent/30' : 'border-border',
            )}
          >
            <div className="flex gap-2">
              <button
                type="button"
                className="group relative shrink-0 overflow-hidden rounded"
                onClick={() => (isClamped ? onStop() : onPlay(section))}
                aria-label={
                  isClamped
                    ? copy.stopSection
                    : copy.playSection.replace('{phase}', section.phase)
                }
              >
                {thumbnail ? (
                  <img
                    src={thumbnail}
                    alt=""
                    className="h-14 w-24 object-cover"
                  />
                ) : (
                  <span className="bg-muted block h-14 w-24" />
                )}
                <span
                  className={cn(
                    'absolute inset-0 flex items-center justify-center bg-black/30 transition-opacity',
                    isClamped
                      ? 'opacity-100'
                      : 'opacity-0 group-hover:opacity-100',
                  )}
                >
                  {isClamped && playing ? (
                    <Square className="size-4 text-white" />
                  ) : (
                    <Play className="size-4 text-white" />
                  )}
                </span>
              </button>
              <div className="min-w-0 flex-1 space-y-1">
                {/*
                  Phase and meta stack rather than share a row: side by side
                  they fight for width and the phase name loses, which in a
                  narrow column truncated titles down to a single letter.
                */}
                <button
                  type="button"
                  className="block w-full text-left font-medium"
                  onClick={() => onPlay(section)}
                >
                  {section.phase}
                </button>
                <span className="text-muted-foreground block text-[11px]">
                  {formatRange(section.startMs, section.endMs)} ·{' '}
                  {copy.confidence} {section.confidence.toFixed(2)}
                </span>
                {section.anchor ? (
                  <p className="text-muted-foreground">{section.anchor}</p>
                ) : null}
                <p>{section.effect}</p>
                <EvidenceIds
                  evidenceIds={section.evidenceIds}
                  evidence={evidence}
                />
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function EvidenceIds({
  evidenceIds,
  evidence,
}: {
  evidenceIds: string[];
  evidence: VideoReferenceEvidenceItem[];
}) {
  const labels = evidenceIds.map((id) =>
    evidence.some((item) => item.id === id) ? id : `${id}?`,
  );
  return (
    <p className="text-muted-foreground text-[11px]">{labels.join(', ')}</p>
  );
}

function formatRange(startMs: number, endMs: number): string {
  return `${(startMs / 1000).toFixed(1)}s–${(endMs / 1000).toFixed(1)}s`;
}
