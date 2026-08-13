import type {
  TimelineOpDiffLabels,
  TimelineOpRow,
} from './TimelineOpDiffSummary';

export function TimelineDiffBox({
  labels,
  rows,
}: {
  labels: TimelineOpDiffLabels;
  rows: TimelineOpRow[];
}) {
  return (
    <div className="border-border bg-muted/20 mb-3 rounded-md border p-2">
      <div className="text-muted-foreground mb-2 text-[10px] font-medium uppercase">
        {labels.title}
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-[11px]">
        {rows.map((row) => (
          <div key={`${row.label}:${row.value}`} className="contents">
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd className="text-foreground min-w-0 truncate font-mono">
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function IssueList({
  title,
  items,
}: {
  title: string;
  items: string[];
}) {
  if (items.length === 0) return null;
  return (
    <div className="border-border bg-muted/20 mb-3 rounded-md border p-2">
      <div className="text-muted-foreground mb-1 text-[10px] font-medium uppercase">
        {title}
      </div>
      <ul className="text-muted-foreground list-disc space-y-1 pl-4 text-[11px]">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
