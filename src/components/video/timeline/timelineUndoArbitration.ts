import type { VideoAgentJournalEntry } from '@/shared/types/video';

export type TimelineUndoTarget =
  | { kind: 'user' }
  | { kind: 'agent'; entryId: string }
  | null;

interface ResolveUndoTargetOptions {
  agentJournal: VideoAgentJournalEntry[];
  userUndoCreatedAt: string | null;
}

interface ResolveRedoTargetOptions {
  agentJournal: VideoAgentJournalEntry[];
  latestUserEditCreatedAt: string | null;
  userRedoCreatedAt: string | null;
}

export function resolveTimelineUndoTarget({
  agentJournal,
  userUndoCreatedAt,
}: ResolveUndoTargetOptions): TimelineUndoTarget {
  const agentEntry = latestUndoableAgentEntry(agentJournal);
  if (!agentEntry) return userUndoCreatedAt ? { kind: 'user' } : null;
  if (!userUndoCreatedAt) return { kind: 'agent', entryId: agentEntry.id };
  return timestampMs(userUndoCreatedAt) >= timestampMs(agentEntry.ts)
    ? { kind: 'user' }
    : { kind: 'agent', entryId: agentEntry.id };
}

export function resolveTimelineRedoTarget({
  agentJournal,
  latestUserEditCreatedAt,
  userRedoCreatedAt,
}: ResolveRedoTargetOptions): TimelineUndoTarget {
  const agentEntry = latestRedoableAgentEntry(
    agentJournal,
    latestUserEditCreatedAt,
  );
  if (!agentEntry) return userRedoCreatedAt ? { kind: 'user' } : null;
  if (!userRedoCreatedAt) return { kind: 'agent', entryId: agentEntry.id };
  return timestampMs(userRedoCreatedAt) >= timestampMs(agentEntry.ts)
    ? { kind: 'user' }
    : { kind: 'agent', entryId: agentEntry.id };
}

function latestUndoableAgentEntry(
  entries: VideoAgentJournalEntry[],
): VideoAgentJournalEntry | null {
  return latestEntry(entries, (entry) =>
    Boolean(!entry.undone && (entry.inverseDiff?.length ?? 0) > 0),
  );
}

function latestRedoableAgentEntry(
  entries: VideoAgentJournalEntry[],
  latestUserEditCreatedAt: string | null,
): VideoAgentJournalEntry | null {
  const branchAfter = timestampMs(latestUserEditCreatedAt);
  return latestEntry(
    entries,
    (entry) =>
      Boolean(entry.undone && entry.diff.length > 0) &&
      (!branchAfter || timestampMs(entry.ts) > branchAfter),
  );
}

function latestEntry(
  entries: VideoAgentJournalEntry[],
  predicate: (entry: VideoAgentJournalEntry) => boolean,
): VideoAgentJournalEntry | null {
  let latest: VideoAgentJournalEntry | null = null;
  for (const entry of entries) {
    if (!predicate(entry)) continue;
    if (!latest || timestampMs(entry.ts) >= timestampMs(latest.ts)) {
      latest = entry;
    }
  }
  return latest;
}

function timestampMs(value: string | null | undefined): number {
  if (!value) return 0;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
}
