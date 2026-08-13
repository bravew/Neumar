import {
  TimelineFramePreviewStrip,
  type TimelineFramePreview,
} from './TimelineFramePreviewStrip';
import { IssueList, TimelineDiffBox } from './TimelineOpDiffPanels';
import type { AgentActionRecord } from './useAgentDock';

export interface TimelineOpDiffLabels {
  title: string;
  operation: string;
  clip: string;
  track: string;
  marker: string;
  from: string;
  to: string;
  duration: string;
  batch: string;
  operations: string;
  rippleImpact: string;
  downstreamClips: string;
  shift: string;
  milliseconds: string;
  conflicts: string;
  conflictCount: string;
  warnings: string;
  beforeFrames: string;
  afterFrames: string;
  frameAt: string;
  cacheHit: string;
}

interface TimelineOpDiffSummaryProps {
  action: AgentActionRecord;
  labels: TimelineOpDiffLabels;
}

export interface TimelineOpRow {
  label: string;
  value: string;
}

export function TimelineOpDiffSummary({
  action,
  labels,
}: TimelineOpDiffSummaryProps) {
  const ops = readRecordArray(action.args, 'ops');
  if (ops?.length) {
    return (
      <TimelineOpBatchDiffSummary action={action} labels={labels} ops={ops} />
    );
  }

  const op = readRecord(action.args, 'op') ?? action.args;
  const kind = readString(op, 'kind');
  if (!kind) return null;

  const rows = [
    { label: labels.operation, value: kind },
    {
      label: labels.clip,
      value: readString(op, 'clipId') ?? readNestedString(op, 'clip', 'id'),
    },
    {
      label: labels.track,
      value:
        readString(op, 'trackId') ??
        readNestedString(op, 'track', 'id') ??
        readNestedString(op, 'to', 'trackId') ??
        readNestedString(op, 'from', 'trackId'),
    },
    {
      label: labels.marker,
      value: readString(op, 'markerId') ?? readNestedString(op, 'marker', 'id'),
    },
    {
      label: labels.from,
      value: describeTiming(readRecord(op, 'from'), labels),
    },
    {
      label: labels.to,
      value: describeTiming(readRecord(op, 'to'), labels),
    },
    {
      label: labels.duration,
      value: formatOptionalMs(
        readNumber(op, 'durationMs') ??
          readNestedNumber(op, 'to', 'durationMs'),
        labels,
      ),
    },
  ].filter((row): row is TimelineOpRow => Boolean(row.value));

  return <TimelineDiffDetails action={action} labels={labels} rows={rows} />;
}

function TimelineOpBatchDiffSummary({
  action,
  labels,
  ops,
}: TimelineOpDiffSummaryProps & { ops: Record<string, unknown>[] }) {
  const operationKinds = ops
    .map((op) => readString(op, 'kind'))
    .filter((kind): kind is string => Boolean(kind));
  const rows = [
    {
      label: labels.batch,
      value: labels.operations.replace('{count}', formatNumber(ops.length)),
    },
    {
      label: labels.operation,
      value: operationKinds.length ? operationKinds.join(', ') : undefined,
    },
    {
      label: labels.rippleImpact,
      value: describeRippleImpact(
        readRecord(action.args, 'rippleImpact'),
        labels,
      ),
    },
    {
      label: labels.conflicts,
      value: describeConflictCount(action.args, labels),
    },
  ].filter((row): row is TimelineOpRow => Boolean(row.value));

  return <TimelineDiffDetails action={action} labels={labels} rows={rows} />;
}

function TimelineDiffDetails({
  action,
  labels,
  rows,
}: TimelineOpDiffSummaryProps & { rows: TimelineOpRow[] }) {
  const frameGroups = readFrameGroups(action.args);
  return (
    <>
      <TimelineDiffBox labels={labels} rows={rows} />
      <IssueList
        title={labels.conflicts}
        items={readIssueList(action.args, 'conflicts')}
      />
      <IssueList
        title={labels.warnings}
        items={readIssueList(action.args, 'warnings')}
      />
      <TimelineFramePreviewStrip
        title={labels.beforeFrames}
        frames={frameGroups.before}
        frameAtLabel={labels.frameAt}
        cacheHitLabel={labels.cacheHit}
      />
      <TimelineFramePreviewStrip
        title={labels.afterFrames}
        frames={frameGroups.after}
        frameAtLabel={labels.frameAt}
        cacheHitLabel={labels.cacheHit}
      />
    </>
  );
}

function describeTiming(
  value: Record<string, unknown> | undefined,
  labels: TimelineOpDiffLabels,
): string | undefined {
  if (!value) return undefined;
  const parts = [
    readString(value, 'trackId'),
    formatOptionalMs(readNumber(value, 'startMs'), labels),
    formatOptionalMs(readNumber(value, 'trimStartMs'), labels),
    formatOptionalMs(readNumber(value, 'trimEndMs'), labels),
  ].filter((item): item is string => Boolean(item));
  const duration = formatOptionalMs(readNumber(value, 'durationMs'), labels);
  if (duration) parts.push(`${labels.duration}: ${duration}`);
  return parts.length ? parts.join(' / ') : undefined;
}

function describeRippleImpact(
  value: Record<string, unknown> | undefined,
  labels: TimelineOpDiffLabels,
): string | undefined {
  if (!value) return undefined;
  const downstreamClipCount = readNumber(value, 'downstreamClipCount');
  const shiftMs = readNumber(value, 'shiftMs');
  const parts = [
    downstreamClipCount === undefined
      ? undefined
      : labels.downstreamClips.replace(
          '{count}',
          formatNumber(downstreamClipCount),
        ),
    shiftMs === undefined
      ? undefined
      : labels.shift.replace(
          '{value}',
          formatOptionalMs(shiftMs, labels) ?? '',
        ),
  ].filter((part): part is string => Boolean(part));
  return parts.length ? parts.join(' / ') : undefined;
}

function describeConflictCount(
  value: Record<string, unknown>,
  labels: TimelineOpDiffLabels,
): string | undefined {
  const conflicts = readRecordArray(value, 'conflicts');
  return conflicts?.length
    ? labels.conflictCount.replace('{count}', formatNumber(conflicts.length))
    : undefined;
}

function formatOptionalMs(
  value: number | undefined,
  labels: TimelineOpDiffLabels,
): string | undefined {
  if (value === undefined) return undefined;
  return labels.milliseconds.replace('{value}', formatNumber(value));
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 1,
  }).format(value);
}

function readNestedString(
  value: Record<string, unknown>,
  key: string,
  nestedKey: string,
): string | undefined {
  const record = readRecord(value, key);
  return record ? readString(record, nestedKey) : undefined;
}

function readNestedNumber(
  value: Record<string, unknown>,
  key: string,
  nestedKey: string,
): number | undefined {
  const record = readRecord(value, key);
  return record ? readNumber(record, nestedKey) : undefined;
}

function readRecord(
  value: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const item = value[key];
  return isRecord(item) ? item : undefined;
}

function readRecordArray(
  value: Record<string, unknown>,
  key: string,
): Record<string, unknown>[] | undefined {
  const item = value[key];
  if (!Array.isArray(item)) return undefined;
  const records = item.filter(isRecord);
  return records.length === item.length ? records : undefined;
}

function readIssueList(value: Record<string, unknown>, key: string): string[] {
  const raw = value[key];
  if (Array.isArray(raw) && raw.every((item) => typeof item === 'string')) {
    return raw.slice(0, 4);
  }
  const items = readRecordArray(value, key);
  if (!items?.length) return [];
  return items.slice(0, 4).map((item) => {
    const code = readString(item, 'code') ?? readString(item, 'kind');
    const message = readString(item, 'message') ?? readString(item, 'reason');
    return [code, message].filter(Boolean).join(': ') || JSON.stringify(item);
  });
}

function readFrameGroups(value: Record<string, unknown>): {
  before: TimelineFramePreview[];
  after: TimelineFramePreview[];
} {
  const container =
    readRecord(value, 'timelineFrames') ??
    readRecord(value, 'previewFrames') ??
    readRecord(value, 'frames');
  if (!container) return { before: [], after: [] };
  return {
    before: readFrameList(container, 'before'),
    after: readFrameList(container, 'after'),
  };
}

function readFrameList(
  value: Record<string, unknown>,
  key: string,
): TimelineFramePreview[] {
  const items = readRecordArray(value, key) ?? [];
  return items
    .map((item) => {
      const atMs = readNumber(item, 'atMs');
      const imageBase64 = readString(item, 'imageBase64');
      if (atMs === undefined || !imageBase64) return null;
      return {
        atMs,
        imageBase64,
        w: readNumber(item, 'w'),
        h: readNumber(item, 'h'),
        cacheHit: item.cacheHit === true,
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
}

function readString(
  value: Record<string, unknown>,
  key: string,
): string | undefined {
  const item = value[key];
  return typeof item === 'string' && item.trim() ? item : undefined;
}

function readNumber(
  value: Record<string, unknown>,
  key: string,
): number | undefined {
  const item = value[key];
  return typeof item === 'number' && Number.isFinite(item) ? item : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
