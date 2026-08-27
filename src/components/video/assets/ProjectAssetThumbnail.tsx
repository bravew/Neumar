import { type ReactNode, useEffect, useRef, useState } from 'react';

import { FileAudio, FileVideo, Image as ImageIcon } from 'lucide-react';

import type { VideoProject } from '@/shared/types/video';

import { projectAssetThumbnailUrl } from './projectAssetMedia';

type ProjectAsset = VideoProject['assets'][number];

const KIND_ICONS = {
  image: ImageIcon,
  video: FileVideo,
  audio: FileAudio,
} as const;

// Referenced (un-downloaded) catalog assets have no local thumbnail derivative;
// their thumb is proxied through a remote connector. Right after an app restart
// those connectors are still warming up, so the first thumbnail request can
// 404. Retry a few times with backoff so a transient failure doesn't blank the
// tile forever — only fall back to the kind icon once retries are exhausted.
const THUMB_MAX_RETRIES = 4;
const THUMB_RETRY_BASE_MS = 400;

export function ProjectAssetThumbnail({
  asset,
  projectId,
  badge,
}: {
  asset: ProjectAsset;
  projectId: string;
  badge: ReactNode;
}) {
  const kind =
    asset.kind === 'image' || asset.kind === 'video' || asset.kind === 'audio'
      ? asset.kind
      : 'image';
  const Icon = KIND_ICONS[kind] ?? ImageIcon;
  const thumbUrl = projectAssetThumbnailUrl(projectId, asset);

  const [attempt, setAttempt] = useState(0);
  const [exhausted, setExhausted] = useState(false);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset retry state whenever the source URL changes (asset swapped into the
  // same tile, or hydration flips the resolved thumbnail URL).
  useEffect(() => {
    setAttempt(0);
    setExhausted(false);
  }, [thumbUrl]);

  // Cancel any pending retry on unmount.
  useEffect(
    () => () => {
      if (retryTimer.current) clearTimeout(retryTimer.current);
    },
    [],
  );

  if (thumbUrl && !exhausted) {
    // Cache-bust on retries so the browser re-requests a URL that previously
    // 404'd while the API's remote connectors were still warming up.
    const src =
      attempt > 0
        ? `${thumbUrl}${thumbUrl.includes('?') ? '&' : '?'}retry=${attempt}`
        : thumbUrl;
    return (
      <div className="bg-muted text-muted-foreground relative size-10 shrink-0 overflow-hidden rounded">
        <div className="absolute inset-0 flex items-center justify-center">
          <Icon className="size-4" />
        </div>
        <img
          // Remount on each retry so this onError closure captures the current
          // attempt and the browser reloads the cache-busted src.
          key={src}
          src={src}
          alt=""
          className="relative size-full object-cover"
          loading="lazy"
          onError={() => {
            if (retryTimer.current) clearTimeout(retryTimer.current);
            if (attempt >= THUMB_MAX_RETRIES) {
              setExhausted(true);
              return;
            }
            retryTimer.current = setTimeout(
              () => setAttempt((n) => n + 1),
              THUMB_RETRY_BASE_MS * 2 ** attempt,
            );
          }}
        />
        {badge}
      </div>
    );
  }
  return (
    <div className="bg-muted text-muted-foreground relative flex size-10 shrink-0 items-center justify-center rounded">
      <Icon className="size-4" />
      {badge}
    </div>
  );
}
