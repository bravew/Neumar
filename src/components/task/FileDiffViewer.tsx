/**
 * FileDiffViewer
 *
 * Displays a list of file snapshots (before/after) for the current task.
 * Uses diff2html for rendering unified diffs inline.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import * as Diff from 'diff';
import { html as diff2html } from 'diff2html';
import DOMPurify from 'dompurify';
import { ChevronDown, ChevronRight, FileCode2 } from 'lucide-react';

import { API_BASE_URL } from '@/config';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

// diff2html CSS is injected inline to avoid a separate import
const DIFF2HTML_CSS = `
.d2h-wrapper{font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:11px;line-height:1.5}
.d2h-file-header{display:none}
.d2h-code-linenumber{color:#6b7280;width:2em;text-align:right;padding-right:6px;user-select:none}
.d2h-del{background:#fecaca}
.d2h-del .d2h-code-line-ctn{background:#fecaca}
.d2h-ins{background:#bbf7d0}
.d2h-ins .d2h-code-line-ctn{background:#bbf7d0}
.d2h-cntx{background:transparent}
.d2h-code-line{padding:0 8px}
.d2h-code-side-linenumber{display:none}
td.d2h-del.d2h-change{background:#fef3c7}
td.d2h-ins.d2h-change{background:#d1fae5}
.dark .d2h-del{background:#7f1d1d}
.dark .d2h-del .d2h-code-line-ctn{background:#7f1d1d}
.dark .d2h-ins{background:#14532d}
.dark .d2h-ins .d2h-code-line-ctn{background:#14532d}
.dark td.d2h-del.d2h-change{background:#78350f}
.dark td.d2h-ins.d2h-change{background:#064e3b}
`;

interface FileSnapshot {
  id: string;
  task_id: string;
  file_path: string;
  content_before: string | null;
  content_after: string | null;
  created_at: string;
}

function buildUnifiedDiff(
  before: string | null,
  after: string | null,
  filePath: string,
): string {
  const a = before ?? '';
  const b = after ?? '';
  const patch = Diff.createPatch(filePath, a, b, '', '', { context: 3 });
  return patch;
}

function countDiffLines(patch: string): {
  linesAdded: number;
  linesRemoved: number;
} {
  let linesAdded = 0;
  let linesRemoved = 0;
  for (const line of patch.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) linesAdded++;
    else if (line.startsWith('-') && !line.startsWith('---')) linesRemoved++;
  }
  return { linesAdded, linesRemoved };
}

function SnapshotEntry({ snapshot }: { snapshot: FileSnapshot }) {
  const [expanded, setExpanded] = useState(false);
  const fileName = snapshot.file_path.split('/').pop() ?? snapshot.file_path;

  const patch = buildUnifiedDiff(
    snapshot.content_before,
    snapshot.content_after,
    fileName,
  );

  const diffHtml = expanded
    ? DOMPurify.sanitize(
        diff2html(patch, {
          outputFormat: 'line-by-line',
          drawFileList: false,
          renderNothingWhenEmpty: false,
        }),
      )
    : '';

  const { linesAdded, linesRemoved } = countDiffLines(patch);
  const hasChange = snapshot.content_before !== snapshot.content_after;

  return (
    <div className="border-border overflow-hidden rounded-md border">
      <button
        onClick={() => setExpanded((p) => !p)}
        className={cn(
          'flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-xs transition-colors',
          expanded ? 'bg-muted/60' : 'hover:bg-muted/30',
        )}
      >
        {expanded ? (
          <ChevronDown className="text-muted-foreground size-3 shrink-0" />
        ) : (
          <ChevronRight className="text-muted-foreground size-3 shrink-0" />
        )}
        <FileCode2 className="text-muted-foreground size-3.5 shrink-0" />
        <span className="text-foreground/80 min-w-0 flex-1 truncate font-medium">
          {fileName}
        </span>
        {hasChange && (
          <span className="text-muted-foreground shrink-0">
            <span className="text-green-600 dark:text-green-400">
              +{linesAdded}
            </span>
            {' / '}
            <span className="text-red-600 dark:text-red-400">
              -{linesRemoved}
            </span>
          </span>
        )}
      </button>

      {expanded && (
        <div className="border-border overflow-x-auto border-t">
          <style dangerouslySetInnerHTML={{ __html: DIFF2HTML_CSS }} />
          {hasChange ? (
            <div
              className="d2h-wrapper"
              dangerouslySetInnerHTML={{ __html: diffHtml }}
            />
          ) : (
            <p className="text-muted-foreground px-3 py-2 text-xs">
              No changes detected.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

interface FileDiffViewerProps {
  taskId: string;
  /** Increment to trigger re-fetch */
  version?: number;
}

export function FileDiffViewer({ taskId, version = 0 }: FileDiffViewerProps) {
  const { t } = useLanguage();
  const [snapshots, setSnapshots] = useState<FileSnapshot[]>([]);
  const [loading, setLoading] = useState(false);
  const mountedRef = useRef(true);

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
        if (mountedRef.current) setSnapshots(data.snapshots ?? []);
      } catch {
        // Ignore — aborted or network error
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    },
    [taskId],
  );

  useEffect(() => {
    mountedRef.current = true;
    const ac = new AbortController();
    load(ac.signal);
    return () => {
      mountedRef.current = false;
      ac.abort();
    };
  }, [load, version]);

  if (loading) {
    return (
      <p className="text-muted-foreground px-2 py-1 text-xs">
        {t.common.loading}
      </p>
    );
  }

  if (snapshots.length === 0) {
    return (
      <p className="text-muted-foreground px-2 py-1 text-xs">
        {t.task.noChanges}
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      {snapshots.map((snap) => (
        <SnapshotEntry key={snap.id} snapshot={snap} />
      ))}
    </div>
  );
}
