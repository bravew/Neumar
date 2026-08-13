/**
 * WorkspaceFileTree — Shows files in the agent's working directory.
 * Fetches via POST /files/readdir, tracks agent-touched files, and
 * allows clicking to preview files.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  ChevronDown,
  ChevronRight,
  File,
  FileCode,
  FileImage,
  FileJson,
  FileText,
  Folder,
  FolderOpen,
  Loader2,
  RefreshCw,
} from 'lucide-react';

import { API_BASE_URL } from '@/config';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

interface FileEntry {
  name: string;
  path: string;
  isDir: boolean;
  children?: FileEntry[];
}

interface WorkspaceFileTreeProps {
  workDir: string;
  /** Called when user clicks a file — parent opens it in preview. */
  onSelectFile?: (filePath: string, fileName: string) => void;
}

const FILE_ICON_MAP: Record<string, typeof File> = {
  ts: FileCode,
  tsx: FileCode,
  js: FileCode,
  jsx: FileCode,
  py: FileCode,
  rs: FileCode,
  go: FileCode,
  json: FileJson,
  md: FileText,
  txt: FileText,
  png: FileImage,
  jpg: FileImage,
  jpeg: FileImage,
  gif: FileImage,
  svg: FileImage,
  webp: FileImage,
};

function getFileIcon(name: string) {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return FILE_ICON_MAP[ext] ?? File;
}

export function WorkspaceFileTree({
  workDir,
  onSelectFile,
}: WorkspaceFileTreeProps) {
  const { t } = useLanguage();
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchTree = useCallback(
    async (signal?: AbortSignal) => {
      if (!workDir) return;
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`${API_BASE_URL}/files/readdir`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: workDir, maxDepth: 3 }),
          signal,
        });
        const data = (await res.json()) as {
          success: boolean;
          files?: FileEntry[];
          error?: string;
        };
        if (data.success && data.files) {
          setEntries(data.files);
        } else {
          setError(data.error ?? 'Failed to load files');
        }
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        setError('Failed to connect to API');
      } finally {
        setLoading(false);
      }
    },
    [workDir],
  );

  useEffect(() => {
    const ac = new AbortController();
    abortRef.current = ac;
    fetchTree(ac.signal);
    return () => ac.abort();
  }, [fetchTree]);

  if (loading && entries.length === 0) {
    return (
      <div className="text-muted-foreground flex items-center justify-center gap-2 p-6 text-sm">
        <Loader2 className="size-4 animate-spin" />
        {t.common.loading}
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-muted-foreground p-4 text-center text-sm">
        <p>{error}</p>
        <button
          onClick={() => {
            abortRef.current?.abort();
            const ac = new AbortController();
            abortRef.current = ac;
            fetchTree(ac.signal);
          }}
          className="text-primary mt-2 text-xs underline"
        >
          {t.task.retry}
        </button>
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="text-muted-foreground p-4 text-center text-sm">
        {t.task.noFilesInWorkspace}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-border/40 flex items-center justify-between border-b px-3 py-1.5">
        <span className="text-muted-foreground text-xs font-medium">
          {t.task.workspaceFiles}
        </span>
        <button
          onClick={() => {
            abortRef.current?.abort();
            const ac = new AbortController();
            abortRef.current = ac;
            fetchTree(ac.signal);
          }}
          className="text-muted-foreground hover:text-foreground rounded p-0.5 transition-colors"
          title={t.common.refresh}
        >
          <RefreshCw className={cn('size-3', loading && 'animate-spin')} />
        </button>
      </div>
      <div className="flex-1 overflow-auto px-1 py-1 text-sm">
        {entries.map((entry) => (
          <TreeNode
            key={entry.path}
            entry={entry}
            depth={0}
            onSelectFile={onSelectFile}
          />
        ))}
      </div>
    </div>
  );
}

function TreeNode({
  entry,
  depth,
  onSelectFile,
}: {
  entry: FileEntry;
  depth: number;
  onSelectFile?: (path: string, name: string) => void;
}) {
  const [expanded, setExpanded] = useState(depth < 1);

  if (entry.isDir) {
    const FolderIcon = expanded ? FolderOpen : Folder;
    const ChevronIcon = expanded ? ChevronDown : ChevronRight;
    return (
      <div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="hover:bg-accent flex w-full items-center gap-1 rounded px-1 py-0.5 text-left"
          style={{ paddingLeft: `${depth * 12 + 4}px` }}
        >
          <ChevronIcon className="text-muted-foreground size-3 shrink-0" />
          <FolderIcon className="size-3.5 shrink-0 text-amber-500" />
          <span className="truncate">{entry.name}</span>
        </button>
        {expanded && entry.children && (
          <div>
            {entry.children.map((child) => (
              <TreeNode
                key={child.path}
                entry={child}
                depth={depth + 1}
                onSelectFile={onSelectFile}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  const FileIcon = getFileIcon(entry.name);
  return (
    <button
      onClick={() => onSelectFile?.(entry.path, entry.name)}
      className="hover:bg-accent flex w-full items-center gap-1 rounded px-1 py-0.5 text-left"
      style={{ paddingLeft: `${depth * 12 + 16}px` }}
    >
      <FileIcon className="text-muted-foreground size-3.5 shrink-0" />
      <span className="truncate">{entry.name}</span>
    </button>
  );
}
