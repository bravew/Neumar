import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';

import { Button } from '@/components/ui/button';

interface PdfToolbarProps {
  currentPage: number;
  numPages: number;
  scale: number;
  onPageChange: (page: number) => void;
  onScaleChange: (scale: number) => void;
  onOpenExternal?: () => void;
}

const SCALE_STEP = 0.25;
const MIN_SCALE = 0.5;
const MAX_SCALE = 3.0;

export function PdfToolbar({
  currentPage,
  numPages,
  scale,
  onPageChange,
  onScaleChange,
  onOpenExternal,
}: PdfToolbarProps) {
  return (
    <div className="border-border bg-background flex items-center gap-2 border-b px-3 py-1.5">
      <Button
        variant="ghost"
        size="icon"
        className="size-7"
        aria-label="Previous page"
        onClick={() => onPageChange(Math.max(1, currentPage - 1))}
        disabled={currentPage <= 1}
      >
        <ChevronLeft className="size-4" />
      </Button>
      <span className="text-muted-foreground w-16 text-center text-xs tabular-nums">
        {currentPage} / {numPages}
      </span>
      <Button
        variant="ghost"
        size="icon"
        className="size-7"
        aria-label="Next page"
        onClick={() => onPageChange(Math.min(numPages, currentPage + 1))}
        disabled={currentPage >= numPages}
      >
        <ChevronRight className="size-4" />
      </Button>
      <div className="bg-border mx-1 h-4 w-px" />
      <Button
        variant="ghost"
        size="icon"
        className="size-7"
        aria-label="Zoom out"
        onClick={() => onScaleChange(Math.max(MIN_SCALE, scale - SCALE_STEP))}
        disabled={scale <= MIN_SCALE}
      >
        <ZoomOut className="size-4" />
      </Button>
      <span className="text-muted-foreground w-12 text-center text-xs tabular-nums">
        {Math.round(scale * 100)}%
      </span>
      <Button
        variant="ghost"
        size="icon"
        className="size-7"
        aria-label="Zoom in"
        onClick={() => onScaleChange(Math.min(MAX_SCALE, scale + SCALE_STEP))}
        disabled={scale >= MAX_SCALE}
      >
        <ZoomIn className="size-4" />
      </Button>
      {onOpenExternal && (
        <>
          <div className="bg-border mx-1 h-4 w-px" />
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label="Open in system viewer"
            onClick={onOpenExternal}
          >
            <ExternalLink className="size-4" />
          </Button>
        </>
      )}
    </div>
  );
}
