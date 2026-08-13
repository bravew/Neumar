import { useEffect, useMemo, useState } from 'react';

import { ArrowUp, File, Folder, RefreshCw } from 'lucide-react';

import { API_BASE_URL } from '@/config';
import { useLanguage } from '@/shared/providers/language-provider';
import type { VideoProject } from '@/shared/types/video';

type StorageRoot = 'project' | 'cache';
type StorageEntryKind = 'directory' | 'file' | 'symlink' | 'other';

interface StorageTreeEntry {
  name: string;
  path: string;
  kind: StorageEntryKind;
  sizeBytes: number;
  updatedAt: string;
}

interface StorageTree {
  projectId: string;
  root: StorageRoot;
  path: string;
  entries: StorageTreeEntry[];
  totalSizeBytes: number;
}

interface StoragePanelProps {
  project: VideoProject;
}

export function StoragePanel({ project }: StoragePanelProps) {
  const { t } = useLanguage();
  const labels = t.video.storage;
  const unknownError = labels.unknownError;
  const [root, setRoot] = useState<StorageRoot>('project');
  const [path, setPath] = useState('');
  const [tree, setTree] = useState<StorageTree | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setTree(null);
    const query = new URLSearchParams({ root });
    if (path) query.set('path', path);
    fetch(
      `${API_BASE_URL}/video/projects/${encodeURIComponent(project.id)}/storage/tree?${query.toString()}`,
      { signal: controller.signal },
    )
      .then(async (response) => {
        const data = (await response.json()) as {
          tree?: StorageTree;
          error?: string;
        };
        if (!response.ok || !data.tree) {
          throw new Error(data.error ?? `HTTP ${response.status}`);
        }
        setTree(data.tree);
      })
      .catch((fetchError: unknown) => {
        if (
          fetchError instanceof DOMException &&
          fetchError.name === 'AbortError'
        ) {
          return;
        }
        setError(
          fetchError instanceof Error ? fetchError.message : unknownError,
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [project.id, root, path, reloadToken, unknownError]);

  const parentPath = useMemo(
    () => path.split('/').slice(0, -1).join('/'),
    [path],
  );

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <header className="border-border flex flex-wrap items-center gap-3 border-b px-5 py-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-foreground text-sm font-semibold">
            {labels.title}
          </h2>
          <p className="text-muted-foreground mt-1 text-xs">
            {labels.description}
          </p>
        </div>
        <div className="bg-muted flex rounded-md p-1">
          {(['project', 'cache'] as const).map((item) => (
            <button
              key={item}
              type="button"
              className={
                root === item
                  ? 'bg-background text-foreground rounded px-3 py-1.5 text-xs font-medium shadow-sm'
                  : 'text-muted-foreground hover:text-foreground rounded px-3 py-1.5 text-xs'
              }
              onClick={() => {
                setRoot(item);
                setPath('');
              }}
            >
              {item === 'project' ? labels.rootProject : labels.rootCache}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="text-muted-foreground hover:bg-accent hover:text-foreground flex size-8 items-center justify-center rounded-md"
          aria-label={labels.refresh}
          title={labels.refresh}
          onClick={() => setReloadToken((value) => value + 1)}
        >
          <RefreshCw className="size-4" />
        </button>
      </header>
      <div className="border-border flex items-center gap-2 border-b px-5 py-2">
        <button
          type="button"
          className="text-muted-foreground hover:bg-accent hover:text-foreground flex size-8 items-center justify-center rounded-md disabled:opacity-40"
          aria-label={labels.up}
          title={labels.up}
          disabled={!path}
          onClick={() => setPath(parentPath)}
        >
          <ArrowUp className="size-4" />
        </button>
        <span className="text-muted-foreground truncate text-xs">
          {labels.currentPath.replace('{path}', tree?.path || labels.rootPath)}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
        {error ? (
          <p className="text-destructive text-sm">
            {labels.error.replace('{error}', error)}
          </p>
        ) : null}
        {loading && !tree ? (
          <p className="text-muted-foreground text-sm">{labels.loading}</p>
        ) : null}
        {tree && tree.entries.length === 0 ? (
          <p className="text-muted-foreground text-sm">{labels.empty}</p>
        ) : null}
        {tree && tree.entries.length > 0 ? (
          <table className="w-full table-fixed text-left text-sm">
            <thead className="text-muted-foreground border-border border-b text-xs">
              <tr>
                <th className="w-1/2 py-2 pr-3 font-medium">{labels.name}</th>
                <th className="w-28 py-2 pr-3 font-medium">{labels.kind}</th>
                <th className="w-28 py-2 pr-3 font-medium">{labels.size}</th>
                <th className="w-44 py-2 font-medium">{labels.modified}</th>
              </tr>
            </thead>
            <tbody>
              {tree.entries.map((entry) => (
                <tr key={entry.path} className="border-border border-b">
                  <td className="py-2 pr-3">
                    {entry.kind === 'directory' ? (
                      <button
                        type="button"
                        className="text-foreground hover:text-primary flex min-w-0 items-center gap-2"
                        onClick={() => setPath(entry.path)}
                      >
                        <Folder className="size-4 shrink-0" />
                        <span className="truncate">{entry.name}</span>
                      </button>
                    ) : (
                      <span className="text-foreground flex min-w-0 items-center gap-2">
                        <File className="size-4 shrink-0" />
                        <span className="truncate">{entry.name}</span>
                      </span>
                    )}
                  </td>
                  <td className="text-muted-foreground py-2 pr-3 text-xs">
                    {kindLabel(entry.kind, labels)}
                  </td>
                  <td className="text-muted-foreground py-2 pr-3 text-xs">
                    {formatBytes(entry.sizeBytes)}
                  </td>
                  <td className="text-muted-foreground py-2 text-xs">
                    {new Date(entry.updatedAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>
    </section>
  );
}

function kindLabel(
  kind: StorageEntryKind,
  labels: {
    directory: string;
    file: string;
    symlink: string;
    other: string;
  },
): string {
  if (kind === 'directory') return labels.directory;
  if (kind === 'file') return labels.file;
  if (kind === 'symlink') return labels.symlink;
  return labels.other;
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let amount = value / 1024;
  let unitIndex = 0;
  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024;
    unitIndex += 1;
  }
  return `${amount.toFixed(amount >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}
