import { useCallback, useEffect, useRef, useState } from 'react';

import { getImageMimeType, isRemoteUrl } from '@/components/artifacts/utils';
import { AILoadingIndicator } from '@/components/ui/AILoadingIndicator';

interface ComparisonSliderProps {
  beforeSrc: string;
  afterSrc: string;
}

export function ComparisonSlider({
  beforeSrc,
  afterSrc,
}: ComparisonSliderProps) {
  const [sliderValue, setSliderValue] = useState(50);
  const [beforeUrl, setBeforeUrl] = useState<string | null>(null);
  const [afterUrl, setAfterUrl] = useState<string | null>(null);
  const [beforeLoaded, setBeforeLoaded] = useState(false);
  const [afterLoaded, setAfterLoaded] = useState(false);
  const beforeBlobRef = useRef<string | null>(null);
  const afterBlobRef = useRef<string | null>(null);

  // Load image from path (supports Tauri fs, remote URLs, data URLs)
  const loadImage = useCallback(
    async (
      src: string,
      setBlobRef: React.MutableRefObject<string | null>,
    ): Promise<string> => {
      // Already a displayable URL
      if (
        src.startsWith('data:') ||
        src.startsWith('http') ||
        src.startsWith('blob:')
      ) {
        return src;
      }

      // Remote URL
      if (isRemoteUrl(src)) {
        return src.startsWith('//') ? `https:${src}` : src;
      }

      // Local file - resolve path then read
      const { resolveMediaPath, readBinaryFile } =
        await import('@/components/artifacts/media-loader');
      const resolved = await resolveMediaPath(src);
      const ext = resolved.split('.').pop()?.toLowerCase() || '';
      const mimeType = getImageMimeType(ext);
      const blob = await readBinaryFile(resolved, mimeType);
      const url = URL.createObjectURL(blob);
      setBlobRef.current = url;
      return url;
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;

    // Clean up previous blob URLs
    if (beforeBlobRef.current) {
      URL.revokeObjectURL(beforeBlobRef.current);
      beforeBlobRef.current = null;
    }
    if (afterBlobRef.current) {
      URL.revokeObjectURL(afterBlobRef.current);
      afterBlobRef.current = null;
    }

    setBeforeLoaded(false);
    setAfterLoaded(false);

    Promise.all([
      loadImage(beforeSrc, beforeBlobRef),
      loadImage(afterSrc, afterBlobRef),
    ])
      .then(([before, after]) => {
        if (!cancelled) {
          setBeforeUrl(before);
          setAfterUrl(after);
        }
      })
      .catch((err) => {
        console.error('[ComparisonSlider] Failed to load images:', err);
      });

    return () => {
      cancelled = true;
      if (beforeBlobRef.current) {
        URL.revokeObjectURL(beforeBlobRef.current);
        beforeBlobRef.current = null;
      }
      if (afterBlobRef.current) {
        URL.revokeObjectURL(afterBlobRef.current);
        afterBlobRef.current = null;
      }
    };
  }, [beforeSrc, afterSrc, loadImage]);

  const isLoading = !beforeLoaded || !afterLoaded;

  return (
    <div className="relative w-full max-w-4xl select-none">
      {/* Loading overlay */}
      {isLoading && beforeUrl && afterUrl && (
        <div className="absolute inset-0 z-10 flex items-center justify-center">
          <AILoadingIndicator size="md" />
        </div>
      )}

      {/* Labels */}
      <div className="pointer-events-none absolute top-3 right-3 left-3 z-20 flex justify-between">
        <span className="rounded bg-black/60 px-2 py-0.5 text-xs text-white">
          Before
        </span>
        <span className="rounded bg-black/60 px-2 py-0.5 text-xs text-white">
          After
        </span>
      </div>

      {/* Image container */}
      <div className="relative overflow-hidden rounded-lg">
        {/* Before image (full, underneath) */}
        {beforeUrl && (
          <img
            src={beforeUrl}
            alt="Before"
            className="block max-h-[70vh] w-full object-contain"
            onLoad={() => setBeforeLoaded(true)}
          />
        )}

        {/* After image (clipped) */}
        {afterUrl && (
          <img
            src={afterUrl}
            alt="After"
            className="absolute inset-0 block max-h-[70vh] w-full object-contain"
            style={{
              clipPath: `inset(0 ${100 - sliderValue}% 0 0)`,
            }}
            onLoad={() => setAfterLoaded(true)}
          />
        )}

        {/* Divider line */}
        <div
          className="pointer-events-none absolute top-0 bottom-0 z-10 w-0.5 bg-white shadow-lg"
          style={{ left: `${sliderValue}%` }}
        >
          {/* Handle */}
          <div className="absolute top-1/2 left-1/2 flex size-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white bg-black/50 shadow-lg">
            <svg
              className="size-4 text-white"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M8 5l-5 7 5 7M16 5l5 7-5 7" />
            </svg>
          </div>
        </div>

        {/* Native range input for accessibility */}
        <input
          type="range"
          min={0}
          max={100}
          value={sliderValue}
          onChange={(e) => setSliderValue(Number(e.target.value))}
          className="absolute inset-0 z-20 h-full w-full cursor-col-resize opacity-0"
          aria-label="Comparison slider"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={sliderValue}
        />
      </div>
    </div>
  );
}
