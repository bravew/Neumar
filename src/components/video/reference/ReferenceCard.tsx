import { useState } from 'react';

import { ChevronDown, ChevronRight, Loader2, Play, Square } from 'lucide-react';

import { useLanguage } from '@/shared/providers/language-provider';
import type { VideoReference, VideoReferenceRun } from '@/shared/types/video';

import { ReferenceRunProgress } from './ReferenceRunProgress';
import { ReferenceRunSummary } from './ReferenceRunSummary';
import { runIsActive } from './useReferenceStudyStore';

interface ReferenceCardProps {
  reference: VideoReference;
  run: VideoReferenceRun | undefined;
  active: boolean;
  actionsEnabled: boolean;
  onAnalyze: () => void;
  onCancel: () => void;
  onOpenResults: () => void;
  onSelect: () => void;
}

/**
 * One reference in the Analyze video tab, with its run attached.
 *
 * Everything the user needs to judge "is this moving?" lives here: a primary
 * Analyze/Cancel control, the step rail, and expandable per-step detail. The
 * review dialog stays for deep reading (evidence grids, framework, apply).
 */
export function ReferenceCard({
  reference,
  run,
  active,
  actionsEnabled,
  onAnalyze,
  onCancel,
  onOpenResults,
  onSelect,
}: ReferenceCardProps) {
  const { t } = useLanguage();
  const labels = t.video.reference;
  const [expanded, setExpanded] = useState(false);
  const running = runIsActive(run);
  const hasRun = run !== undefined;
  return (
    <li
      className={`space-y-2 rounded-md border p-2 ${
        active ? 'border-primary/60 bg-accent/30' : 'border-border'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          className="text-foreground min-w-0 flex-1 truncate text-left text-xs font-medium"
          onClick={onSelect}
        >
          {reference.label}
        </button>
        <span className="text-muted-foreground shrink-0 text-[10px] tabular-nums">
          {(reference.durationMs / 1000).toFixed(1)}s
        </span>
      </div>
      {run ? <ReferenceRunSummary run={run} /> : null}
      <div className="flex flex-wrap items-center gap-1">
        {running ? (
          <button
            type="button"
            className="border-border hover:bg-accent flex items-center gap-1 rounded border px-2 py-1 text-[11px] disabled:opacity-40"
            disabled={!actionsEnabled}
            onClick={onCancel}
          >
            <Square className="size-3" />
            {labels.cancel}
          </button>
        ) : (
          <button
            type="button"
            className="border-primary/60 bg-primary/10 hover:bg-primary/20 text-foreground flex items-center gap-1 rounded border px-2 py-1 text-[11px] disabled:opacity-40"
            disabled={!actionsEnabled}
            onClick={onAnalyze}
          >
            <Play className="size-3" />
            {hasRun ? labels.reanalyze : labels.analyze}
          </button>
        )}
        <button
          type="button"
          className="border-border hover:bg-accent rounded border px-2 py-1 text-[11px]"
          onClick={onOpenResults}
        >
          {labels.openResults}
        </button>
        {run ? (
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground ml-auto flex items-center gap-1 text-[11px]"
            onClick={() => setExpanded((prev) => !prev)}
            aria-expanded={expanded}
          >
            {expanded ? (
              <ChevronDown className="size-3" />
            ) : (
              <ChevronRight className="size-3" />
            )}
            {expanded ? labels.hideSteps : labels.showSteps}
          </button>
        ) : null}
        {running ? (
          <Loader2 className="text-muted-foreground size-3 animate-spin" />
        ) : null}
      </div>
      {run && expanded ? <ReferenceRunProgress run={run} /> : null}
    </li>
  );
}
