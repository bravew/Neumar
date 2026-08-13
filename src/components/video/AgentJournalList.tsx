import { History, Redo2, Undo2 } from 'lucide-react';

import type { VideoAgentJournalEntry } from '@/shared/types/video';

interface AgentJournalListProps {
  entries: VideoAgentJournalEntry[];
  labels: {
    title: string;
    applied: string;
    undone: string;
    passed: string;
    failedReport: string;
    undo: string;
    redo: string;
  };
  actionLabels: Record<string, string>;
  busyEntryId: string | null;
  onUndo: (entryId: string) => void;
  onRedo: (entryId: string) => void;
}

const MAX_VISIBLE_ENTRIES = 5;

export function AgentJournalList({
  entries,
  labels,
  actionLabels,
  busyEntryId,
  onUndo,
  onRedo,
}: AgentJournalListProps) {
  const visibleEntries = entries.slice(-MAX_VISIBLE_ENTRIES).reverse();
  if (visibleEntries.length === 0) return null;

  return (
    <section className="border-border bg-muted/20 rounded-md border p-3">
      <h3 className="text-muted-foreground mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase">
        <History className="size-3" />
        {labels.title}
      </h3>
      <div className="space-y-2">
        {visibleEntries.map((entry) => (
          <JournalEntryRow
            key={entry.id}
            entry={entry}
            labels={labels}
            title={actionLabels[entry.tool] ?? entry.tool}
            busy={busyEntryId === entry.id}
            onUndo={onUndo}
            onRedo={onRedo}
          />
        ))}
      </div>
    </section>
  );
}

interface JournalEntryRowProps {
  entry: VideoAgentJournalEntry;
  labels: AgentJournalListProps['labels'];
  title: string;
  busy: boolean;
  onUndo: (entryId: string) => void;
  onRedo: (entryId: string) => void;
}

function JournalEntryRow({
  entry,
  labels,
  title,
  busy,
  onUndo,
  onRedo,
}: JournalEntryRowProps) {
  const canUndo = !entry.undone && (entry.inverseDiff?.length ?? 0) > 0;
  const canRedo = Boolean(entry.undone) && entry.diff.length > 0;

  return (
    <div className="border-border/80 bg-background rounded border px-2.5 py-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-foreground truncate text-xs font-medium">
            {title}
          </div>
          <div className="text-muted-foreground mt-0.5 text-[10px]">
            {journalStatus(entry, labels)}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {canUndo ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => onUndo(entry.id)}
              className="hover:bg-accent rounded p-1 disabled:opacity-50"
              aria-label={`${labels.undo}: ${title}`}
              title={labels.undo}
            >
              <Undo2 className="size-3.5" />
            </button>
          ) : null}
          {canRedo ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => onRedo(entry.id)}
              className="hover:bg-accent rounded p-1 disabled:opacity-50"
              aria-label={`${labels.redo}: ${title}`}
              title={labels.redo}
            >
              <Redo2 className="size-3.5" />
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function journalStatus(
  entry: VideoAgentJournalEntry,
  labels: AgentJournalListProps['labels'],
): string {
  if (entry.undone) return labels.undone;
  const resultStatus = resultRecord(entry.result)?.status;
  if (resultStatus === 'passed') return labels.passed;
  if (resultStatus === 'failed') return labels.failedReport;
  return labels.applied;
}

function resultRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
