import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { VideoProject } from '@/shared/types/video';

type ProjectAsset = VideoProject['assets'][number];

interface UseAgentAssetContextInput {
  assets: VideoProject['assets'];
  onActivateAgent: () => void;
}

export function useAgentAssetContext({
  assets,
  onActivateAgent,
}: UseAgentAssetContextInput) {
  const [assetContextIds, setAssetContextIds] = useState<string[]>([]);
  const assetContextIdsRef = useRef(assetContextIds);

  useEffect(() => {
    assetContextIdsRef.current = assetContextIds;
  }, [assetContextIds]);

  const assetContextAssets = useMemo(
    () =>
      assetContextIds.flatMap((assetId) => {
        const asset = assets.find((candidate) => candidate.id === assetId);
        return asset ? [asset] : [];
      }),
    [assetContextIds, assets],
  );

  useEffect(() => {
    const assetIds = new Set(assets.map((asset) => asset.id));
    setAssetContextIds((current) => {
      const next = current.filter((assetId) => assetIds.has(assetId));
      return next.length === current.length ? current : next;
    });
  }, [assets]);

  const toggleAssetContext = useCallback(
    (asset: ProjectAsset) => {
      const selected = assetContextIdsRef.current.includes(asset.id);
      setAssetContextIds((current) =>
        current.includes(asset.id)
          ? current.filter((assetId) => assetId !== asset.id)
          : [...current, asset.id],
      );
      if (!selected) onActivateAgent();
    },
    [onActivateAgent],
  );

  const addAssetContext = useCallback(
    (assetId: string) => {
      const selected = assetContextIdsRef.current.includes(assetId);
      setAssetContextIds((current) =>
        current.includes(assetId) ? current : [...current, assetId],
      );
      if (!selected) onActivateAgent();
    },
    [onActivateAgent],
  );

  const removeAssetContext = useCallback((assetId: string) => {
    setAssetContextIds((current) =>
      current.filter((currentAssetId) => currentAssetId !== assetId),
    );
  }, []);

  const clearAssetContext = useCallback(() => {
    setAssetContextIds([]);
  }, []);

  return {
    assetContextIds,
    assetContextAssets,
    addAssetContext,
    toggleAssetContext,
    removeAssetContext,
    clearAssetContext,
  };
}
