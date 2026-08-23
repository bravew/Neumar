import type { ReactNode } from 'react';

import { AudioLines, ExternalLink, Image as ImageIcon } from 'lucide-react';

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { openExternalUrl } from '@/shared/lib/open-external-url';

import { AssetVideoHoverPreview } from './AssetVideoHoverPreview';

interface AssetHoverPreviewProps {
  children: ReactNode;
  title: string;
  subtitle?: string;
  kind: string;
  previewUrl?: string | null;
  previewKind?: 'image' | 'video' | 'audio';
  /**
   * Optional poster image rendered while a video preview buffers. Useful
   * when `previewKind === 'video'` so the tooltip never flashes blank.
   */
  previewPoster?: string | null;
  rows: Array<[string, string | null | undefined]>;
  /**
   * Render an "Open in <provider>" footer link when the asset traces back
   * to an upstream provider (Immich, Drive, Box, …). The link routes
   * through the Tauri opener when running in the desktop shell so the
   * native browser handles the navigation.
   *
   * `icon` is an optional ReactNode (typically the project's
   * `CloudProviderIcon`) rendered before the label, so the user sees the
   * Drive triangle / Box brand mark / Immich glyph instead of the raw
   * provider id.
   */
  sourceLink?: {
    url: string;
    provider: string;
    label?: string;
    icon?: ReactNode;
  } | null;
}

export function AssetHoverPreview({
  children,
  title,
  subtitle,
  kind,
  previewUrl,
  previewKind = 'image',
  previewPoster,
  rows,
  sourceLink,
}: AssetHoverPreviewProps) {
  const visibleRows = rows.filter((row): row is [string, string] =>
    Boolean(row[1]),
  );
  return (
    <TooltipProvider delayDuration={250}>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent
          side="right"
          align="start"
          sideOffset={10}
          className="bg-popover text-popover-foreground border-border w-80 rounded-lg border p-0 shadow-xl"
        >
          <div className="space-y-3 p-3">
            {previewUrl && previewKind === 'audio' ? (
              // Audio has no frame to show, so the preview is the sound. It
              // waits for a click rather than playing on hover — sweeping the
              // pointer down a list of tracks should not make noise, and
              // browsers block unmuted autoplay without a gesture anyway.
              <div className="bg-muted flex items-center gap-2 rounded-md p-2">
                <AudioLines
                  className="text-muted-foreground size-4 shrink-0"
                  aria-hidden
                />
                <audio
                  src={previewUrl}
                  controls
                  preload="metadata"
                  className="h-8 min-w-0 flex-1"
                  onClick={(event) => event.stopPropagation()}
                  onPointerDown={(event) => event.stopPropagation()}
                >
                  <track kind="captions" />
                </audio>
              </div>
            ) : null}
            {previewUrl && previewKind === 'video' ? (
              // Auto-plays muted so the tooltip shows actual motion instead of
              // a static first frame, with a scrub bar on hover for finding a
              // specific moment. Falls back to the poster if the stream errors.
              <AssetVideoHoverPreview src={previewUrl} poster={previewPoster} />
            ) : null}
            {previewUrl && previewKind === 'image' ? (
              <div className="bg-muted text-muted-foreground relative flex aspect-video items-center justify-center overflow-hidden rounded-md">
                <ImageIcon className="absolute size-7" aria-hidden />
                <img
                  src={previewUrl}
                  alt=""
                  className="relative size-full object-cover"
                  loading="lazy"
                  onError={(event) => {
                    event.currentTarget.style.display = 'none';
                  }}
                />
              </div>
            ) : null}
            <div className="min-w-0">
              <p className="text-foreground truncate text-sm font-medium">
                {title}
              </p>
              <p className="text-muted-foreground truncate text-[11px]">
                {subtitle ?? kind}
              </p>
            </div>
            {visibleRows.length > 0 ? (
              <dl className="grid grid-cols-[88px_minmax(0,1fr)] gap-x-2 gap-y-1 text-[11px]">
                {visibleRows.map(([label, value]) => (
                  <div key={label} className="contents">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="text-foreground min-w-0 truncate">
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : null}
            {sourceLink ? (
              <button
                type="button"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  void openExternalUrl(sourceLink.url);
                }}
                className="text-primary hover:text-primary/80 border-border inline-flex w-full items-center gap-1.5 border-t pt-2 text-[11px]"
              >
                {sourceLink.icon ?? (
                  <ExternalLink className="size-3" aria-hidden />
                )}
                <span className="truncate">
                  {sourceLink.label ?? `Open in ${sourceLink.provider}`}
                </span>
                <ExternalLink
                  className="text-muted-foreground ml-auto size-3 shrink-0"
                  aria-hidden
                />
              </button>
            ) : null}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
