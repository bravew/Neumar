import { useEffect, useMemo, useState } from 'react';

import { API_BASE_URL } from '@/config';

import { MediaLightbox } from './MediaLightbox';

interface ImmichPreview {
  connectionId: string;
  assetId: string;
  name?: string;
  mimeType?: string;
  mediaType: 'image' | 'video';
  webUrl?: string;
  thumbnailUrl: string;
  contentUrl: string;
}

const IMMICH_URL_RE = /https?:\/\/[^\s<>"'`\])]+/gi;
const IMMICH_ASSET_ID_RE = /^[0-9a-fA-F-]{8,80}$/;

export function extractImmichPhotoUrls(content: string): string[] {
  const urls = new Set<string>();
  for (const match of content.matchAll(IMMICH_URL_RE)) {
    const value = stripTrailingPunctuation(match[0]);
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      continue;
    }

    const parts = url.pathname.split('/').filter(Boolean);
    const photosIndex = parts.indexOf('photos');
    const assetId = photosIndex >= 0 ? parts[photosIndex + 1] : undefined;
    if (assetId && IMMICH_ASSET_ID_RE.test(assetId)) {
      urls.add(url.toString());
    }
  }
  return [...urls];
}

export function ImmichPublishedMediaPreviews({ content }: { content: string }) {
  const urls = useMemo(() => extractImmichPhotoUrls(content), [content]);
  if (!urls.length) return null;

  return (
    <div className="mt-1 flex max-w-full flex-col gap-2">
      {urls.map((url) => (
        <ImmichPublishedMediaPreview key={url} url={url} />
      ))}
    </div>
  );
}

function ImmichPublishedMediaPreview({ url }: { url: string }) {
  const [preview, setPreview] = useState<ImmichPreview | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setPreview(null);

    async function loadPreview() {
      try {
        const res = await fetch(
          `${API_BASE_URL}/cloud-storage/immich/published-preview?url=${encodeURIComponent(
            url,
          )}`,
          { signal: controller.signal },
        );
        if (!res.ok) return;
        const body = (await res.json()) as { item?: ImmichPreview };
        if (!controller.signal.aborted) setPreview(body.item ?? null);
      } catch (error) {
        if ((error as { name?: string }).name !== 'AbortError') {
          setPreview(null);
        }
      }
    }

    void loadPreview();
    return () => controller.abort();
  }, [url]);

  if (!preview) return null;

  const thumbnailUrl = toApiUrl(preview.thumbnailUrl);
  const contentUrl = toApiUrl(preview.contentUrl);
  const alt = preview.name ?? preview.assetId;

  if (preview.mediaType === 'video') {
    return (
      <video
        className="border-border/70 max-h-80 max-w-full rounded-lg border bg-black"
        src={contentUrl}
        poster={thumbnailUrl}
        controls
        preload="metadata"
      />
    );
  }

  return (
    <>
      <button
        type="button"
        className="block max-w-full cursor-zoom-in"
        onClick={() => setOpen(true)}
        aria-label={alt}
      >
        <img
          src={thumbnailUrl}
          alt={alt}
          className="border-border/70 bg-muted max-h-80 max-w-full rounded-lg border object-contain"
        />
      </button>
      {open && (
        <MediaLightbox
          src={contentUrl}
          alt={alt}
          type="image"
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function stripTrailingPunctuation(value: string): string {
  return value.replace(/[.,;:!?\]]+$/, '');
}

function toApiUrl(value: string): string {
  if (/^https?:\/\//i.test(value)) return value;
  return `${API_BASE_URL}${value.startsWith('/') ? value : `/${value}`}`;
}
