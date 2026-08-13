import { useEffect, useRef, useState } from 'react';

import { Image, Play, Video } from 'lucide-react';

import { aspectRatioStyle } from '@/components/design/promptTemplateAspect';
import type { PromptLibrarySample } from '@/shared/design/prompt-library-types';
import { useReducedMotionPreference } from '@/shared/hooks/useReducedMotionPreference';
import { cn } from '@/shared/lib/utils';

export function PromptLibraryGrid({
  samples,
  selectedId,
  labels,
  onSelect,
}: {
  samples: PromptLibrarySample[];
  selectedId?: string;
  labels: { empty: string; noPreview: string };
  onSelect: (sample: PromptLibrarySample) => void;
}) {
  if (samples.length === 0) {
    return <p className="text-muted-foreground text-sm">{labels.empty}</p>;
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {samples.map((sample) => (
        <PromptLibraryCard
          key={sample.id}
          sample={sample}
          selected={sample.id === selectedId}
          noPreviewLabel={labels.noPreview}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

function PromptLibraryCard({
  sample,
  selected,
  noPreviewLabel,
  onSelect,
}: {
  sample: PromptLibrarySample;
  selected: boolean;
  noPreviewLabel: string;
  onSelect: (sample: PromptLibrarySample) => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const [hovered, setHovered] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const reducedMotion = useReducedMotionPreference();
  const isVideo = sample.surface === 'video';
  const hasPreview = Boolean(sample.previewImageUrl);
  const hasVideoPreview = isVideo && Boolean(sample.previewVideoUrl);
  const FallbackIcon = isVideo ? Video : Image;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (hovered && !reducedMotion) {
      const playResult = video.play();
      if (playResult) void playResult.catch(() => {});
    } else {
      video.pause();
      video.currentTime = 0;
    }
  }, [hovered, reducedMotion]);

  return (
    <button
      type="button"
      className="border-border bg-card data-[selected=true]:border-primary data-[selected=true]:ring-primary/25 hover:border-primary/40 overflow-hidden rounded-md border text-left transition outline-none focus-visible:ring-2"
      data-selected={selected}
      data-testid={`prompt-library-card-${sample.id}`}
      onClick={() => onSelect(sample)}
      onMouseEnter={() => setHovered(!reducedMotion)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(!reducedMotion)}
      onBlur={() => setHovered(false)}
    >
      <div
        className="bg-muted relative w-full overflow-hidden"
        style={aspectRatioStyle(sample)}
      >
        {hasPreview ? (
          <>
            {!loaded && (
              <div className="absolute inset-0 animate-pulse" aria-hidden />
            )}
            <img
              src={sample.previewImageUrl}
              alt=""
              loading="lazy"
              onLoad={() => setLoaded(true)}
              className={cn(
                'absolute inset-0 h-full w-full object-contain transition-opacity duration-200 motion-reduce:transition-none',
                loaded ? 'opacity-100' : 'opacity-0',
              )}
            />
            {hasVideoPreview && (
              <video
                ref={videoRef}
                src={sample.previewVideoUrl}
                poster={sample.previewImageUrl}
                muted
                loop
                playsInline
                preload="none"
                aria-hidden="true"
                tabIndex={-1}
                className={cn(
                  'absolute inset-0 h-full w-full object-contain transition-opacity duration-200 motion-reduce:transition-none',
                  hovered && !reducedMotion
                    ? 'opacity-100'
                    : 'pointer-events-none opacity-0',
                )}
              />
            )}
            {isVideo && (
              <span
                className="absolute right-2 bottom-2 rounded-full bg-black/55 p-1.5 text-white"
                aria-hidden="true"
              >
                <Play className="size-3.5 fill-white" aria-hidden="true" />
              </span>
            )}
          </>
        ) : (
          <div className="text-muted-foreground absolute inset-0 flex flex-col items-center justify-center gap-1 p-3">
            <FallbackIcon className="size-7" />
            <span className="text-xs">{noPreviewLabel}</span>
          </div>
        )}
      </div>
      <div className="space-y-2 p-3">
        <div>
          <h3 className="line-clamp-2 text-sm font-semibold">{sample.title}</h3>
          {sample.summary && (
            <p className="text-muted-foreground mt-1 line-clamp-2 text-xs">
              {sample.summary}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-1 text-xs">
          {sample.model && <Chip>{sample.model}</Chip>}
          {sample.aspect && <Chip>{sample.aspect}</Chip>}
          {sample._meta.locales.slice(0, 2).map((locale) => (
            <Chip key={locale}>{locale}</Chip>
          ))}
        </div>
      </div>
    </button>
  );
}

function Chip({ children }: { children: string }) {
  return <span className="bg-muted rounded px-1.5 py-0.5">{children}</span>;
}
