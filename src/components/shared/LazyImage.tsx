import { useEffect, useRef, useState } from 'react';

import { AILoadingIndicator } from '@/components/ui/AILoadingIndicator';
import { cn } from '@/shared/lib/utils';

interface LazyImageProps {
  src: string;
  alt: string;
  className?: string;
  placeholderClassName?: string;
  isDataLoading?: boolean; // True when the image data is still being fetched
}

/**
 * LazyImage component that only loads the image when it enters the viewport.
 * Uses Intersection Observer for efficient lazy loading.
 * Also supports showing a loading state when image data is being fetched.
 */
export function LazyImage({
  src,
  alt,
  className,
  placeholderClassName,
  isDataLoading = false,
}: LazyImageProps) {
  const imgRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);

  // Reset loaded state when src changes
  useEffect(() => {
    if (src) {
      setIsLoaded(false);
    }
  }, [src]);

  useEffect(() => {
    const element = imgRef.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setIsVisible(true);
            observer.disconnect();
          }
        });
      },
      {
        rootMargin: '100px', // Start loading 100px before entering viewport
        threshold: 0,
      },
    );

    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, []);

  const showPlaceholder = isDataLoading || !isLoaded;
  const canShowImage = isVisible && src && !isDataLoading;

  return (
    <div ref={imgRef} className={cn('relative', className)}>
      {showPlaceholder && (
        <div
          className={cn(
            'flex items-center justify-center rounded-lg',
            'min-h-[100px] min-w-[100px]',
            isDataLoading ? 'bg-muted' : 'shimmer',
            placeholderClassName,
          )}
        >
          {isDataLoading && (
            <AILoadingIndicator size="sm" label="Loading image" />
          )}
        </div>
      )}
      {canShowImage && (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          onLoad={() => setIsLoaded(true)}
          className={cn(
            'max-h-48 max-w-full rounded-lg object-contain',
            !isLoaded && 'absolute inset-0 opacity-0',
            className,
          )}
        />
      )}
    </div>
  );
}
