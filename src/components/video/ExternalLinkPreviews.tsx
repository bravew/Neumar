import { useEffect, useMemo, useState } from 'react';

import {
  ExternalLink,
  Globe2,
  Image as ImageIcon,
  Play,
  Video,
} from 'lucide-react';

import { openExternalUrl } from '@/shared/lib/open-external-url';
import { useLanguage } from '@/shared/providers/language-provider';
import {
  fetchLinkPreview,
  type LinkPreview,
} from '@/shared/video/link-preview';

type PreviewState =
  | { status: 'loading' }
  | { status: 'ready'; preview: LinkPreview }
  | { status: 'error' };

interface ExternalLinkPreviewsProps {
  urls: string[];
  enabled: boolean;
}

export function ExternalLinkPreviews({
  urls,
  enabled,
}: ExternalLinkPreviewsProps) {
  const { t } = useLanguage();
  const labels = t.video.editor.agentDock.linkPreview;
  const [states, setStates] = useState<Record<string, PreviewState>>({});
  const [pinnedUrl, setPinnedUrl] = useState<string | null>(null);
  const urlsKey = urls.join('\n');

  useEffect(() => {
    if (!enabled || urls.length === 0) {
      setStates({});
      setPinnedUrl(null);
      return;
    }

    const controller = new AbortController();
    setStates((previous) =>
      Object.fromEntries(
        urls.map((url) => [url, previous[url] ?? { status: 'loading' }]),
      ),
    );

    for (const url of urls) {
      void fetchLinkPreview(url, controller.signal)
        .then((preview) => {
          if (controller.signal.aborted) return;
          setStates((previous) => ({
            ...previous,
            [url]: { status: 'ready', preview },
          }));
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          setStates((previous) => ({
            ...previous,
            [url]: { status: 'error' },
          }));
        });
    }

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- urlsKey proxies urls content; the reference is intentionally excluded to avoid spurious refetches
  }, [enabled, urlsKey]);

  const visibleItems = useMemo(
    () =>
      urls
        .map((url) => ({ url, state: states[url] ?? { status: 'loading' } }))
        .filter(
          (item) =>
            item.state.status !== 'ready' ||
            item.state.preview.kind !== 'unsupported',
        ),
    [states, urls],
  );
  if (!enabled || visibleItems.length === 0) return null;

  return (
    <div className="w-full space-y-2 pt-1">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(220px,100%),1fr))] gap-2">
        {visibleItems.map(({ url, state }) => (
          <PreviewCard
            key={url}
            state={state}
            pinned={pinnedUrl === url}
            labels={labels}
            onTogglePinned={() =>
              setPinnedUrl((current) => (current === url ? null : url))
            }
          />
        ))}
      </div>
    </div>
  );
}

function PreviewCard({
  state,
  pinned,
  labels,
  onTogglePinned,
}: {
  state: PreviewState;
  pinned: boolean;
  labels: Record<string, string>;
  onTogglePinned: () => void;
}) {
  if (state.status === 'loading') {
    return (
      <div className="border-border bg-background/80 overflow-hidden rounded-md border">
        <div className="bg-muted/70 aspect-video animate-pulse" />
        <div className="text-muted-foreground px-2 py-2 text-xs">
          {labels.loading}
        </div>
      </div>
    );
  }

  if (state.status === 'error') return null;
  const preview = state.preview;
  if (preview.kind === 'unsupported') return null;

  const isVideo = preview.kind === 'video';
  const imageUrl =
    preview.kind === 'video'
      ? preview.thumbnailUrl
      : preview.kind === 'image'
        ? preview.imageUrl
        : preview.imageUrl;
  const title = preview.title;
  const subtitle =
    preview.kind === 'video'
      ? preview.authorName || labels.video
      : preview.kind === 'image'
        ? labels.image
        : preview.siteName || new URL(preview.url).hostname;
  const Icon =
    preview.kind === 'video'
      ? Video
      : preview.kind === 'image'
        ? ImageIcon
        : Globe2;
  const cardClassName = [
    'border-border bg-background hover:border-primary/70 focus-within:border-primary overflow-hidden rounded-md border transition-colors',
    pinned ? 'border-primary/80 ring-primary/20 ring-2' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <article data-testid="external-link-preview-card" className={cardClassName}>
      <div className="bg-muted relative aspect-video overflow-hidden">
        {isVideo && pinned && preview.kind === 'video' ? (
          <iframe
            data-testid="external-link-inline-player"
            src={toPlayableEmbedUrl(preview.embedUrl)}
            title={preview.title}
            loading="lazy"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            sandbox="allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox"
            className="h-full w-full bg-black"
          />
        ) : (
          <>
            {imageUrl ? (
              <img
                src={imageUrl}
                alt=""
                loading="lazy"
                referrerPolicy="no-referrer"
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center">
                <Icon
                  className="text-muted-foreground size-6"
                  aria-hidden="true"
                />
              </div>
            )}
            {isVideo ? (
              <button
                type="button"
                className="absolute inset-0 flex items-center justify-center bg-black/10 text-white transition-colors hover:bg-black/20"
                onClick={onTogglePinned}
                aria-label={labels.preview}
                title={labels.preview}
              >
                <span className="rounded-full bg-black/75 p-3 shadow-lg">
                  <Play className="size-6 fill-current" aria-hidden="true" />
                </span>
              </button>
            ) : null}
          </>
        )}
      </div>
      <div className="space-y-1.5 p-2">
        <div className="text-foreground line-clamp-2 min-h-[2rem] text-xs leading-4 font-medium">
          {title}
        </div>
        <div className="text-muted-foreground flex items-center gap-1 text-[10px]">
          <Icon className="size-3 shrink-0" aria-hidden="true" />
          <span className="truncate">{subtitle}</span>
        </div>
        {preview.kind === 'web' && preview.description ? (
          <div className="text-muted-foreground line-clamp-2 text-[11px]">
            {preview.description}
          </div>
        ) : null}
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {isVideo ? (
            <button
              type="button"
              className="border-border bg-muted/40 hover:bg-muted rounded px-2 py-1 text-[10px]"
              onClick={onTogglePinned}
              title={labels.preview}
            >
              {pinned ? labels.close : labels.preview}
            </button>
          ) : null}
          <button
            type="button"
            className="border-border bg-muted/40 hover:bg-muted inline-flex items-center gap-1 rounded px-2 py-1 text-[10px]"
            onClick={() => void openExternalUrl(preview.url)}
            title={preview.url}
          >
            <ExternalLink className="size-3" aria-hidden="true" />
            {labels.open}
          </button>
        </div>
      </div>
    </article>
  );
}

function toPlayableEmbedUrl(embedUrl: string): string {
  try {
    const url = new URL(embedUrl);
    if (url.hostname.includes('youtube')) {
      url.searchParams.set('autoplay', '1');
      url.searchParams.set('mute', '1');
      url.searchParams.set('playsinline', '1');
    } else if (url.hostname.includes('vimeo')) {
      url.searchParams.set('autoplay', '1');
      url.searchParams.set('muted', '1');
      url.searchParams.set('playsinline', '1');
    }
    return url.toString();
  } catch {
    return embedUrl;
  }
}
