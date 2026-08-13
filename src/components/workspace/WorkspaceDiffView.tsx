/**
 * WorkspaceDiffView — Shows file diffs for agent Edit operations.
 * Uses diff + diff2html (already in dependencies) for rendering.
 * Lazy-loaded via React.lazy() to avoid bundle impact on initial load.
 */
import { useEffect, useMemo, useState } from 'react';

import { createPatch } from 'diff';
import { html as diff2html } from 'diff2html';
import { FileCode, ToggleLeft, ToggleRight } from 'lucide-react';

import { useLanguage } from '@/shared/providers/language-provider';

import 'diff2html/bundles/css/diff2html.min.css';

export interface DiffEntry {
  filePath: string;
  before: string;
  after: string;
}

interface WorkspaceDiffViewProps {
  diffs: DiffEntry[];
}

export function WorkspaceDiffView({ diffs }: WorkspaceDiffViewProps) {
  const { t } = useLanguage();
  const [sideBySide, setSideBySide] = useState(true);
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    setSelectedIndex(0);
  }, [diffs]);

  if (diffs.length === 0) {
    return (
      <div className="text-muted-foreground flex flex-col items-center justify-center gap-2 p-8 text-sm">
        <FileCode className="text-muted-foreground/50 size-8" />
        <p>{t.task.noDiffChanges}</p>
      </div>
    );
  }

  const selected = diffs[selectedIndex] ?? diffs[0];

  return (
    <div className="flex h-full flex-col">
      {/* Header with file selector and view toggle */}
      <div className="border-border/40 flex items-center gap-2 border-b px-3 py-1.5">
        {diffs.length > 1 && (
          <select
            value={selectedIndex}
            onChange={(e) => setSelectedIndex(Number(e.target.value))}
            className="bg-muted text-foreground max-w-[200px] truncate rounded px-2 py-0.5 text-xs"
          >
            {diffs.map((d, i) => (
              <option key={d.filePath} value={i}>
                {d.filePath.split('/').pop()}
              </option>
            ))}
          </select>
        )}
        <span className="text-muted-foreground flex-1 truncate text-xs">
          {selected.filePath}
        </span>
        <button
          onClick={() => setSideBySide(!sideBySide)}
          className="text-muted-foreground hover:text-foreground flex items-center gap-1 rounded px-1.5 py-0.5 text-xs transition-colors"
          title={sideBySide ? t.task.diffUnified : t.task.diffSideBySide}
        >
          {sideBySide ? (
            <ToggleRight className="size-3.5" />
          ) : (
            <ToggleLeft className="size-3.5" />
          )}
          {sideBySide ? t.task.diffUnified : t.task.diffSideBySide}
        </button>
      </div>

      {/* Diff content */}
      <DiffContent
        filePath={selected.filePath}
        before={selected.before}
        after={selected.after}
        sideBySide={sideBySide}
      />
    </div>
  );
}

function DiffContent({
  filePath,
  before,
  after,
  sideBySide,
}: {
  filePath: string;
  before: string;
  after: string;
  sideBySide: boolean;
}) {
  const diffHtml = useMemo(() => {
    const patch = createPatch(filePath, before, after, '', '', {
      context: 3,
    });
    return diff2html(patch, {
      drawFileList: false,
      matching: 'lines',
      outputFormat: sideBySide ? 'side-by-side' : 'line-by-line',
    });
  }, [filePath, before, after, sideBySide]);

  // Safety: diff2html HTML-escapes all content from the unified diff patch.
  // The input (before/after) never flows into the HTML unescaped.
  return (
    <div
      className="flex-1 overflow-auto text-xs"
      dangerouslySetInnerHTML={{ __html: diffHtml }}
    />
  );
}
