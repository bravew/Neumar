import { useEffect, useRef, useState } from 'react';

import type { VideoProject } from '@/shared/types/video';

type ProjectAsset = VideoProject['assets'][number];

const NEW_HIGHLIGHT_MS = 6000;

/**
 * Tracks asset IDs added since the section first mounted, so newly generated
 * assets render with a short "New" pulse.
 */
export function useNewAssetTracker(assets: ProjectAsset[]): Set<string> {
  const seenRef = useRef<Set<string> | null>(null);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );
  const [highlighted, setHighlighted] = useState<Set<string>>(() => new Set());

  if (seenRef.current === null) {
    seenRef.current = new Set(assets.map((a) => a.id));
  }

  useEffect(() => {
    const seen = seenRef.current;
    if (!seen) return;
    const fresh: string[] = [];
    for (const asset of assets) {
      if (seen.has(asset.id)) continue;
      seen.add(asset.id);
      fresh.push(asset.id);
      const timer = setTimeout(() => {
        setHighlighted((prev) => {
          if (!prev.has(asset.id)) return prev;
          const updated = new Set(prev);
          updated.delete(asset.id);
          return updated;
        });
        timersRef.current.delete(asset.id);
      }, NEW_HIGHLIGHT_MS);
      timersRef.current.set(asset.id, timer);
    }
    if (fresh.length > 0) {
      setHighlighted((prev) => {
        const updated = new Set(prev);
        for (const id of fresh) updated.add(id);
        return updated;
      });
    }
  }, [assets]);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  return highlighted;
}
