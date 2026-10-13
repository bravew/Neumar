import { Scissors, Undo2 } from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import type { VideoTimeline } from '@/shared/types/video';

import { useTimelineEditorStore } from '../timeline/useTimelineEditorStore';
import type { SourceTranscriptView } from './sourceTranscriptView';
import {
  planTranscriptCut,
  planTranscriptRestore,
  type TranscriptEditPlan,
} from './transcriptEditPlan';
import {
  useTranscriptSelectionStore,
  type TranscriptWordSelection,
} from './useTranscriptSelectionStore';

type Action = 'cut' | 'restore';

/** Runs a plan against the timeline store as a single undoable edit. */
export function runTranscriptAction(
  action: Action,
  view: SourceTranscriptView,
  selection: TranscriptWordSelection,
  messages: { restoreFailed: string; cutFailed: string; nothingToDo: string },
): boolean {
  const store = useTimelineEditorStore.getState();
  const timeline = store.timeline as VideoTimeline | null;
  if (!timeline) return false;
  const failed = action === 'cut' ? messages.cutFailed : messages.restoreFailed;
  let plan: TranscriptEditPlan;
  try {
    plan =
      action === 'cut'
        ? planTranscriptCut(timeline, view, selection)
        : planTranscriptRestore(timeline, view, selection);
  } catch {
    toast.error(failed);
    return false;
  }
  if (!plan.ok) {
    toast.error(
      plan.reason === 'nothing-to-do' ? messages.nothingToDo : failed,
    );
    return false;
  }
  const applied = store.applyTimelineOpBatch(plan.ops);
  if (!applied) toast.error(failed);
  return applied;
}

/** Mode toggle plus Cut / Restore for the current word selection. */
export function TranscriptEditBar({ view }: { view: SourceTranscriptView }) {
  const { t } = useLanguage();
  const labels = t.video.editor.transcript;
  const mode = useTranscriptSelectionStore((s) => s.mode);
  const setMode = useTranscriptSelectionStore((s) => s.setMode);
  const selection = useTranscriptSelectionStore((s) => s.selection);
  const active = selection?.sourceId === view.sourceId ? selection : null;
  const count = active ? active.endIndex - active.startIndex + 1 : 0;
  const messages = {
    restoreFailed: labels.restoreFailed,
    cutFailed: labels.cutFailed,
    nothingToDo: labels.nothingToDo,
  };

  return (
    <div className="border-border flex items-center gap-2 border-b px-3 py-1.5">
      <div role="group" aria-label={labels.modeLabel} className="flex gap-1">
        {(['text', 'cut'] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={mode === value}
            onClick={() => setMode(value)}
            className={cn(
              'rounded px-2 py-0.5 text-[11px]',
              mode === value
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted',
            )}
          >
            {value === 'text' ? labels.modeText : labels.modeCut}
          </button>
        ))}
      </div>
      <span className="text-muted-foreground ml-auto text-[11px]">
        {count > 0
          ? labels.selectedCount.replace('{count}', String(count))
          : mode === 'cut'
            ? labels.cutModeHint
            : labels.textModeHint}
      </span>
      <button
        type="button"
        disabled={!active}
        onClick={() =>
          active && runTranscriptAction('cut', view, active, messages)
        }
        className="hover:bg-muted text-foreground inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] disabled:opacity-40"
        aria-label={labels.cutAction}
        title={labels.cutAction}
      >
        <Scissors className="size-3" />
      </button>
      <button
        type="button"
        disabled={!active}
        onClick={() =>
          active && runTranscriptAction('restore', view, active, messages)
        }
        className="hover:bg-muted text-foreground inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] disabled:opacity-40"
        aria-label={labels.restoreAction}
        title={labels.restoreAction}
      >
        <Undo2 className="size-3" />
      </button>
    </div>
  );
}
