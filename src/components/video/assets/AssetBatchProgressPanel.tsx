import { useMemo } from 'react';

import { AlertCircle, CloudDownload, RotateCw, X } from 'lucide-react';

import type { MaterializationStateMap } from '@/shared/hooks/useAssetMaterializationEvents';
import { useLanguage } from '@/shared/providers/language-provider';
import type { VideoProject } from '@/shared/types/video';

import type { ProjectAssetBadgeActions } from './projectAssetMaterializationBadge';
import { projectAssetDisplayName } from './projectAssetMedia';

type ProjectAsset = VideoProject['assets'][number];

interface ActiveMaterialization {
  assetId: string;
  name: string;
  status: 'started' | 'progress' | 'error';
  percent: number | null;
  message: string | null;
  // Only catalog-hydration items support cancel/retry — those wire to
  // `cancelProjectAssetHydration`/`hydrateProjectAsset`, which is the wrong
  // call for a locally-attached asset's proxy encode (no in-flight download
  // to cancel; a failed retry needs `regenerateAssetProxy` instead).
  isCatalogTracked: boolean;
}

const MAX_VISIBLE_ITEMS = 8;

interface AssetBatchProgressPanelProps {
  assets: ProjectAsset[];
  states: MaterializationStateMap;
  actions: ProjectAssetBadgeActions;
  // A local, non-SSE-tracked operation to headline while it runs (e.g. a
  // folder crawl/attach batch, which has no per-file backend progress feed).
  // Takes over the headline slot; the SSE-derived item list still renders
  // underneath if there's anything active there too.
  localTask?: { label: string } | null;
}

/**
 * Floating summary of every in-flight asset hydration for the project,
 * derived from the same SSE map that already drives the per-tile badges
 * (`projectAssetMaterializationBadge`). Batch adds (a folder, a multi-select
 * catalog attach) previously had no feedback beyond those small per-tile
 * rings, which are easy to miss once the list scrolls — this surfaces one
 * persistent "N processing / needs attention" readout regardless of scroll
 * position or which rail section is open.
 */
export function AssetBatchProgressPanel({
  assets,
  states,
  actions,
  localTask,
}: AssetBatchProgressPanelProps) {
  const { t } = useLanguage();
  const assetLabels = t.assets;
  const labels = t.video.editor.assetsRail.batchProgress;
  const items = useMemo(
    () => collectActiveMaterializations(assets, states),
    [assets, states],
  );

  if (items.length === 0 && !localTask) return null;

  const activeItems = items.filter((item) => item.status !== 'error');
  const erroredItems = items.filter((item) => item.status === 'error');
  const knownPercents = activeItems
    .map((item) => item.percent)
    .filter((percent): percent is number => typeof percent === 'number');
  const overallPercent =
    knownPercents.length > 0
      ? Math.round(
          knownPercents.reduce((sum, percent) => sum + percent, 0) /
            knownPercents.length,
        )
      : null;
  const headline = localTask
    ? localTask.label
    : activeItems.length > 0
      ? labels.processing
          .replace('{count}', String(activeItems.length))
          .replace('{percent}', String(overallPercent ?? 0))
      : labels.attention.replace('{count}', String(erroredItems.length));
  const visible = items.slice(0, MAX_VISIBLE_ITEMS);
  const hiddenCount = items.length - visible.length;

  return (
    <div
      role="status"
      aria-live="polite"
      className="border-border bg-background/95 fixed right-4 bottom-4 z-50 w-72 space-y-1.5 rounded-lg border p-2.5 text-xs shadow-lg backdrop-blur"
    >
      <div className="text-foreground flex items-center gap-1.5 font-medium">
        <CloudDownload
          className={
            localTask || activeItems.length > 0
              ? 'size-3.5 animate-pulse'
              : 'size-3.5'
          }
          aria-hidden
        />
        <span className="min-w-0 truncate">{headline}</span>
      </div>
      <ul className="max-h-40 space-y-1 overflow-y-auto">
        {visible.map((item) => (
          <li key={item.assetId} className="flex items-center gap-1.5">
            {item.status === 'error' ? (
              <AlertCircle
                className="text-destructive size-3 shrink-0"
                aria-hidden
              />
            ) : (
              <CloudDownload
                className="text-muted-foreground size-3 shrink-0"
                aria-hidden
              />
            )}
            <span
              className="text-foreground min-w-0 flex-1 truncate"
              title={item.name}
            >
              {item.name}
            </span>
            {item.status === 'error' ? (
              item.isCatalogTracked ? (
                <button
                  type="button"
                  onClick={() => actions.onRetry?.(item.assetId)}
                  aria-label={assetLabels.retryDownload}
                  title={item.message ?? assetLabels.retryDownload}
                  className="text-muted-foreground hover:text-foreground shrink-0"
                >
                  <RotateCw className="size-3" aria-hidden />
                </button>
              ) : null
            ) : (
              <>
                <span className="text-muted-foreground shrink-0 tabular-nums">
                  {typeof item.percent === 'number'
                    ? `${Math.round(item.percent)}%`
                    : '…'}
                </span>
                {item.isCatalogTracked ? (
                  <button
                    type="button"
                    onClick={() => actions.onCancel?.(item.assetId)}
                    aria-label={assetLabels.cancelDownload}
                    title={assetLabels.cancelDownload}
                    className="text-muted-foreground hover:text-destructive shrink-0"
                  >
                    <X className="size-3" aria-hidden />
                  </button>
                ) : null}
              </>
            )}
          </li>
        ))}
      </ul>
      {hiddenCount > 0 ? (
        <p className="text-muted-foreground">
          {labels.more.replace('{count}', String(hiddenCount))}
        </p>
      ) : null}
    </div>
  );
}

function collectActiveMaterializations(
  assets: ProjectAsset[],
  states: MaterializationStateMap,
): ActiveMaterialization[] {
  const items: ActiveMaterialization[] = [];
  for (const asset of assets) {
    // Falls back to the project asset id for locally-attached assets, whose
    // proxy-generation events have no catalog id to key off — see the same
    // fallback in `projectAssetMaterializationBadge`.
    const catalogAssetId = asset.provenance?.catalogAssetId;
    const state = states[catalogAssetId ?? asset.id];
    if (!state) continue;
    if (
      state.status !== 'started' &&
      state.status !== 'progress' &&
      state.status !== 'error'
    ) {
      continue;
    }
    items.push({
      assetId: asset.id,
      name: projectAssetDisplayName(asset),
      status: state.status,
      percent: state.percent,
      message: state.message,
      isCatalogTracked: Boolean(catalogAssetId),
    });
  }
  // Surface errors first — they need a decision, active downloads don't.
  return items.sort(
    (a, b) => Number(a.status !== 'error') - Number(b.status !== 'error'),
  );
}
