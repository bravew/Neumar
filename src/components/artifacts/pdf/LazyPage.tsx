import { useCallback, useEffect, useRef, useState } from 'react';

import { Page } from 'react-pdf';

interface LazyPageProps {
  pageNumber: number;
  scale: number;
  onVisible: (pageNumber: number) => void;
  onScrollRef?: (page: number, el: HTMLDivElement | null) => void;
}

export function LazyPage({
  pageNumber,
  scale,
  onVisible,
  onScrollRef,
}: LazyPageProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [pageHeight, setPageHeight] = useState<number | null>(null);

  const setRef = useCallback(
    (el: HTMLDivElement | null) => {
      containerRef.current = el;
      onScrollRef?.(pageNumber, el);
    },
    [pageNumber, onScrollRef],
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          onVisible(pageNumber);
        }
      },
      { rootMargin: '300px' }, // pre-render 300px before viewport
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [pageNumber, onVisible]);

  return (
    <div
      ref={setRef}
      className="flex justify-center"
      style={{ minHeight: `${(pageHeight ?? 842) * scale}px` }}
    >
      {isVisible && (
        <Page
          pageNumber={pageNumber}
          scale={scale}
          renderTextLayer
          renderAnnotationLayer
          onLoadSuccess={(page) =>
            setPageHeight(page.getViewport({ scale: 1 }).height)
          }
        />
      )}
    </div>
  );
}
