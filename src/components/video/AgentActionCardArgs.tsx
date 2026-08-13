import { formatArgValue } from './agentToolCallView';

/**
 * Render a record of action args as a compact key:value list — drop-in
 * replacement for the old `<pre>{JSON.stringify(args)}</pre>` block which
 * burned ~80px of vertical space per card.
 */
export function ArgList({ args }: { args: Record<string, unknown> }) {
  const entries = Object.entries(args).slice(0, 8);
  return (
    <div className="bg-muted/30 space-y-0.5 rounded p-1.5 text-[11px]">
      {entries.map(([key, value]) => (
        <div key={key} className="flex gap-1.5">
          <span className="text-muted-foreground/70 shrink-0">{key}:</span>
          <span className="text-foreground/80 min-w-0 break-all">
            {formatArgValue(value)}
          </span>
        </div>
      ))}
    </div>
  );
}

export function ReasoningList({
  heading,
  items,
}: {
  heading: string;
  items: string[];
}) {
  return (
    <div>
      <div className="text-muted-foreground mb-1 text-[10px] font-medium uppercase">
        {heading}
      </div>
      <ul className="text-muted-foreground list-disc space-y-1 pl-4 text-[11px]">
        {items.map((item, index) => (
          <li key={`${item}-${index}`}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
