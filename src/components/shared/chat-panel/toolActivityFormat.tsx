import { parseGenUIEnvelope } from '@/shared/types/gen-ui';

import { GenUIRenderer } from './GenUIRenderer';
import type { ChatToolCall } from './types';

export function ToolOutputSummary({ content }: { content: string }) {
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(content);
  } catch {
    // Plain text.
  }

  const genUI = parseGenUIEnvelope(parsed ?? content);
  if (genUI) return <GenUIRenderer envelope={genUI} />;

  if (Array.isArray(parsed)) {
    return (
      <div className="bg-muted/30 space-y-0.5 rounded p-1.5">
        {parsed.slice(0, 5).map((item, index) => (
          <div key={`item-${index}`} className="truncate text-[10px]">
            {formatArgValue(item).slice(0, 80)}
          </div>
        ))}
      </div>
    );
  }

  if (parsed && typeof parsed === 'object') {
    return (
      <div className="bg-muted/30 space-y-0.5 rounded p-1.5">
        {Object.entries(parsed as Record<string, unknown>)
          .slice(0, 6)
          .map(([key, value]) => (
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

  const clean = content
    .slice(0, 320)
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
    return value.length > 120 ? `${value.slice(0, 120)}...` : value;
  }
  try {
    const valueJson = JSON.stringify(value);
    return valueJson.length > 120 ? `${valueJson.slice(0, 120)}...` : valueJson;
  } catch {
    return String(value);
  }
}

export function humanizeToolName(name: string): string {
  return name.replace(/^mcp__[^_]+__/, '');
}

export function toolSummary(call: ChatToolCall): string {
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
  if (url) return summarizeUrlTool(name, url);
  if (query)
    return `${name}(${query.slice(0, 50)}${query.length > 50 ? '...' : ''})`;
  if (filePath) return `${name}(${filePath.split('/').slice(-2).join('/')})`;
  if (command)
    return `${name}(${command.slice(0, 40)}${command.length > 40 ? '...' : ''})`;
  if (pattern)
    return `${name}(${pattern.slice(0, 40)}${pattern.length > 40 ? '...' : ''})`;
  const firstString = Object.values(args).find(
    (value) => typeof value === 'string' && value.length > 0,
  ) as string | undefined;
  if (firstString) {
    return `${name}(${firstString.slice(0, 40)}${firstString.length > 40 ? '...' : ''})`;
  }
  return name;
}

function summarizeUrlTool(name: string, url: string): string {
  try {
    const parsedUrl = new URL(url);
    const pathPart = parsedUrl.pathname.slice(0, 30);
    return `${name}(${parsedUrl.hostname}${pathPart}${parsedUrl.pathname.length > 30 ? '...' : ''})`;
  } catch {
    return `${name}(${url.slice(0, 40)}...)`;
  }
}
