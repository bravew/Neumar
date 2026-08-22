import { API_BASE_URL } from '@/config';

import type {
  Asset,
  AssetKindFilter,
  AssetPage,
  AssetQueryState,
  AssetSearchHit,
  AssetSourceFilter,
  AssetStorageStats,
} from './types';

// Backstop for the native folder picker: 30s past the server's own 120s
// osascript/zenity timeout.
const NATIVE_FOLDER_DIALOG_TIMEOUT_MS = 150_000;

export interface AssetListResult {
  assets: Asset[];
  nextCursor: string | null;
}

export function assetThumbUrl(id: string): string {
  return `${API_BASE_URL}/assets/${encodeURIComponent(id)}/thumb`;
}

// Resolve a renderable thumbnail URL for an asset, falling back to the cloud
// provider's thumbnail proxy when the local catalog has no derivative yet.
// Cloud-synced assets (Immich, Box, Drive, …) carry a
// `provenance.thumbnailUrl` sentinel like `immich-thumbnail:<itemId>` which
// the cloud-storage thumbnail endpoint knows how to resolve.
export function resolveAssetThumbUrl(asset: Asset): string | null {
  if (asset.thumbPath) return assetThumbUrl(asset.id);
  const provenance = asset.provenance as
    | { thumbnailUrl?: string }
    | undefined
    | null;
  const sentinel = provenance?.thumbnailUrl;
  if (typeof sentinel !== 'string' || !asset.connectionId) return null;
  const match = /^[\w-]+-thumbnail:(.+)$/.exec(sentinel);
  if (!match) return sentinel.startsWith('http') ? sentinel : null;
  const itemId = match[1];
  return `${API_BASE_URL}/cloud-storage/connections/${encodeURIComponent(
    asset.connectionId,
  )}/items/${encodeURIComponent(itemId)}/thumbnail`;
}

export function assetPreviewUrl(id: string): string {
  return `${API_BASE_URL}/assets/${encodeURIComponent(id)}/preview`;
}

export function assetRawUrl(id: string): string {
  return `${API_BASE_URL}/assets/${encodeURIComponent(id)}/raw`;
}

export async function fetchAsset(
  id: string,
  options: { signal?: AbortSignal } = {},
): Promise<Asset> {
  const response = await fetch(
    `${API_BASE_URL}/assets/${encodeURIComponent(id)}`,
    { signal: options.signal },
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = (await response.json()) as { asset?: Asset };
  if (!body.asset) throw new Error('Asset not found');
  return body.asset;
}

export async function fetchAssets(
  query: AssetQueryState,
  options: { cursor?: string | null; signal?: AbortSignal } = {},
): Promise<AssetListResult> {
  const params = new URLSearchParams();
  if (query.q.trim()) params.set('q', query.q.trim());
  appendFilter(params, 'kind', query.kind);
  appendFilter(params, 'source', query.source);
  if (query.tags.trim()) params.set('tags', query.tags.trim());
  if (query.from) params.set('from', query.from);
  if (query.to) params.set('to', query.to);
  if (query.semantic) params.set('semantic', 'true');
  if (options.cursor) params.set('cursor', options.cursor);

  // Always go through `/assets/search` — even with no text it lets the
  // backend fan out to live cloud connectors when a single cloud source is
  // selected (e.g. `?source=box`). The local registry path is still hit
  // automatically when no remote source matches.
  const endpoint = '/assets/search';
  const response = await fetch(`${API_BASE_URL}${endpoint}?${params}`, {
    signal: options.signal,
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = (await response.json()) as
    | AssetPage<Asset>
    | AssetPage<AssetSearchHit>;
  return {
    assets: body.items.map((item) => ('asset' in item ? item.asset : item)),
    nextCursor: body.nextCursor ?? null,
  };
}

// Ask the local API server to spawn the OS-native folder picker (for the web
// build, which has no usable in-browser directory picker that yields a
// server-readable path). Returns `supported: false` when the platform has no
// native dialog, so the caller can fall back to manual path entry.
export async function openNativeFolderDialog(): Promise<{
  supported: boolean;
  path: string | null;
}> {
  // The server kills the OS picker after 120s, so anything past that means the
  // request never reached it (a saturated connection pool does exactly this).
  // Without the cap the caller waits forever with its button stuck disabled.
  const timeout = AbortSignal.timeout(NATIVE_FOLDER_DIALOG_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/assets/native-folder-dialog`, {
      method: 'POST',
      signal: timeout,
    });
  } catch (error) {
    if (timeout.aborted) throw new Error('Folder picker did not respond');
    throw error;
  }
  if (response.status === 501) return { supported: false, path: null };
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = (await response.json()) as { path: string | null };
  return { supported: true, path: body.path ?? null };
}

export async function deleteAsset(id: string): Promise<void> {
  const response = await fetch(
    `${API_BASE_URL}/assets/${encodeURIComponent(id)}`,
    {
      method: 'DELETE',
    },
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
}

export async function fetchAssetStorageStats(
  options: { signal?: AbortSignal } = {},
): Promise<AssetStorageStats> {
  const response = await fetch(`${API_BASE_URL}/assets/stats/storage`, {
    signal: options.signal,
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()) as AssetStorageStats;
}

function appendFilter(
  params: URLSearchParams,
  key: string,
  value: AssetKindFilter | AssetSourceFilter,
): void {
  if (value !== 'all') params.set(key, value);
}
