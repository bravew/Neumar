import type { PreviewSnapGuide } from './webcodecs/previewSnap';
import {
  canvasToOverlay,
  type PreviewViewportGeometry,
} from './webcodecs/previewViewport';

interface SnapGuidesProps {
  guides: PreviewSnapGuide[];
  viewport: PreviewViewportGeometry;
}

export function SnapGuides({ guides, viewport }: SnapGuidesProps) {
  if (guides.length === 0) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-10" aria-hidden>
      {guides.map((guide) =>
        guide.axis === 'x' ? (
          <VerticalGuide
            key={`${guide.axis}-${guide.position}`}
            position={guide.position}
            viewport={viewport}
          />
        ) : (
          <HorizontalGuide
            key={`${guide.axis}-${guide.position}`}
            position={guide.position}
            viewport={viewport}
          />
        ),
      )}
    </div>
  );
}

function VerticalGuide({
  position,
  viewport,
}: {
  position: number;
  viewport: PreviewViewportGeometry;
}) {
  const from = canvasToOverlay(viewport, { x: position, y: 0 });
  const to = canvasToOverlay(viewport, {
    x: position,
    y: viewport.canvasHeight,
  });
  return (
    <div
      className="bg-primary absolute w-px shadow-[0_0_0_1px_rgba(0,0,0,0.35)]"
      style={{
        height: Math.abs(to.y - from.y),
        left: from.x,
        top: Math.min(from.y, to.y),
      }}
    />
  );
}

function HorizontalGuide({
  position,
  viewport,
}: {
  position: number;
  viewport: PreviewViewportGeometry;
}) {
  const from = canvasToOverlay(viewport, { x: 0, y: position });
  const to = canvasToOverlay(viewport, {
    x: viewport.canvasWidth,
    y: position,
  });
  return (
    <div
      className="bg-primary absolute h-px shadow-[0_0_0_1px_rgba(0,0,0,0.35)]"
      style={{
        left: Math.min(from.x, to.x),
        top: from.y,
        width: Math.abs(to.x - from.x),
      }}
    />
  );
}
