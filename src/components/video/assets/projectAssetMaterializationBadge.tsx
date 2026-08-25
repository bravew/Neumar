import type { MouseEvent, ReactNode } from 'react';

import { AlertCircle, CloudDownload, RotateCw, X } from 'lucide-react';

import type { MaterializationStateMap } from '@/shared/hooks/useAssetMaterializationEvents';
import { cn } from '@/shared/lib/utils';
import type { VideoProject } from '@/shared/types/video';

type ProjectAsset = VideoProject['assets'][number];

export interface ProjectAssetBadgeLabels {
  materializePreparing: string;
  materializeFailed: string;
  cancelDownload: string;
  retryDownload: string;
}

export interface ProjectAssetBadgeActions {
  // Cancel the in-flight hydration for `asset.id`. Called from the X
  // button revealed on hover of the progress ring.
  onCancel?: (mediaItemId: string) => void;
  // Re-trigger hydration for `asset.id`. Called from the retry chip
  // shown over the error / cancelled state.
  onRetry?: (mediaItemId: string) => void;
}

// Build the tiny corner badge shown on the thumbnail when an asset is
// currently materializing. The catalog-side SSE feed is keyed on the
// catalog asset id (persisted on `provenance.catalogAssetId` by
// `attachCatalogAssetToProject`), so we map back through it to find the
// in-flight state. Returns `null` for assets that have no catalog link or
// whose state has already settled.
export function projectAssetMaterializationBadge(
  asset: ProjectAsset,
  states: MaterializationStateMap | undefined,
  labels: ProjectAssetBadgeLabels,
  actions: ProjectAssetBadgeActions = {},
): ReactNode {
  const catalogAssetId = asset.provenance?.catalogAssetId;
  // Locally-attached assets (linked-source or direct-path) have no catalog
  // id — their proxy-generation lifecycle events are published keyed by the
  // project asset id itself instead. Cancel/retry stay catalog-only below:
  // those actions call `cancelProjectAssetHydration`/`hydrateProjectAsset`,
  // which is the wrong endpoint for a local proxy encode (there's no
  // in-flight download to cancel, and retrying means
  // `regenerateAssetProxy`, not re-hydrating).
  const liveState = states?.[catalogAssetId ?? asset.id];
  const handleCancel =
    catalogAssetId && actions.onCancel
      ? (event: MouseEvent) => {
          event.stopPropagation();
          event.preventDefault();
          actions.onCancel?.(asset.id);
        }
      : undefined;
  const handleRetry =
    catalogAssetId && actions.onRetry
      ? (event: MouseEvent) => {
          event.stopPropagation();
          event.preventDefault();
          actions.onRetry?.(asset.id);
        }
      : undefined;

  // Live SSE state from an in-flight hydration wins over the persisted
  // lifecycle field — it has the up-to-the-second progress percent.
  if (liveState?.status === 'started') {
    return (
      <BadgeRing
        label={labels.materializePreparing}
        percent={null}
        cancelLabel={labels.cancelDownload}
        onCancel={handleCancel}
      />
    );
  }
  if (liveState?.status === 'progress') {
    return (
      <BadgeRing
        label={labels.materializePreparing}
        percent={liveState.percent}
        cancelLabel={labels.cancelDownload}
        onCancel={handleCancel}
      />
    );
  }
  if (liveState?.status === 'error') {
    const message = liveState.message ?? '';
    return (
      <ErrorBadge
        tooltip={labels.materializeFailed.replace('{message}', message)}
        retryLabel={labels.retryDownload}
        onRetry={handleRetry}
      />
    );
  }
  if (liveState?.status === 'cancelled') {
    return (
      <ErrorBadge
        // Cancelled is a quieter state than a hard error; keep the same
        // icon family but the retry chip is the primary affordance.
        tooltip={labels.retryDownload}
        retryLabel={labels.retryDownload}
        onRetry={handleRetry}
        tone="muted"
      />
    );
  }
  // No live SSE state — fall back to the persisted lifecycle field. A
  // freshly attached reference asset that has never been hydrated shows
  // the static cloud badge so the user can tell it lives "in the cloud"
  // until something (drop-on-timeline / agent / render preflight) fires
  // a fetch.
  if (asset.materializationState === 'referenced') {
    return (
      <BadgeRing
        label={labels.materializePreparing}
        percent={null}
        cancelLabel={labels.cancelDownload}
        onCancel={undefined}
      />
    );
  }
  if (asset.materializationState === 'error') {
    return (
      <ErrorBadge
        tooltip={labels.materializeFailed.replace('{message}', '')}
        retryLabel={labels.retryDownload}
        onRetry={handleRetry}
      />
    );
  }
  return null;
}

function BadgeRing({
  label,
  percent,
  cancelLabel,
  onCancel,
}: {
  label: string;
  percent: number | null;
  cancelLabel: string;
  onCancel?: (event: MouseEvent) => void;
}) {
  const clamped =
    percent === null ? null : Math.max(0, Math.min(100, Math.round(percent)));
  return (
    <span
      className="bg-background/90 text-foreground group/badge absolute top-0.5 right-0.5 inline-flex items-center gap-0.5 rounded-full px-1 py-px text-[8px] leading-none font-semibold shadow-sm"
      title={label}
    >
      <CloudDownload className="size-2.5 animate-pulse" aria-hidden />
      {clamped === null ? null : (
        <span className="tabular-nums">{clamped}%</span>
      )}
      {onCancel ? (
        <button
          type="button"
          onClick={onCancel}
          aria-label={cancelLabel}
          title={cancelLabel}
          className="text-muted-foreground hover:text-destructive ml-0.5 hidden group-hover/badge:inline-flex"
        >
          <X className="size-2.5" aria-hidden />
        </button>
      ) : null}
    </span>
  );
}

function ErrorBadge({
  tooltip,
  retryLabel,
  onRetry,
  tone = 'destructive',
}: {
  tooltip: string;
  retryLabel: string;
  onRetry?: (event: MouseEvent) => void;
  tone?: 'destructive' | 'muted';
}) {
  const palette =
    tone === 'destructive'
      ? 'bg-destructive text-destructive-foreground'
      : 'bg-muted text-muted-foreground';
  return (
    <span
      className={cn(
        'group/badge absolute top-0.5 right-0.5 inline-flex items-center gap-0.5 rounded-full px-1 py-px text-[8px] leading-none font-semibold shadow-sm',
        palette,
      )}
      title={tooltip}
    >
      <AlertCircle className="size-2.5" aria-hidden />
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          aria-label={retryLabel}
          title={retryLabel}
          className="ml-0.5 inline-flex"
        >
          <RotateCw className="size-2.5" aria-hidden />
        </button>
      ) : null}
    </span>
  );
}
