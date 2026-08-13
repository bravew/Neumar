export interface TimelineFramePreview {
  atMs: number;
  imageBase64: string;
  w?: number;
  h?: number;
  cacheHit?: boolean;
}

interface TimelineFramePreviewStripProps {
  title: string;
  frames: TimelineFramePreview[];
  frameAtLabel: string;
  cacheHitLabel: string;
}

export function TimelineFramePreviewStrip({
  title,
  frames,
  frameAtLabel,
  cacheHitLabel,
}: TimelineFramePreviewStripProps) {
  if (frames.length === 0) return null;
  return (
    <div className="border-border bg-muted/20 mb-3 rounded-md border p-2">
      <div className="text-muted-foreground mb-2 text-[10px] font-medium uppercase">
        {title}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {frames.map((frame) => (
          <figure key={`${frame.atMs}:${frame.imageBase64.slice(0, 12)}`}>
            <img
              alt={frameAtLabel.replace('{value}', formatMs(frame.atMs))}
              src={`data:image/png;base64,${frame.imageBase64}`}
              width={frame.w}
              height={frame.h}
              style={{
                aspectRatio:
                  frame.w && frame.h ? `${frame.w} / ${frame.h}` : undefined,
              }}
              className="bg-background max-h-32 w-full rounded-sm object-contain"
            />
            <figcaption className="text-muted-foreground mt-1 truncate text-[10px]">
              {frameAtLabel.replace('{value}', formatMs(frame.atMs))}
              {frame.cacheHit ? ` · ${cacheHitLabel}` : ''}
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}

function formatMs(value: number): string {
  return `${new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 1,
  }).format(value)} ms`;
}
