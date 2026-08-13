import { useEffect, useRef, useState } from 'react';

import { AudioLines, Video } from 'lucide-react';

import { getImageMimeType, isRemoteUrl } from '@/components/artifacts/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/shared/lib/utils';

import type { MediaVersion } from '../types';

interface VersionStripProps {
  versions: MediaVersion[];
  activeVersionId: string;
  onSelectVersion?: (version: MediaVersion) => void;
}

export function VersionStrip({
  versions,
  activeVersionId,
  onSelectVersion,
}: VersionStripProps) {
  const activeRef = useRef<HTMLButtonElement>(null);

  // Auto-scroll to active version
  useEffect(() => {
    if (activeRef.current) {
      activeRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'nearest',
      });
    }
  }, [activeVersionId]);

  if (versions.length === 0) return null;

  return (
    <div className="border-border/50 shrink-0 border-t">
      <div className="flex gap-2 overflow-x-auto p-3">
        <TooltipProvider delayDuration={300}>
          {versions.map((version) => (
            <Tooltip key={version.id}>
              <TooltipTrigger asChild>
                <button
                  ref={version.id === activeVersionId ? activeRef : undefined}
                  onClick={() => onSelectVersion?.(version)}
                  className={cn(
                    'group relative flex size-16 shrink-0 cursor-pointer flex-col items-center justify-center overflow-hidden rounded-lg border-2 transition-all',
                    version.id === activeVersionId
                      ? 'border-primary shadow-md'
                      : 'border-border hover:border-primary/50',
                  )}
                >
                  <VersionThumbnail version={version} />

                  {/* Version number badge */}
                  <div className="absolute right-0.5 bottom-0.5 rounded bg-black/60 px-1 py-px text-[9px] font-medium text-white">
                    v{version.versionNumber}
                  </div>

                  {/* "Original" badge */}
                  {version.versionNumber === 1 && (
                    <div className="absolute top-0.5 left-0.5 rounded bg-black/60 px-1 py-px text-[8px] text-white">
                      orig
                    </div>
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs">
                <p className="text-xs">
                  {version.prompt
                    ? version.prompt.slice(0, 100) +
                      (version.prompt.length > 100 ? '...' : '')
                    : `Version ${version.versionNumber}`}
                </p>
              </TooltipContent>
            </Tooltip>
          ))}
        </TooltipProvider>
      </div>
    </div>
  );
}

function VersionThumbnail({ version }: { version: MediaVersion }) {
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const blobUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (version.type !== 'image') return;

    let cancelled = false;

    async function load() {
      const src = version.path;

      if (
        src.startsWith('data:') ||
        src.startsWith('http') ||
        src.startsWith('blob:')
      ) {
        if (!cancelled) setThumbUrl(src);
        return;
      }

      if (isRemoteUrl(src)) {
        if (!cancelled)
          setThumbUrl(src.startsWith('//') ? `https:${src}` : src);
        return;
      }

      // Try Tauri readFile first (native), fall back to API stream URL (browser)
      try {
        const ext = src.split('.').pop()?.toLowerCase() || '';
        const mimeType = getImageMimeType(ext);
        const { readFile } = await import('@tauri-apps/plugin-fs');
        const data = await readFile(src);
        const blob = new Blob([data], { type: mimeType });
        const url = URL.createObjectURL(blob);
        blobUrlRef.current = url;
        if (!cancelled) setThumbUrl(url);
      } catch {
        // Tauri unavailable or path inaccessible — use API streaming endpoint
        const { getStreamUrl } =
          await import('@/components/artifacts/media-loader');
        if (!cancelled) setThumbUrl(getStreamUrl(src));
      }
    }

    load();

    return () => {
      cancelled = true;
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, [version.path, version.type]);

  if (version.type === 'video') {
    return (
      <div className="bg-muted flex size-full items-center justify-center">
        <Video className="text-muted-foreground size-6" />
      </div>
    );
  }

  if (version.type === 'audio') {
    return (
      <div className="bg-muted flex size-full items-center justify-center">
        <AudioLines className="text-muted-foreground size-6" />
      </div>
    );
  }

  if (thumbUrl) {
    return (
      <img
        src={thumbUrl}
        alt={`Version ${version.versionNumber}`}
        className="size-full object-cover"
      />
    );
  }

  return <div className="bg-muted size-full" />;
}
