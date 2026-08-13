import { useEffect, useMemo, useRef, useState } from 'react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { designBlobUrl, readDesignFile } from '@/shared/hooks/useDesignMode';
import { useLanguage } from '@/shared/providers/language-provider';
import type { DesignAssetVersion } from '@/shared/types/design-mode';

export function CompareModal({
  open,
  onOpenChange,
  projectId,
  left,
  right,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  left: DesignAssetVersion | null;
  right: DesignAssetVersion | null;
}) {
  const { t } = useLanguage();
  const [blend, setBlend] = useState(50);
  const [textPair, setTextPair] = useState<{
    left: string;
    right: string;
  } | null>(null);
  const canBlend = Boolean(
    left && right && isImagePath(left.path) && isImagePath(right.path),
  );
  const canTextDiff = Boolean(
    left && right && isTextPath(left.path) && isTextPath(right.path),
  );
  const canVideoSync = Boolean(
    left && right && isVideoPath(left.path) && isVideoPath(right.path),
  );
  const canAudioWaveform = Boolean(
    left && right && isAudioPath(left.path) && isAudioPath(right.path),
  );
  useEffect(() => {
    if (!open || !left || !right || !canTextDiff) {
      setTextPair(null);
      return;
    }
    let cancelled = false;
    Promise.all([
      readDesignFile(projectId, left.path),
      readDesignFile(projectId, right.path),
    ])
      .then(([leftFile, rightFile]) => {
        if (!cancelled) {
          setTextPair({
            left: leftFile.content,
            right: rightFile.content,
          });
        }
      })
      .catch(() => {
        if (!cancelled) setTextPair(null);
      });
    return () => {
      cancelled = true;
    };
  }, [canTextDiff, left, open, projectId, right]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t.design.compareTitle}</DialogTitle>
          <DialogDescription>{t.design.compareDescription}</DialogDescription>
        </DialogHeader>
        {canBlend && left && right && (
          <section className="rounded-md border p-3">
            <div className="bg-muted relative aspect-video overflow-hidden rounded-md">
              <img
                src={designBlobUrl(projectId, left.path)}
                alt=""
                className="absolute inset-0 h-full w-full object-contain"
              />
              <img
                src={designBlobUrl(projectId, right.path)}
                alt=""
                className="absolute inset-0 h-full w-full object-contain"
                style={{ opacity: blend / 100 }}
              />
            </div>
            <label className="text-muted-foreground mt-3 flex items-center gap-3 text-xs">
              A
              <input
                type="range"
                min={0}
                max={100}
                value={blend}
                onChange={(event) => setBlend(Number(event.target.value))}
                className="flex-1"
              />
              B
            </label>
          </section>
        )}
        {canTextDiff && textPair && (
          <TextDiff left={textPair.left} right={textPair.right} />
        )}
        {canVideoSync && left && right && (
          <VideoSyncCompare projectId={projectId} left={left} right={right} />
        )}
        {canAudioWaveform && left && right && (
          <AudioWaveformCompare
            projectId={projectId}
            left={left}
            right={right}
          />
        )}
        <div className="grid gap-3 md:grid-cols-2">
          <ComparePane
            projectId={projectId}
            label="A"
            version={left}
            hidePreview={canVideoSync || canAudioWaveform}
          />
          <ComparePane
            projectId={projectId}
            label="B"
            version={right}
            hidePreview={canVideoSync || canAudioWaveform}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ComparePane({
  projectId,
  label,
  version,
  hidePreview,
}: {
  projectId: string;
  label: string;
  version: DesignAssetVersion | null;
  hidePreview?: boolean;
}) {
  const { t } = useLanguage();
  return (
    <section className="rounded-md border p-3">
      <h3 className="text-sm font-medium">{label}</h3>
      {version ? (
        <>
          {!hidePreview && (
            <MediaPreview projectId={projectId} version={version} />
          )}
          <dl className="mt-3 space-y-2 text-sm">
            <div>
              <dt className="text-muted-foreground text-xs">
                {t.design.assetPath}
              </dt>
              <dd className="font-mono text-xs break-all">{version.path}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">
                {t.design.assetProvider}
              </dt>
              <dd>{version.provider ?? t.design.providerLocal}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">
                {t.design.assetModel}
              </dt>
              <dd>{version.model ?? t.design.modelAuto}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">
                {t.design.createdAt}
              </dt>
              <dd>{formatDate(version.createdAt)}</dd>
            </div>
          </dl>
        </>
      ) : (
        <p className="text-muted-foreground mt-3 text-sm">
          {t.design.noVersions}
        </p>
      )}
    </section>
  );
}

function VideoSyncCompare({
  projectId,
  left,
  right,
}: {
  projectId: string;
  left: DesignAssetVersion;
  right: DesignAssetVersion;
}) {
  const { t } = useLanguage();
  const leftRef = useRef<HTMLVideoElement | null>(null);
  const rightRef = useRef<HTMLVideoElement | null>(null);
  const [duration, setDuration] = useState(1);
  const [position, setPosition] = useState(0);
  const syncDuration = () => {
    const next = Math.max(
      leftRef.current?.duration || 0,
      rightRef.current?.duration || 0,
      1,
    );
    if (Number.isFinite(next)) setDuration(next);
  };
  const seek = (next: number) => {
    setPosition(next);
    if (leftRef.current) leftRef.current.currentTime = next;
    if (rightRef.current) rightRef.current.currentTime = next;
  };
  const updateFromVideo = (video: HTMLVideoElement | null) => {
    if (video && Number.isFinite(video.currentTime)) {
      setPosition(video.currentTime);
      const peer =
        video === leftRef.current ? rightRef.current : leftRef.current;
      if (
        peer &&
        Number.isFinite(peer.currentTime) &&
        Math.abs(peer.currentTime - video.currentTime) > 0.25
      ) {
        peer.currentTime = video.currentTime;
      }
    }
  };
  const syncPlayback = (playing: boolean, source: HTMLVideoElement | null) => {
    const videos = [leftRef.current, rightRef.current].filter(
      Boolean,
    ) as HTMLVideoElement[];
    if (playing) {
      if (source && Number.isFinite(source.currentTime)) {
        seek(source.currentTime);
      }
      videos.forEach((video) => {
        if (video !== source && video.paused) void video.play().catch(() => {});
      });
      return;
    }
    videos.forEach((video) => {
      if (!video.paused) video.pause();
    });
  };
  return (
    <section className="rounded-md border p-3">
      <h3 className="text-sm font-medium">{t.design.videoSyncCompare}</h3>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <video
          ref={leftRef}
          src={designBlobUrl(projectId, left.path)}
          className="bg-muted aspect-video w-full rounded-md"
          controls
          onLoadedMetadata={syncDuration}
          onTimeUpdate={() => updateFromVideo(leftRef.current)}
          onPlay={(event) => syncPlayback(true, event.currentTarget)}
          onPause={() => syncPlayback(false, null)}
          onSeeked={() => updateFromVideo(leftRef.current)}
        />
        <video
          ref={rightRef}
          src={designBlobUrl(projectId, right.path)}
          className="bg-muted aspect-video w-full rounded-md"
          controls
          onLoadedMetadata={syncDuration}
          onTimeUpdate={() => updateFromVideo(rightRef.current)}
          onPlay={(event) => syncPlayback(true, event.currentTarget)}
          onPause={() => syncPlayback(false, null)}
          onSeeked={() => updateFromVideo(rightRef.current)}
        />
      </div>
      <label className="text-muted-foreground mt-3 flex items-center gap-3 text-xs">
        {t.design.compareScrub}
        <input
          type="range"
          min={0}
          max={duration}
          step={0.05}
          value={Math.min(position, duration)}
          onChange={(event) => seek(Number(event.target.value))}
          className="flex-1"
        />
        {formatTime(position)}
      </label>
    </section>
  );
}

function AudioWaveformCompare({
  projectId,
  left,
  right,
}: {
  projectId: string;
  left: DesignAssetVersion;
  right: DesignAssetVersion;
}) {
  const { t } = useLanguage();
  return (
    <section className="rounded-md border p-3">
      <h3 className="text-sm font-medium">{t.design.audioWaveformCompare}</h3>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <WaveformPane
          label="A"
          src={designBlobUrl(projectId, left.path)}
          seed={left.path}
        />
        <WaveformPane
          label="B"
          src={designBlobUrl(projectId, right.path)}
          seed={right.path}
        />
      </div>
    </section>
  );
}

function WaveformPane({
  label,
  src,
  seed,
}: {
  label: string;
  src: string;
  seed: string;
}) {
  const [bars, setBars] = useState(() => waveformBars(seed));
  const [sourceKind, setSourceKind] = useState<'fallback' | 'decoded'>(
    'fallback',
  );
  useEffect(() => {
    let cancelled = false;
    setBars(waveformBars(seed));
    setSourceKind('fallback');
    decodeWaveformBars(src)
      .then((decoded) => {
        if (!cancelled && decoded.length > 0) {
          setBars(decoded);
          setSourceKind('decoded');
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [seed, src]);
  return (
    <div className="rounded-md border p-3">
      <p className="text-sm font-medium">{label}</p>
      <div
        role="img"
        aria-label={`${label} waveform`}
        data-waveform-source={sourceKind}
        className="bg-muted mt-3 flex h-20 items-center gap-0.5 rounded-md p-2"
      >
        {bars.map((height, index) => (
          <span
            key={index}
            className="bg-primary/70 min-w-1 flex-1 rounded-sm"
            style={{ height: `${height}%` }}
          />
        ))}
      </div>
      <audio src={src} className="mt-3 w-full" controls />
    </div>
  );
}

function TextDiff({ left, right }: { left: string; right: string }) {
  const { t } = useLanguage();
  const rows = useMemo(() => diffLines(left, right), [left, right]);
  return (
    <section className="rounded-md border p-3">
      <h3 className="text-sm font-medium">{t.design.textDiff}</h3>
      <div className="mt-3 max-h-80 overflow-auto rounded-md border font-mono text-xs">
        {rows.map((row, index) => (
          <div
            key={index}
            className={`grid grid-cols-[4rem_1fr_4rem_1fr] border-b last:border-b-0 ${
              row.kind === 'added'
                ? 'bg-emerald-500/10'
                : row.kind === 'removed'
                  ? 'bg-destructive/10'
                  : row.kind === 'changed'
                    ? 'bg-amber-500/10'
                    : ''
            }`}
          >
            <span className="text-muted-foreground border-r px-2 py-1 text-right">
              {row.leftNo ?? ''}
            </span>
            <pre className="min-w-0 overflow-x-auto border-r px-2 py-1 whitespace-pre">
              {row.leftText}
            </pre>
            <span className="text-muted-foreground border-r px-2 py-1 text-right">
              {row.rightNo ?? ''}
            </span>
            <pre className="min-w-0 overflow-x-auto px-2 py-1 whitespace-pre">
              {row.rightText}
            </pre>
          </div>
        ))}
      </div>
    </section>
  );
}

function MediaPreview({
  projectId,
  version,
}: {
  projectId: string;
  version: DesignAssetVersion;
}) {
  const src = designBlobUrl(projectId, version.path);
  if (isImagePath(version.path)) {
    return (
      <div className="bg-muted mt-3 flex aspect-video items-center justify-center overflow-hidden rounded-md">
        <img src={src} alt="" className="h-full w-full object-contain" />
      </div>
    );
  }
  if (isVideoPath(version.path)) {
    return (
      <video
        src={src}
        className="bg-muted mt-3 aspect-video w-full rounded-md"
        controls
      />
    );
  }
  if (isAudioPath(version.path)) {
    return <audio src={src} className="mt-3 w-full" controls />;
  }
  return null;
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function isImagePath(filePath: string) {
  return /\.(png|jpe?g|webp|gif|svg)$/i.test(filePath);
}

function isVideoPath(filePath: string) {
  return /\.(mp4|webm|mov)$/i.test(filePath);
}

function isAudioPath(filePath: string) {
  return /\.(mp3|wav|m4a|ogg)$/i.test(filePath);
}

function isTextPath(filePath: string) {
  return /\.(md|txt|html?|css|jsx?|tsx?|json|csv|xml|svg)$/i.test(filePath);
}

type DiffRow = {
  kind: 'same' | 'added' | 'removed' | 'changed';
  leftNo?: number;
  rightNo?: number;
  leftText: string;
  rightText: string;
};

function diffLines(left: string, right: string): DiffRow[] {
  const leftLines = splitLines(left);
  const rightLines = splitLines(right);
  if (leftLines.length * rightLines.length > 40_000) {
    return positionalDiff(leftLines, rightLines);
  }
  const dp = Array.from({ length: leftLines.length + 1 }, () =>
    Array<number>(rightLines.length + 1).fill(0),
  );
  for (let i = leftLines.length - 1; i >= 0; i -= 1) {
    for (let j = rightLines.length - 1; j >= 0; j -= 1) {
      dp[i]![j] =
        leftLines[i] === rightLines[j]
          ? dp[i + 1]![j + 1]! + 1
          : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }

  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < leftLines.length || j < rightLines.length) {
    if (
      i < leftLines.length &&
      j < rightLines.length &&
      leftLines[i] === rightLines[j]
    ) {
      rows.push({
        kind: 'same',
        leftNo: i + 1,
        rightNo: j + 1,
        leftText: leftLines[i]!,
        rightText: rightLines[j]!,
      });
      i += 1;
      j += 1;
    } else if (
      j < rightLines.length &&
      (i === leftLines.length || dp[i]![j + 1]! >= dp[i + 1]![j]!)
    ) {
      rows.push({
        kind: 'added',
        rightNo: j + 1,
        leftText: '',
        rightText: `+ ${rightLines[j]!}`,
      });
      j += 1;
    } else if (i < leftLines.length) {
      rows.push({
        kind: 'removed',
        leftNo: i + 1,
        leftText: `- ${leftLines[i]!}`,
        rightText: '',
      });
      i += 1;
    }
  }
  return rows;
}

function positionalDiff(leftLines: string[], rightLines: string[]): DiffRow[] {
  const length = Math.max(leftLines.length, rightLines.length);
  return Array.from({ length }, (_, index) => {
    const left = leftLines[index];
    const right = rightLines[index];
    if (left === right) {
      return {
        kind: 'same',
        leftNo: index + 1,
        rightNo: index + 1,
        leftText: left ?? '',
        rightText: right ?? '',
      };
    }
    return {
      kind:
        left === undefined
          ? 'added'
          : right === undefined
            ? 'removed'
            : 'changed',
      leftNo: left === undefined ? undefined : index + 1,
      rightNo: right === undefined ? undefined : index + 1,
      leftText: left === undefined ? '' : `- ${left}`,
      rightText: right === undefined ? '' : `+ ${right}`,
    };
  });
}

function splitLines(value: string) {
  return value.replace(/\n$/, '').split('\n');
}

function formatTime(value: number) {
  if (!Number.isFinite(value)) return '0:00';
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60)
    .toString()
    .padStart(2, '0');
  return `${minutes}:${seconds}`;
}

async function decodeWaveformBars(src: string, bucketCount = 48) {
  const AudioContextCtor =
    window.AudioContext ??
    (window as Window & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AudioContextCtor) return [];
  const response = await fetch(src);
  if (!response.ok) return [];
  const audioContext = new AudioContextCtor();
  try {
    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    return waveformBarsFromAudioBuffer(audioBuffer, bucketCount);
  } finally {
    await audioContext.close().catch(() => {});
  }
}

function waveformBarsFromAudioBuffer(
  audioBuffer: AudioBuffer,
  bucketCount: number,
) {
  const channels = Array.from(
    { length: audioBuffer.numberOfChannels },
    (_, index) => audioBuffer.getChannelData(index),
  );
  if (channels.length === 0 || audioBuffer.length === 0) return [];
  const values = Array.from({ length: bucketCount }, (_, index) => {
    const start = Math.floor((index / bucketCount) * audioBuffer.length);
    const end = Math.max(
      start + 1,
      Math.floor(((index + 1) / bucketCount) * audioBuffer.length),
    );
    const step = Math.max(1, Math.floor((end - start) / 800));
    let sum = 0;
    let count = 0;
    for (let sample = start; sample < end; sample += step) {
      for (const channel of channels) {
        const value = channel[sample] ?? 0;
        sum += value * value;
        count += 1;
      }
    }
    return count > 0 ? Math.sqrt(sum / count) : 0;
  });
  const max = Math.max(...values);
  if (max <= 0) return values.map(() => 8);
  return values.map((value) => Math.round(12 + (value / max) * 76));
}

function waveformBars(seed: string) {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return Array.from({ length: 48 }, (_, index) => {
    hash = (hash * 1664525 + 1013904223 + index) >>> 0;
    return 18 + (hash % 72);
  });
}
