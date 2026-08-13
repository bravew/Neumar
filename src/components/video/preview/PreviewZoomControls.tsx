import { Maximize2, ZoomIn, ZoomOut } from 'lucide-react';

import { useLanguage } from '@/shared/providers/language-provider';

interface PreviewZoomControlsProps {
  onFit: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  zoom: number;
}

export function PreviewZoomControls({
  onFit,
  onZoomIn,
  onZoomOut,
  zoom,
}: PreviewZoomControlsProps) {
  const { t } = useLanguage();
  const labels = t.video.editor.preview;
  return (
    <div className="border-border bg-background/90 text-foreground absolute top-2 right-2 z-30 flex items-center overflow-hidden rounded-md border shadow-sm backdrop-blur">
      <button
        type="button"
        className="hover:bg-accent flex size-7 items-center justify-center"
        aria-label={labels.zoomOut}
        title={labels.zoomOut}
        onClick={onZoomOut}
      >
        <ZoomOut className="size-3.5" />
      </button>
      <output
        className="min-w-11 px-1 text-center text-[11px]"
        aria-label={labels.zoomLevel}
      >
        {Math.round(zoom * 100)}%
      </output>
      <button
        type="button"
        className="hover:bg-accent flex size-7 items-center justify-center"
        aria-label={labels.zoomIn}
        title={labels.zoomIn}
        onClick={onZoomIn}
      >
        <ZoomIn className="size-3.5" />
      </button>
      <button
        type="button"
        className="hover:bg-accent border-border flex size-7 items-center justify-center border-l"
        aria-label={labels.zoomFit}
        title={labels.zoomFit}
        onClick={onFit}
      >
        <Maximize2 className="size-3.5" />
      </button>
    </div>
  );
}
