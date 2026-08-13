import { useCallback, useEffect, useState } from 'react';

import { Image, Paperclip, Search, X } from 'lucide-react';

import { useLanguage } from '@/shared/providers/language-provider';
import type {
  VideoLinkedAsset,
  VideoLinkedAssetKind,
  VideoLinkedAssetSearchHit,
  VideoLinkedSource,
  VideoLinkedSourceRole,
  VideoProject,
} from '@/shared/types/video';

import type { VideoProjectEditorActions } from './editorTypes';
import { writeLinkedAssetDrag } from './linkedAssetDrag';

interface LinkedAssetsBrowserProps {
  project: VideoProject;
  source?: VideoLinkedSource;
  actions: VideoProjectEditorActions;
  thumbnailBaseUrl: string;
  initialQuery?: string;
  initialSceneId?: string;
  initialKind?: Exclude<VideoLinkedAssetKind, 'other'>;
  role?: VideoLinkedSourceRole;
  sourceIds?: string[];
  onClose: () => void;
}

export function LinkedAssetsBrowser({
  project,
  source,
  actions,
  thumbnailBaseUrl,
  initialQuery = '',
  initialSceneId = '',
  initialKind,
  role,
  sourceIds,
  onClose,
}: LinkedAssetsBrowserProps) {
  const { t } = useLanguage();
  const [query, setQuery] = useState(initialQuery);
  const [kind, setKind] = useState<Exclude<VideoLinkedAssetKind, 'other'> | ''>(
    initialKind ?? '',
  );
  const [sceneId, setSceneId] = useState(initialSceneId);
  const [hits, setHits] = useState<VideoLinkedAssetSearchHit[]>([]);
  const [loading, setLoading] = useState(true);
  const [attachingId, setAttachingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      try {
        const trimmed = query.trim();
        const data =
          trimmed || !source
            ? await actions.searchLinkedAssets(
                {
                  query: trimmed,
                  kind: kind || undefined,
                  role: role ?? source?.role,
                  sourceIds: source ? [source.id] : sourceIds,
                  limit: 60,
                },
                signal,
              )
            : await actions.listLinkedAssets(
                { sourceId: source.id, kind: kind || undefined, limit: 60 },
                signal,
              );
        if (!signal?.aborted) {
          setHits(
            'results' in data
              ? data.results
              : data.assets.map((asset) => ({
                  asset,
                  score: 1,
                  matchedOn: 'metadata' as const,
                  thumbnailUrl: asset.thumbnailCachePath
                    ? `${thumbnailBaseUrl}/${encodeURIComponent(asset.id)}/thumbnail`
                    : '',
                })),
          );
          setError(null);
        }
      } catch (err) {
        if (!signal?.aborted) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [actions, kind, query, role, source, sourceIds, thumbnailBaseUrl],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const attach = async (assetId: string) => {
    setAttachingId(assetId);
    setError(null);
    try {
      await actions.attachLinkedAsset(assetId, sceneId || undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAttachingId(null);
    }
  };

  return (
    <div className="border-border bg-background fixed inset-y-4 right-4 z-40 flex w-[420px] max-w-[calc(100vw-2rem)] flex-col rounded-lg border shadow-xl">
      <div className="border-border flex items-center gap-2 border-b p-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-foreground truncate text-sm font-semibold">
            {source?.displayName ?? t.video.editor.linkedSearch.title}
          </h3>
          <p className="text-muted-foreground text-xs">
            {source
              ? t.video.editor.linkedFolder.action.browse
              : t.video.editor.linkedSearch.placeholder}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="hover:bg-accent rounded-md p-1.5"
          aria-label={t.video.editor.inspector.close}
        >
          <X className="size-4" />
        </button>
      </div>
      <div className="border-border space-y-2 border-b p-3">
        <div className="flex gap-2">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="border-input bg-background min-w-0 flex-1 rounded-md border px-3 py-2 text-xs"
            placeholder={t.video.editor.linkedSearch.placeholder}
          />
          <button
            type="button"
            className="border-border hover:bg-accent rounded-md border px-3 py-2 text-xs"
            onClick={() => void load()}
          >
            <Search className="size-4" />
          </button>
        </div>
        <select
          value={kind}
          onChange={(event) =>
            setKind(
              event.target.value as Exclude<VideoLinkedAssetKind, 'other'> | '',
            )
          }
          className="border-input bg-background w-full rounded-md border px-3 py-2 text-xs"
        >
          <option value="">{t.video.editor.linkedSearch.filter.kind}</option>
          <option value="image">
            {t.video.editor.linkedSearch.filter.image}
          </option>
          <option value="video">
            {t.video.editor.linkedSearch.filter.video}
          </option>
          <option value="audio">
            {t.video.editor.linkedSearch.filter.audio}
          </option>
        </select>
        <select
          value={sceneId}
          onChange={(event) => setSceneId(event.target.value)}
          className="border-input bg-background w-full rounded-md border px-3 py-2 text-xs"
        >
          <option value="">
            {t.video.editor.linkedFolder.attach.sceneTarget}
          </option>
          {(project.storyboard?.scenes ?? []).map((scene, index) => (
            <option key={scene.id} value={scene.id}>
              {t.video.storyboard.sceneLabel.replace(
                '{index}',
                String(index + 1),
              )}
            </option>
          ))}
        </select>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {loading ? (
          <p className="text-muted-foreground text-xs">
            {t.video.project.loading}
          </p>
        ) : null}
        {error ? <p className="text-destructive text-xs">{error}</p> : null}
        {!loading && hits.length === 0 ? (
          <p className="text-muted-foreground text-xs">
            {t.video.editor.linkedSearch.empty}
          </p>
        ) : null}
        <div className="grid grid-cols-2 gap-2">
          {hits.map((hit) => (
            <div
              key={hit.asset.id}
              className="border-border overflow-hidden rounded-md border text-xs"
              draggable={hit.asset.kind !== 'other'}
              onDragStart={(event) => {
                if (hit.asset.kind === 'other') return;
                writeLinkedAssetDrag(event.dataTransfer, {
                  assetId: hit.asset.id,
                  kind: hit.asset.kind,
                  name: hit.asset.name,
                  durationMs: hit.asset.durationMs,
                });
              }}
            >
              {hit.thumbnailUrl || hit.asset.thumbnailCachePath ? (
                <img
                  src={resolveThumbnailUrl(
                    hit.thumbnailUrl,
                    thumbnailBaseUrl,
                    hit.asset,
                  )}
                  alt=""
                  className="bg-muted h-24 w-full object-cover"
                />
              ) : (
                <div className="bg-muted text-muted-foreground flex h-24 items-center justify-center">
                  <Image className="size-5" />
                </div>
              )}
              <div className="space-y-2 p-2">
                <div className="flex items-center gap-2">
                  <div
                    className="text-foreground min-w-0 flex-1 truncate"
                    title={hit.asset.name}
                  >
                    {hit.asset.name}
                  </div>
                  <span
                    className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-[10px]"
                    title={t.video.editor.linkedSearch.score.tooltip.replace(
                      '{snippet}',
                      hit.matchSnippet ??
                        hit.asset.description ??
                        hit.asset.name,
                    )}
                  >
                    {Math.round(hit.score * 100)}
                  </span>
                </div>
                <div className="text-muted-foreground flex items-center justify-between">
                  <span>
                    {t.video.editor.linkedSearch.matchedOn[hit.matchedOn]}
                  </span>
                  <span>{formatBytes(hit.asset.sizeBytes ?? 0)}</span>
                </div>
                <button
                  type="button"
                  disabled={attachingId === hit.asset.id}
                  onClick={() => void attach(hit.asset.id)}
                  className="border-border hover:bg-accent w-full rounded-md border px-2 py-1 disabled:opacity-50"
                >
                  <Paperclip className="mr-1 inline size-3" />
                  {attachingId === hit.asset.id
                    ? t.video.editor.linkedFolder.attach.attaching
                    : t.video.editor.linkedFolder.attach.button}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function resolveThumbnailUrl(
  thumbnailUrl: string,
  thumbnailBaseUrl: string,
  asset: VideoLinkedAsset,
): string {
  if (thumbnailUrl) {
    if (thumbnailUrl.startsWith('http')) return thumbnailUrl;
    try {
      return `${new URL(thumbnailBaseUrl).origin}${thumbnailUrl}`;
    } catch {
      return thumbnailUrl;
    }
  }
  return `${thumbnailBaseUrl}/${encodeURIComponent(asset.id)}/thumbnail`;
}

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}
