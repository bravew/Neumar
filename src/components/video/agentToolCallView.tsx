import { cn } from '@/shared/lib/utils';

import type { ToolCallRecord } from './useAgentDock';

const TOOL_OUTPUT_PREVIEW = 320;

export function StageDot({ stage }: { stage: ToolCallRecord['stage'] }) {
  return (
    <span
      className={cn(
        'size-1.5 shrink-0 rounded-full',
        stage === 'complete' && 'bg-emerald-500',
        stage === 'error' && 'bg-destructive',
        stage === 'streaming' && 'animate-pulse bg-blue-500',
        stage === 'pending' && 'bg-amber-500',
      )}
    />
  );
}

export function ToolOutputSummary({ content }: { content: string }) {
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(content);
  } catch {
    // plain text
  }

  if (Array.isArray(parsed)) {
    const items = parsed.slice(0, 5);
    return (
      <div className="bg-muted/30 space-y-0.5 rounded p-1.5">
        {items.map((item, index) => {
          const record = item as Record<string, unknown>;
          const title = typeof record?.title === 'string' ? record.title : null;
          const url = typeof record?.url === 'string' ? record.url : null;
          if (title && url) {
            return (
              <div key={url} className="truncate">
                <span className="text-foreground/70">{title}</span>
                <span className="text-muted-foreground/50 ml-1">
                  {url.replace(/^https?:\/\//, '').slice(0, 40)}
                </span>
              </div>
            );
          }
          return (
            <div key={`item-${index}`} className="truncate text-[10px]">
              {JSON.stringify(item).slice(0, 80)}
            </div>
          );
        })}
      </div>
    );
  }

  if (parsed && typeof parsed === 'object') {
    const entries = Object.entries(parsed as Record<string, unknown>).slice(
      0,
      6,
    );
    return (
      <div className="bg-muted/30 space-y-0.5 rounded p-1.5">
        {entries.map(([key, value]) => (
          <div key={key} className="flex gap-1.5 truncate">
            <span className="text-muted-foreground/70 shrink-0">{key}:</span>
            <span className="text-foreground/70 truncate">
              {formatArgValue(value)}
            </span>
          </div>
        ))}
      </div>
    );
  }

  const text =
    content.length > TOOL_OUTPUT_PREVIEW
      ? `${content.slice(0, TOOL_OUTPUT_PREVIEW)}…`
      : content;
  const clean = text
    .replace(/<tool_use_error>([\s\S]*?)<\/tool_use_error>/g, '$1')
    .trim();
  if (!clean) return null;
  return (
    <div className="bg-muted/30 max-h-24 overflow-auto rounded p-1.5 whitespace-pre-wrap">
      {clean}
    </div>
  );
}

export function formatArgValue(value: unknown): string {
  if (typeof value === 'string') {
    return value.length > 120 ? `${value.slice(0, 120)}…` : value;
  }
  try {
    const str = JSON.stringify(value);
    return str.length > 120 ? `${str.slice(0, 120)}…` : str;
  } catch {
    return String(value);
  }
}

export function humanizeToolName(name: string): string {
  return name.replace(/^mcp__[^_]+__/, '');
}

export function toolSummary(call: ToolCallRecord): string {
  const name = humanizeToolName(call.name);
  const args = call.args;
  const url = typeof args.url === 'string' ? args.url : undefined;
  const query = typeof args.query === 'string' ? args.query : undefined;
  const filePath =
    typeof args.file_path === 'string'
      ? args.file_path
      : typeof args.path === 'string'
        ? args.path
        : typeof args.filePath === 'string'
          ? args.filePath
          : undefined;
  const command = typeof args.command === 'string' ? args.command : undefined;
  const pattern = typeof args.pattern === 'string' ? args.pattern : undefined;
  const skillName = typeof args.skill === 'string' ? args.skill : undefined;
  const toolQuery =
    typeof args.tool_name === 'string' ? args.tool_name : undefined;

  if (name === 'ToolSearch' && toolQuery) return `ToolSearch(${toolQuery})`;
  if (skillName) return `${name}(${skillName})`;
  if (url) {
    try {
      const u = new URL(url);
      const pathPart = u.pathname.slice(0, 30);
      return `${name}(${u.hostname}${pathPart}${u.pathname.length > 30 ? '…' : ''})`;
    } catch {
      return `${name}(${url.slice(0, 40)}…)`;
    }
  }
  if (query) {
    return `${name}(${query.slice(0, 50)}${query.length > 50 ? '…' : ''})`;
  }
  if (filePath) {
    const short = filePath.split('/').slice(-2).join('/');
    return `${name}(${short})`;
  }
  if (command) {
    return `${name}(${command.slice(0, 40)}${command.length > 40 ? '…' : ''})`;
  }
  if (pattern) {
    return `${name}(${pattern.slice(0, 40)}${pattern.length > 40 ? '…' : ''})`;
  }
  const firstString = Object.values(args).find(
    (v) => typeof v === 'string' && v.length > 0,
  ) as string | undefined;
  if (firstString) {
    return `${name}(${firstString.slice(0, 40)}${firstString.length > 40 ? '…' : ''})`;
  }
  return name;
}
