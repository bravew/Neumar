/**
 * useFileDiffs — Fetches file snapshots from the API and converts to DiffEntry[].
 *
 * Used by WorkspacePanel to populate the Diff tab with before/after file content.
 * Re-fetches whenever `version` changes (e.g. new artifacts detected).
 */
import { useCallback, useEffect, useState } from 'react';

import type { DiffEntry } from '@/components/workspace/WorkspaceDiffView';
import { API_BASE_URL } from '@/config';

interface FileSnapshot {
  id: string;
  task_id: string;
  file_path: string;
  content_before: string | null;
  content_after: string | null;
  created_at: string;
}

export function useFileDiffs(taskId: string | undefined, version = 0) {
  const [diffs, setDiffs] = useState<DiffEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(
    async (signal: AbortSignal) => {
      if (!taskId) return;
      setLoading(true);
      try {
        const res = await fetch(`${API_BASE_URL}/files/snapshots/${taskId}`, {
          signal,
        });
        if (!res.ok) return;
        const data = (await res.json()) as { snapshots: FileSnapshot[] };

        const entries: DiffEntry[] = (data.snapshots ?? [])
          .filter((s) => s.content_before !== s.content_after)
          .map((s) => ({
            filePath: s.file_path,
            before: s.content_before ?? '',
            after: s.content_after ?? '',
          }));

        setDiffs(entries);
      } catch {
        // Aborted or network error
      } finally {
        setLoading(false);
      }
    },
    [taskId],
  );

  useEffect(() => {
    const ac = new AbortController();
    load(ac.signal);
    return () => ac.abort();
  }, [load, version]);

  return { diffs, loading };
}
