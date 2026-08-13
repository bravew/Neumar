/**
 * useMigrateWorkspace — workspace change + session migration hook.
 *
 * Two-phase flow:
 * 1. Apply new workDir immediately (settings saved + backend synced)
 * 2. Optionally migrate existing sessions from old → new via SSE streaming
 *
 * The session migration copies session folders, updates task DB records,
 * and cleans up the old sessions directory.
 */

import { useCallback, useRef, useState } from 'react';

import { useLanguage } from '@/shared/providers/language-provider';

import { API_BASE_URL } from '../constants';

// ============================================================================
// Types
// ============================================================================

export interface MigrationProgress {
  percent: number;
  copied: number;
  total: number;
  currentFile: string;
  phase: 'scan' | 'copy' | 'db' | 'done' | 'error';
}

export interface SessionStats {
  sessionCount: number;
  totalMB: number;
  folders?: string[];
}

// ============================================================================
// SSE stream parser — reusable for any SSE-over-POST response
// ============================================================================

type SSEHandler = (event: string, data: unknown) => void;

async function consumeSSE(res: Response, handler: SSEHandler): Promise<void> {
  const reader = res.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    let currentEvent = '';
    let currentData = '';
    for (const line of lines) {
      if (line.startsWith('event: ')) {
        currentEvent = line.slice(7);
      } else if (line.startsWith('data: ')) {
        currentData = line.slice(6);
      } else if (line === '' && currentData) {
        try {
          handler(currentEvent, JSON.parse(currentData));
        } catch {
          // malformed SSE data
        }
        currentEvent = '';
        currentData = '';
      }
    }
  }
}

// ============================================================================
// Hook
// ============================================================================

export function useMigrateWorkspace() {
  const { t } = useLanguage();
  const [migrating, setMigrating] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [progress, setProgress] = useState<MigrationProgress | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  /** Fetch session stats from old workspace (for the migration prompt). */
  const getSessionStats = useCallback(
    async (
      oldWorkDir: string,
      signal?: AbortSignal,
    ): Promise<SessionStats | null> => {
      try {
        const res = await fetch(
          `${API_BASE_URL}/files/session-stats?workDir=${encodeURIComponent(oldWorkDir)}`,
          { signal },
        );
        if (!res.ok) return null;
        return (await res.json()) as SessionStats;
      } catch {
        return null;
      }
    },
    [],
  );

  /** Migrate sessions from oldWorkDir → newWorkDir with streaming progress. */
  const migrateSessions = useCallback(
    async (oldWorkDir: string, newWorkDir: string): Promise<void> => {
      setMigrating(true);
      setStatus(null);
      setProgress({
        percent: 0,
        copied: 0,
        total: 0,
        currentFile: '',
        phase: 'scan',
      });
      abortRef.current = new AbortController();

      try {
        const res = await fetch(
          `${API_BASE_URL}/files/migrate-sessions-stream`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ oldWorkDir, newWorkDir }),
            signal: abortRef.current.signal,
          },
        );

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          setStatus(
            (err as { error?: string }).error ||
              t.settings.migrateSessionsFailed,
          );
          setProgress(null);
          return;
        }

        // Mutable container — callback assigns result, read after stream ends
        const result: {
          value: {
            success: boolean;
            copiedSessions: number;
            updatedTasks: number;
            errors: string[];
          } | null;
        } = { value: null };

        await consumeSSE(res, (event, data) => {
          const d = data as Record<string, unknown>;
          if (event === 'scan') {
            setProgress((prev) =>
              prev
                ? {
                    ...prev,
                    total: (d.totalFiles as number) ?? 0,
                    phase: 'copy',
                  }
                : prev,
            );
          } else if (event === 'progress') {
            setProgress({
              percent: (d.percent as number) ?? 0,
              copied: (d.copied as number) ?? 0,
              total: (d.total as number) ?? 0,
              currentFile: (d.folder as string) ?? '',
              phase: 'copy',
            });
          } else if (event === 'db') {
            setProgress((prev) =>
              prev ? { ...prev, phase: 'db', percent: 100 } : prev,
            );
          } else if (event === 'done') {
            result.value = d as NonNullable<typeof result.value>;
          }
        });

        const finalResult = result.value;
        if (finalResult) {
          setStatus(
            t.settings.migrateSessionsSuccess
              .replace('{sessions}', String(finalResult.copiedSessions))
              .replace('{tasks}', String(finalResult.updatedTasks)),
          );
        } else {
          setStatus(t.settings.migrateSessionsFailed);
        }
        setProgress((prev) => (prev ? { ...prev, phase: 'done' } : null));
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          setStatus(t.settings.migrateSessionsFailed);
          if (import.meta.env.DEV) {
            console.error('[Workspace] Session migration failed:', err);
          }
        }
        setProgress(null);
      } finally {
        setMigrating(false);
      }
    },
    [t],
  );

  const abort = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return {
    migrating,
    status,
    progress,
    getSessionStats,
    migrateSessions,
    abort,
  };
}
