import { useState } from 'react';

import type { DownloadItem } from '@neumar/video-ir';
import { AlertCircle, Check, CircleSlash, Loader2 } from 'lucide-react';

import { formatFileSize } from '@/components/artifacts/utils';
import { API_BASE_URL } from '@/config';
import { useLanguage } from '@/shared/providers/language-provider';

/** m:ss for an ETA; non-finite values are shown as nothing. */
function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

function fill(template: string, values: Record<string, string | number>) {
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    String(values[key] ?? ''),
  );
}

type Transferring = Extract<DownloadItem, { phase: 'transferring' }>;

/**
 * Measured progress only when every stream reports a total (exact or
 * estimated). Separate audio and video streams are summed; one stream with an
 * unknown total makes the whole item indeterminate rather than a wrong percent.
 */
function measure(item: Transferring) {
  const done = item.streams.reduce((sum, s) => sum + s.bytes, 0);
  const totals = item.streams.map((s) => s.totalBytes ?? s.estimatedTotalBytes);
  const total = totals.every((value) => value !== undefined)
    ? totals.reduce<number>((sum, value) => sum + (value ?? 0), 0)
    : undefined;
  const exact = item.streams.every((s) => s.totalBytes !== undefined);
  const rate = item.streams.reduce(
    (sum, s) => sum + (s.bytesPerSecond ?? 0),
    0,
  );
  const etas = item.streams
    .map((s) => s.etaSeconds)
    .filter((eta): eta is number => eta !== undefined);
  return {
    done,
    total: total && total >= done ? total : undefined,
    exact,
    rate,
    eta: etas.length ? Math.max(...etas) : undefined,
  };
}

function Progress({ item, label }: { item: Transferring; label: string }) {
  const { t } = useLanguage();
  const m = measure(item);
  const details = [
    m.total === undefined
      ? fill(t.mediaDownload.progressUnknown, { done: formatFileSize(m.done) })
      : `${m.exact ? '' : '~'}${fill(t.mediaDownload.progressKnown, {
          done: formatFileSize(m.done),
          total: formatFileSize(m.total),
        })}`,
    m.rate > 0
      ? fill(t.mediaDownload.speed, { rate: formatFileSize(m.rate) })
      : null,
    m.eta !== undefined
      ? fill(t.mediaDownload.eta, { time: formatClock(m.eta) })
      : null,
  ].filter(Boolean);
  return (
    <div className="mt-1 flex items-center gap-2">
      {/* No value means indeterminate; the browser announces it as busy. */}
      <progress
        aria-label={label}
        className="h-1.5 min-w-0 flex-1"
        value={m.total === undefined ? undefined : m.done}
        max={m.total}
      />
      <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
        {details.join(' · ')}
      </span>
    </div>
  );
}

function Player({
  taskId,
  asset,
}: {
  taskId: string;
  asset: Extract<DownloadItem, { phase: 'saved' }>['asset'];
}) {
  const { t } = useLanguage();
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <p className="text-muted-foreground mt-2 text-xs">
        {t.mediaDownload.playerUnavailable}
      </p>
    );
  }
  return (
    <video
      controls
      preload="metadata"
      aria-label={asset.name}
      className="mt-2 max-h-80 w-full rounded-md bg-black"
      src={`${API_BASE_URL}/files/tasks/${encodeURIComponent(taskId)}/downloads/${encodeURIComponent(asset.assetId)}`}
      onError={() => setFailed(true)}
    />
  );
}

/** One video in a batch: its state, measured progress, and the player once saved. */
export function DownloadItemRow({
  taskId,
  item,
  index,
}: {
  taskId: string;
  item: DownloadItem;
  index: number;
}) {
  const { t } = useLanguage();
  const m = t.mediaDownload;
  const name =
    item.phase === 'saved'
      ? item.asset.name
      : fill(m.itemLabel, { n: index + 1 });
  const phaseLabel = {
    waiting: m.waiting,
    queued: m.queued,
    transferring: m.transferring,
    postprocessing: m.postprocessing,
    saved: m.saved,
    failed: m.failed,
    cancelled: m.cancelled,
  }[item.phase];
  const reason =
    item.phase === 'failed'
      ? {
          unavailable: m.reasonUnavailable,
          denied: m.reasonDenied,
          limit: m.reasonLimit,
          collision: m.reasonCollision,
          download: m.reasonDownload,
        }[item.reason]
      : null;

  return (
    <li className="py-2">
      <div className="flex items-center gap-2 text-sm">
        {item.phase === 'saved' ? (
          <Check className="size-3.5 shrink-0 text-emerald-500" aria-hidden />
        ) : item.phase === 'failed' ? (
          <AlertCircle
            className="text-destructive size-3.5 shrink-0"
            aria-hidden
          />
        ) : item.phase === 'cancelled' ? (
          <CircleSlash
            className="text-muted-foreground size-3.5 shrink-0"
            aria-hidden
          />
        ) : (
          <Loader2
            className="text-primary size-3.5 shrink-0 animate-spin motion-reduce:animate-none"
            aria-hidden
          />
        )}
        <span className="text-foreground min-w-0 flex-1 truncate font-medium">
          {name}
        </span>
        <span className="text-muted-foreground shrink-0 text-xs">
          {phaseLabel}
          {item.phase === 'saved'
            ? ` · ${formatFileSize(item.asset.size)}`
            : ''}
        </span>
      </div>
      {item.phase === 'transferring' && <Progress item={item} label={name} />}
      {reason && <p className="text-destructive mt-1 text-xs">{reason}</p>}
      {item.phase === 'saved' && (
        <Player key={item.asset.assetId} taskId={taskId} asset={item.asset} />
      )}
    </li>
  );
}
