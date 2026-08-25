import { useState } from 'react';

import { Database, FolderOpen, RefreshCw, Trash2 } from 'lucide-react';

import { API_BASE_URL } from '@/config';
import { openNativeFolderDialog } from '@/shared/assets/api';
import { grantFileReadAccess } from '@/shared/lib/tauri-scope';
import { useLanguage } from '@/shared/providers/language-provider';
import type {
  VideoLinkedSource,
  VideoLinkedSourceProvider,
  VideoLinkedSourceRole,
  VideoProject,
} from '@/shared/types/video';

import type { VideoProjectEditorActions } from './editorTypes';
import { LinkedAssetsBrowser } from './LinkedAssetsBrowser';

interface LinkedSourcesPanelProps {
  project: VideoProject;
  actions: VideoProjectEditorActions;
}

const CLOUD_PROVIDERS: VideoLinkedSourceProvider[] = [
  'google-drive',
  'box',
  'dropbox',
  'onedrive',
  'immich',
  's3',
];

export function LinkedSourcesPanel({
  project,
  actions,
}: LinkedSourcesPanelProps) {
  const { t } = useLanguage();
  const [role, setRole] = useState<VideoLinkedSourceRole>('context');
  const [provider, setProvider] =
    useState<VideoLinkedSourceProvider>('google-drive');
  const [connectionId, setConnectionId] = useState('');
  const [rootPath, setRootPath] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [browseSource, setBrowseSource] = useState<VideoLinkedSource | null>(
    null,
  );

  const linkedSources = project.linkedSources ?? [];

  const addLocalFolder = async () => {
    setBusy('local');
    setError(null);
    try {
      const selected = await pickLocalFolder(
        t.video.editor.linkedFolder.add.local,
      );
      if (!selected) return;
      await grantFileReadAccess([selected]);
      const grant = await actions.grantLocalFolder(selected);
      const added = await actions.addLinkedSource({
        provider: 'local-fs',
        rootPath: grant.rootPath,
        displayName: lastPathSegment(grant.rootPath),
        role,
        localGrantToken: grant.token,
        filters: { types: ['image', 'video'] },
      });
      // Start indexing immediately — a new source sits at
      // `index.state:'unindexed'` until something syncs it, so without this the
      // linked folder's media never appears.
      if (added?.source) await actions.syncLinkedSource(added.source.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const addCloudFolder = async () => {
    if (!rootPath.trim()) return;
    setBusy('cloud');
    setError(null);
    try {
      await actions.addLinkedSource({
        provider,
        connectionId: connectionId.trim() || undefined,
        rootPath: rootPath.trim(),
        displayName: displayName.trim() || rootPath.trim(),
        role,
        filters: { types: ['image', 'video'] },
      });
      setRootPath('');
      setDisplayName('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-foreground text-xs font-semibold">
          {t.video.editor.sideRail.sources.linked.title}
        </h3>
        {linkedSources.length === 0 ? (
          <p className="text-muted-foreground text-xs">
            {t.video.editor.sideRail.sources.linked.empty}
          </p>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={busy === 'local'}
          onClick={() => void addLocalFolder()}
          className="border-border hover:bg-accent flex items-center justify-center gap-2 rounded-md border px-2 py-2 text-xs disabled:opacity-50"
        >
          <FolderOpen className="size-3.5" />
          {t.video.editor.linkedFolder.add.local}
        </button>
        <select
          value={role}
          onChange={(event) =>
            setRole(event.target.value as VideoLinkedSourceRole)
          }
          className="border-input bg-background rounded-md border px-2 py-2 text-xs"
        >
          <option value="context">
            {t.video.editor.linkedFolder.role.context.label}
          </option>
          <option value="b-roll">
            {t.video.editor.linkedFolder.role.bRoll.label}
          </option>
          <option value="reference">
            {t.video.editor.linkedFolder.role.reference.label}
          </option>
        </select>
      </div>
      <div className="border-border space-y-2 rounded-md border p-2">
        <div className="flex gap-2">
          <select
            value={provider}
            onChange={(event) =>
              setProvider(event.target.value as VideoLinkedSourceProvider)
            }
            className="border-input bg-background min-w-0 flex-1 rounded-md border px-2 py-2 text-xs"
          >
            {CLOUD_PROVIDERS.map((item) => (
              <option key={item} value={item}>
                {providerLabel(t, item)}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={busy === 'cloud' || !rootPath.trim()}
            onClick={() => void addCloudFolder()}
            className="border-border hover:bg-accent rounded-md border px-2 py-2 text-xs disabled:opacity-50"
          >
            {t.video.editor.linkedFolder.add.title}
          </button>
        </div>
        <input
          value={connectionId}
          onChange={(event) => setConnectionId(event.target.value)}
          placeholder={t.video.editor.linkedFolder.add.connectionPlaceholder}
          className="border-input bg-background w-full rounded-md border px-2 py-2 text-xs"
        />
        <input
          value={rootPath}
          onChange={(event) => setRootPath(event.target.value)}
          placeholder={t.video.editor.linkedFolder.add.rootPlaceholder}
          className="border-input bg-background w-full rounded-md border px-2 py-2 text-xs"
        />
        <input
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          placeholder={t.video.editor.linkedFolder.add.title}
          className="border-input bg-background w-full rounded-md border px-2 py-2 text-xs"
        />
      </div>
      {error ? <p className="text-destructive text-xs">{error}</p> : null}
      <div className="space-y-2">
        {linkedSources.map((source) => (
          <LinkedSourceRow
            key={source.id}
            source={source}
            onBrowse={() => setBrowseSource(source)}
            onSync={() => void actions.syncLinkedSource(source.id)}
            onRemove={() => void actions.removeLinkedSource(source.id)}
          />
        ))}
      </div>
      {browseSource ? (
        <LinkedAssetsBrowser
          project={project}
          source={browseSource}
          actions={actions}
          onClose={() => setBrowseSource(null)}
          thumbnailBaseUrl={`${API_BASE_URL}/video/projects/${encodeURIComponent(
            project.id,
          )}/linked-assets`}
        />
      ) : null}
    </section>
  );
}

function LinkedSourceRow({
  source,
  onBrowse,
  onSync,
  onRemove,
}: {
  source: VideoLinkedSource;
  onBrowse: () => void;
  onSync: () => void;
  onRemove: () => void;
}) {
  const { t } = useLanguage();
  return (
    <div className="border-border rounded-md border px-3 py-2 text-xs">
      <div className="flex items-center gap-2">
        <Database className="text-muted-foreground size-4" />
        <span className="text-foreground min-w-0 flex-1 truncate">
          {source.displayName}
        </span>
        <span className="text-muted-foreground">
          {stateLabel(t, source.index.state)}
        </span>
      </div>
      <div className="text-muted-foreground mt-1 flex items-center gap-2">
        <span>{providerLabel(t, source.provider)}</span>
        <span>{roleLabel(t, source.role)}</span>
        <span>
          {t.video.editor.linkedFolder.budget.filesUsed.replace(
            '{count}',
            String(source.index.fileCount ?? 0),
          )}
        </span>
      </div>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={onBrowse}
          className="border-border hover:bg-accent rounded-md border px-2 py-1"
        >
          {t.video.editor.linkedFolder.action.browse}
        </button>
        <button
          type="button"
          onClick={onSync}
          className="border-border hover:bg-accent rounded-md border px-2 py-1"
        >
          <RefreshCw className="mr-1 inline size-3" />
          {t.video.editor.linkedFolder.action.sync}
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="border-border hover:bg-accent rounded-md border px-2 py-1"
          aria-label={t.video.editor.linkedFolder.action.remove}
        >
          <Trash2 className="size-3" />
        </button>
      </div>
      {source.index.error ? (
        <p className="text-destructive mt-2">{source.index.error}</p>
      ) : null}
    </div>
  );
}

export async function pickLocalFolder(title: string): Promise<string | null> {
  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const result = await open({ directory: true, multiple: false, title });
    return typeof result === 'string' ? result : null;
  }
  // Web build: spawn the OS-native folder picker via the local API server,
  // which returns a real path the indexer can read. Only if the platform has
  // no native dialog do we fall back to a manual path prompt.
  //
  // A *failed* request must not land in that fallback: `window.prompt` blocks
  // the renderer outright, so a transient API error would freeze the whole app
  // behind a bare browser prompt instead of failing one action. Let the error
  // reach the caller, which reports it as a toast.
  const native = await openNativeFolderDialog();
  if (native.supported) return native.path;
  return window.prompt(title);
}

export function lastPathSegment(input: string): string {
  const parts = input.replace(/[/\\]+$/, '').split(/[/\\]/);
  return parts.at(-1) || input;
}

function providerLabel(
  t: ReturnType<typeof useLanguage>['t'],
  provider: VideoLinkedSourceProvider,
): string {
  if (provider === 'local-fs') return t.video.editor.linkedFolder.add.local;
  if (provider === 'google-drive') {
    return t.video.editor.linkedFolder.add.googleDrive;
  }
  return t.video.editor.linkedFolder.add[provider];
}

function roleLabel(
  t: ReturnType<typeof useLanguage>['t'],
  role: VideoLinkedSourceRole,
): string {
  if (role === 'b-roll') return t.video.editor.linkedFolder.role.bRoll.label;
  return t.video.editor.linkedFolder.role[role].label;
}

function stateLabel(
  t: ReturnType<typeof useLanguage>['t'],
  state: VideoLinkedSource['index']['state'],
): string {
  return t.video.editor.linkedFolder.indexState[state];
}
