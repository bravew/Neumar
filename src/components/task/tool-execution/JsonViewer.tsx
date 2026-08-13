import { useCallback, useState } from 'react';

import { ChevronRight } from 'lucide-react';

import { cn } from '@/shared/lib/utils';

import { formatCellValue, maskSecrets } from './tool-utils';

// ─── Key-Value Table ────────────────────────────────────────────────

export function KeyValueTable({
  data,
  keyLabel,
  valueLabel,
}: {
  data: Record<string, unknown>;
  keyLabel: string;
  valueLabel: string;
}) {
  const entries = Object.entries(data);

  return (
    <div className="border-border overflow-auto rounded-md border">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-muted/50 border-border border-b">
            <th className="text-muted-foreground w-[160px] px-3 py-2 text-left font-medium">
              {keyLabel}
            </th>
            <th className="text-muted-foreground px-3 py-2 text-left font-medium">
              {valueLabel}
            </th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([key, value]) => (
            <tr key={key} className="border-border/50 border-b last:border-b-0">
              <td className="px-3 py-1.5 align-top font-mono font-medium text-blue-400">
                {key}
              </td>
              <td className="text-foreground px-3 py-1.5 font-mono break-all whitespace-pre-wrap">
                {maskSecrets(formatCellValue(value))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Collapsible JSON Tree ──────────────────────────────────────────

export function JsonNode({
  label,
  value,
  defaultExpanded = true,
  depth = 0,
}: {
  label?: string;
  value: unknown;
  defaultExpanded?: boolean;
  depth?: number;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const isExpandable = value !== null && typeof value === 'object';
  const isArray = Array.isArray(value);

  const toggleExpanded = useCallback(() => setExpanded((prev) => !prev), []);

  // Leaf node
  if (!isExpandable) {
    return (
      <div
        className="flex items-baseline gap-1 py-0.5"
        style={{ paddingLeft: depth * 16 }}
      >
        {label != null && (
          <span className="shrink-0 font-medium text-blue-400">
            &quot;{label}&quot;:
          </span>
        )}
        <span
          className={cn(
            typeof value === 'string' && 'text-emerald-400',
            typeof value === 'number' && 'text-orange-400',
            typeof value === 'boolean' && 'text-violet-400',
            value === null && 'text-rose-400',
          )}
        >
          {value === null
            ? 'null'
            : typeof value === 'string'
              ? `"${maskSecrets(value.length > 200 ? value.slice(0, 200) + '...' : value)}"`
              : String(value)}
        </span>
      </div>
    );
  }

  const entries = isArray
    ? (value as unknown[]).map((v, i) => [String(i), v] as const)
    : Object.entries(value as Record<string, unknown>);

  const bracket = isArray ? ['[', ']'] : ['{', '}'];
  const isEmpty = entries.length === 0;

  return (
    <div style={{ paddingLeft: depth * 16 }}>
      <div
        className="hover:bg-accent/30 -ml-1 flex cursor-pointer items-center gap-1 rounded py-0.5 pl-1"
        onClick={toggleExpanded}
      >
        {!isEmpty && (
          <ChevronRight
            className={cn(
              'text-muted-foreground size-3 transition-transform',
              expanded && 'rotate-90',
            )}
          />
        )}
        {label != null && (
          <span className="font-medium text-blue-400">
            &quot;{label}&quot;:
          </span>
        )}
        <span className="text-muted-foreground">
          {isEmpty
            ? `${bracket[0]}${bracket[1]}`
            : expanded
              ? bracket[0]
              : `${bracket[0]}...${bracket[1]} // ${entries.length} ${isArray ? 'items' : 'keys'}`}
        </span>
      </div>
      {expanded && !isEmpty && (
        <>
          {entries.map(([key, val]) => (
            <JsonNode
              key={key}
              label={isArray ? undefined : key}
              value={val}
              defaultExpanded={depth < 1}
              depth={depth + 1}
            />
          ))}
          <div
            className="text-muted-foreground py-0.5"
            style={{ paddingLeft: 16 }}
          >
            {bracket[1]}
          </div>
        </>
      )}
    </div>
  );
}

export function JsonTreeView({
  data,
  className,
}: {
  data: unknown;
  className?: string;
}) {
  return (
    <div className={cn('font-mono text-xs', className)}>
      <JsonNode value={data} defaultExpanded />
    </div>
  );
}

// ─── View Mode Toggle ───────────────────────────────────────────────

export type ViewMode = 'table' | 'code' | 'tree';

export function ViewToggle({
  mode,
  onModeChange,
  showTable,
  labels,
}: {
  mode: ViewMode;
  onModeChange: (mode: ViewMode) => void;
  showTable: boolean;
  labels: { code: string; tree: string; table: string };
}) {
  const modes: { key: ViewMode; label: string; show: boolean }[] = [
    { key: 'table', label: labels.table, show: showTable },
    { key: 'code', label: labels.code, show: true },
    { key: 'tree', label: labels.tree, show: true },
  ];

  return (
    <div className="bg-muted/50 flex gap-0.5 rounded-md p-0.5">
      {modes
        .filter((m) => m.show)
        .map((m) => (
          <button
            key={m.key}
            onClick={() => onModeChange(m.key)}
            className={cn(
              'cursor-pointer rounded px-2 py-0.5 text-xs transition-colors',
              mode === m.key
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {m.label}
          </button>
        ))}
    </div>
  );
}
