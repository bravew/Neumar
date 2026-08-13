import { useCallback, useState } from 'react';

import { assetRawUrl, fetchAsset } from '@/shared/assets/api';
import type { Asset } from '@/shared/assets/types';
import type { AttachmentSourceContext } from '@/shared/hooks/useAgent';

interface UseAssetCatalogAttachmentOptions {
  addFiles: (
    files: File[] | FileList,
    forceImage?: boolean,
    sourceContexts?: AttachmentSourceContext[],
  ) => Promise<void>;
}

export function useAssetCatalogAttachment({
  addFiles,
}: UseAssetCatalogAttachmentOptions) {
  const [assetCatalogOpen, setAssetCatalogOpen] = useState(false);

  const handleAssetCatalogSelect = useCallback(
    async (assetIds: string[]) => {
      const files: File[] = [];
      const sourceContexts: AttachmentSourceContext[] = [];

      for (const assetId of assetIds) {
        const asset = await fetchAsset(assetId);
        const response = await fetch(assetRawUrl(assetId));
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const blob = await response.blob();
        files.push(
          new File([blob], catalogAssetFileName(asset), {
            type: asset.mime || blob.type || 'application/octet-stream',
          }),
        );
        sourceContexts.push({
          kind: 'asset-catalog',
          assetId: asset.id,
          assetTitle: asset.title ?? undefined,
          assetSource: asset.source,
          sourceId: asset.sourceId ?? undefined,
          storagePath: asset.storagePath ?? undefined,
        });
      }

      if (files.length === 0) return;
      await addFiles(
        files,
        files.every((file) => file.type.startsWith('image/')),
        sourceContexts,
      );
    },
    [addFiles],
  );

  return {
    assetCatalogOpen,
    setAssetCatalogOpen,
    handleAssetCatalogSelect,
  };
}

function catalogAssetFileName(asset: Asset): string {
  const candidate =
    asset.title ?? asset.storagePath ?? asset.sourceId ?? asset.id;
  const base = lastPathSegment(candidate).replaceAll('\u0000', '_').trim();
  if (/\.[A-Za-z0-9]{2,8}$/.test(base)) return base;
  const ext = extensionFromMime(asset.mime);
  return ext ? `${base || asset.id}.${ext}` : base || asset.id;
}

function lastPathSegment(value: string): string {
  const index = Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\'));
  return index >= 0 ? value.slice(index + 1) : value;
}

function extensionFromMime(mime: string): string {
  const map: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/svg+xml': 'svg',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'audio/mpeg': 'mp3',
    'audio/wav': 'wav',
    'application/pdf': 'pdf',
    'text/plain': 'txt',
    'text/markdown': 'md',
  };
  return map[mime.toLowerCase()] ?? '';
}
