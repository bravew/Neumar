import type { VividOverlaySourceAsset } from '@neumar/video-ir';

import { API_BASE_URL } from '@/config';

import { importedOverlayAssetUrl } from '../../overlays/useImportedOverlays';
import type { OverlayAssetLoader } from './vividOverlayPreviewModel';

// Loads project asset bytes for gif overlay documents (which must embed them
// — the overlay CSP blocks all network from inside the document). Cached per
// asset id; results are base64 for direct embedding.

const MAX_OVERLAY_ASSET_BYTES = 15 * 1024 * 1024;

export function createOverlayAssetLoader(
  projectId: string,
): OverlayAssetLoader {
  const cache = new Map<string, Promise<VividOverlaySourceAsset | null>>();
  return (assetId: string) => {
    let pending = cache.get(assetId);
    if (!pending) {
      pending = fetchAsset(projectId, assetId);
      cache.set(assetId, pending);
    }
    return pending;
  };
}

async function fetchAsset(
  projectId: string,
  assetId: string,
): Promise<VividOverlaySourceAsset | null> {
  try {
    const response = await fetch(
      assetId.startsWith('import:')
        ? importedOverlayAssetUrl(assetId)
        : `${API_BASE_URL}/video/projects/${encodeURIComponent(
            projectId,
          )}/assets/${encodeURIComponent(assetId)}/stream`,
    );
    if (!response.ok) return null;
    const buffer = await response.arrayBuffer();
    if (
      buffer.byteLength === 0 ||
      buffer.byteLength > MAX_OVERLAY_ASSET_BYTES
    ) {
      return null;
    }
    return {
      base64: arrayBufferToBase64(buffer),
      mimeType: response.headers.get('content-type') ?? undefined,
    };
  } catch {
    return null;
  }
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}
