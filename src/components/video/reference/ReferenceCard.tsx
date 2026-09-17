import { useState } from 'react';

import {
  ChevronDown,
  ChevronRight,
  Loader2,
  Play,
  PauseCircle,
  Square,
  Trash2,
} from 'lucide-react';

import { useLanguage } from '@/shared/providers/language-provider';
import type { VideoReference, VideoReferenceRun } from '@/shared/types/video';

import { ReferenceRunProgress } from './ReferenceRunProgress';
import { ReferenceRunSummary } from './ReferenceRunSummary';
import { blockedSteps, runIsActive } from './useReferenceStudyStore';

interface ReferenceCardProps {
  reference: VideoReference;
  run: VideoReferenceRun | undefined;
  active: boolean;
  actionsEnabled: boolean;
  onAnalyze: () => void;
  onCancel: () => void;
  onOpenResults: () => void;
  onSelect: () => void;
  onDelete: () => void;
  onUnblock: (stepId: string, reason: string) => void;
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
  onDelete,
  onUnblock,
}: ReferenceCardProps) {
  const { t } = useLanguage();
  const labels = t.video.reference;
  const [expanded, setExpanded] = useState(false);
  // Removal drops the media and every artifact, so it confirms in place rather
  // than in a modal — a side rail this narrow should not open a dialog to ask.
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const running = runIsActive(run);
  const hasRun = run !== undefined;
  // A parked step is the one thing the user can actually act on, so it gets its
  // own block with the reason and a control — not a line buried in step detail.
  const blocked = run ? blockedSteps(run) : [];
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
        <button
          type="button"
          aria-label={labels.delete}
          title={labels.delete}
          className="text-muted-foreground hover:text-destructive shrink-0"
          onClick={() => setConfirmingDelete(true)}
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
      {confirmingDelete ? (
        <div className="border-destructive/50 bg-destructive/10 space-y-2 rounded border p-2">
          <p className="text-foreground text-[11px]">{labels.deleteConfirm}</p>
          <div className="flex gap-1">
            <button
              type="button"
              className="border-destructive/60 text-destructive hover:bg-destructive/20 rounded border px-2 py-1 text-[11px]"
              onClick={() => {
                setConfirmingDelete(false);
                onDelete();
              }}
            >
              {labels.delete}
            </button>
            <button
              type="button"
              className="border-border hover:bg-accent rounded border px-2 py-1 text-[11px]"
              onClick={() => setConfirmingDelete(false)}
            >
              {labels.deleteKeep}
            </button>
          </div>
        </div>
      ) : null}
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
            disabled={!actionsEnabled || blocked.length > 0}
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
      {!running && blocked.length > 0 ? (
        <div className="border-border bg-muted/40 space-y-2 rounded border p-2">
          {blocked.map((step) => (
            <div key={step.id} className="space-y-1">
              <p className="text-foreground flex items-center gap-1 text-[11px] font-medium">
                <PauseCircle className="size-3 shrink-0" />
                {labels.blockedOn.replace('{step}', labels.steps[step.id])}
              </p>
              {step.note ? (
                <p className="text-muted-foreground text-[11px]">{step.note}</p>
              ) : null}
              <button
                type="button"
                className="border-border hover:bg-accent rounded border px-2 py-1 text-[11px] disabled:opacity-40"
                disabled={!actionsEnabled}
                onClick={() => onUnblock(step.id, step.note ?? '')}
              >
                {labels.unblock}
              </button>
            </div>
          ))}
        </div>
      ) : null}
      {run && expanded ? <ReferenceRunProgress run={run} /> : null}
    </li>
  );
}
