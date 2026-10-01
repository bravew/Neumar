import { useState } from 'react';

import { FileCode2 } from 'lucide-react';

import { API_BASE_URL } from '@/config';
import type { AgentMessage } from '@/shared/hooks/useAgent';
import { useLanguage } from '@/shared/providers/language-provider';

import {
  mapActivityLines,
  type ActivityKind,
  type ActivityLine,
} from './activity-lines';

function sentence(
  line: ActivityLine,
  tt: (key: string, vars?: Record<string, string | number>) => string,
): string {
  switch (line.kind as ActivityKind) {
    case 'read':
      return tt('task.activityRead', { path: line.label });
    case 'write':
      return tt('task.activityWrote', { path: line.label });
    case 'edit':
      return tt('task.activityEdited', { path: line.label });
    case 'bash':
      return tt('task.activityRan', { command: line.label });
    case 'web':
      return tt('task.activityVisited', { target: line.label });
    case 'search':
      return tt('task.activitySearched', { query: line.label });
    case 'mcp':
      return tt('task.activityUsed', { name: line.label });
    default:
      return line.label;
  }
}

async function openPath(path: string) {
  try {
    await fetch(`${API_BASE_URL}/files/open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, expandHome: true }),
    });
  } catch {
    // The panel still shows the path if the OS opener is unavailable.
  }
}

function parentDir(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx > 0 ? path.slice(0, idx) : path;
}

export function ActivityPanel({
  messages,
  sessionRoot,
  onOpenDiff,
}: {
  messages: AgentMessage[];
  sessionRoot?: string;
  onOpenDiff: (path: string) => void;
}) {
  const { t, tt } = useLanguage();
  const lines = mapActivityLines(messages, sessionRoot);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  if (lines.length === 0) {
    return (
      <p className="text-muted-foreground px-4 py-3 text-sm">
        {t.task.activityEmpty}
      </p>
    );
  }

  return (
    <ol className="space-y-1 px-2 py-2">
      {lines.map((line) => (
        <li key={line.id} className="rounded-md px-2 py-1.5">
          <div className="flex items-start gap-1.5">
            <span className="text-foreground/80 min-w-0 flex-1 text-sm break-words">
              {sentence(line, tt)}
            </span>
            {line.linksToDiff && line.path && (
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground shrink-0 p-0.5"
                title={t.task.activityShowDiff}
                aria-label={t.task.activityShowDiff}
                onClick={() => onOpenDiff(line.path!)}
              >
                <FileCode2 className="size-3.5" />
              </button>
            )}
          </div>
          {line.path && (
            <div className="mt-1 flex flex-wrap gap-2">
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground text-xs"
                onClick={() => void openPath(line.path!)}
              >
                {t.task.activityOpen}
              </button>
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground text-xs"
                onClick={() => void openPath(parentDir(line.path!))}
              >
                {t.task.activityReveal}
              </button>
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground text-xs"
                title={line.path}
                onClick={() => {
                  void navigator.clipboard.writeText(line.path!).then(() => {
                    setCopiedId(line.id);
                  });
                }}
              >
                {copiedId === line.id ? t.task.copied : t.task.copyPath}
              </button>
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}
