import { useEffect, useState } from 'react';

import { FileCode2 } from 'lucide-react';

import { API_BASE_URL } from '@/config';
import type { AgentMessage } from '@/shared/hooks/useAgent';
import { useLanguage } from '@/shared/providers/language-provider';

import {
  mapActivityLines,
  parentDir,
  type ActivityKind,
  type ActivityLine,
} from './activity-lines';
import { RewindPreviewDialog } from './RewindPreviewDialog';

interface Checkpoint {
  messageRowId: number;
  userMessageId: string;
}

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

export function ActivityPanel({
  messages,
  sessionRoot,
  onOpenDiff,
  taskId,
  isRunning = false,
  onRewindComplete,
}: {
  messages: AgentMessage[];
  sessionRoot?: string;
  onOpenDiff: (path: string) => void;
  taskId?: string;
  isRunning?: boolean;
  onRewindComplete?: () => void;
}) {
  const { t, tt } = useLanguage();
  const lines = mapActivityLines(messages, sessionRoot);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [available, setAvailable] = useState<{
    taskId: string;
    checkpoints: Checkpoint[];
  } | null>(null);
  const [selectedCheckpoint, setSelectedCheckpoint] = useState<{
    taskId: string;
    userMessageId: string;
  } | null>(null);

  useEffect(() => {
    if (!taskId || isRunning) return;
    const controller = new AbortController();
    void fetch(
      `${API_BASE_URL}/agent/rewind/checkpoints/${encodeURIComponent(taskId)}`,
      { signal: controller.signal },
    )
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        return (await response.json()) as { checkpoints: Checkpoint[] };
      })
      .then(({ checkpoints }) => {
        if (!controller.signal.aborted) setAvailable({ taskId, checkpoints });
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setAvailable({ taskId, checkpoints: [] });
      });
    return () => controller.abort();
  }, [taskId, isRunning]);

  const checkpointIds = new Map(
    available && available.taskId === taskId && !isRunning
      ? available.checkpoints.map(
          ({ messageRowId, userMessageId }) =>
            [messageRowId, userMessageId] as const,
        )
      : [],
  );

  if (lines.length === 0) {
    return (
      <p className="text-muted-foreground px-4 py-3 text-sm">
        {t.task.activityEmpty}
      </p>
    );
  }

  const turnNumbers = new Map(
    lines
      .filter((line) => line.kind === 'turn')
      .map((line, index) => [line.id, index + 1]),
  );
  return (
    <>
      <ol className="space-y-1 px-2 py-2">
        {lines.map((line) => {
          if (line.kind === 'turn') {
            const userMessageId =
              line.messageRowId !== undefined
                ? checkpointIds.get(line.messageRowId)
                : undefined;
            return (
              <li
                key={line.id}
                className="border-border/50 mt-3 border-t px-2 pt-3 first:mt-0 first:border-0 first:pt-0"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-muted-foreground text-xs font-medium">
                    {tt('task.activityTurn', {
                      count: turnNumbers.get(line.id) ?? 1,
                    })}
                  </span>
                  {userMessageId && (
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-foreground text-right text-xs underline-offset-2 hover:underline"
                      onClick={() => {
                        if (taskId)
                          setSelectedCheckpoint({ taskId, userMessageId });
                      }}
                    >
                      {t.task.rewindTurn}
                    </button>
                  )}
                </div>
                {line.label && (
                  <p className="text-foreground/80 mt-1 line-clamp-2 text-sm break-words">
                    {line.label}
                  </p>
                )}
              </li>
            );
          }
          return (
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
                      void navigator.clipboard
                        .writeText(line.path!)
                        .then(() => {
                          setCopiedId(line.id);
                        });
                    }}
                  >
                    {copiedId === line.id ? t.task.copied : t.task.copyPath}
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {selectedCheckpoint && selectedCheckpoint.taskId === taskId && (
        <RewindPreviewDialog
          key={selectedCheckpoint.userMessageId}
          taskId={selectedCheckpoint.taskId}
          userMessageId={selectedCheckpoint.userMessageId}
          sessionRoot={sessionRoot}
          onClose={() => setSelectedCheckpoint(null)}
          onRewindComplete={onRewindComplete}
        />
      )}
    </>
  );
}
