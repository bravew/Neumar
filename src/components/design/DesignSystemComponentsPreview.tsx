/**
 * DesignSystemComponentsPreview — a scaled, sandboxed live preview of a design
 * system's bundled `components.html` reference fixture (the same artifact the
 * plugin marketplace card renders), so the applied-system preview in the
 * project matches how the system looks on its plugin card.
 *
 * Falls back to the synthetic {@link DesignSystemThumb} while the HTML loads or
 * when a system has no authored components fixture.
 */

import { useEffect, useRef, useState } from 'react';

import {
  generateNonce,
  SANDBOX_ATTR,
  wrapFullDocumentSrcdoc,
} from '@/components/artifacts/live/iframe-sandbox';
import { cn } from '@/shared/lib/utils';
import type { DesignSystemRecord } from '@/shared/types/design-mode';

import { useDesignSystemComponentsHtml } from './design-system-html';
import { DesignSystemThumb } from './DesignSystemPreview';

const DESIGN_WIDTH = 1280;
const DESIGN_HEIGHT = (DESIGN_WIDTH * 3) / 4;

export function DesignSystemComponentsPreview({
  system,
  className,
}: {
  system: DesignSystemRecord;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const nonce = useRef(generateNonce()).current;
  const { html } = useDesignSystemComponentsHtml(system);
  const [scale, setScale] = useState(0.25);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const apply = () => {
      const width = node.clientWidth;
      if (width > 0) setScale(width / DESIGN_WIDTH);
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={containerRef}
      className={cn(
        'bg-muted relative aspect-[4/3] w-full overflow-hidden',
        className,
      )}
    >
      {/* Synthetic fallback underneath; the live iframe paints over it. */}
      <div className="absolute inset-0">
        <DesignSystemThumb system={system} />
      </div>
      {html ? (
        <iframe
          title={system.title}
          srcDoc={wrapFullDocumentSrcdoc(html, nonce)}
          sandbox={SANDBOX_ATTR}
          scrolling="no"
          tabIndex={-1}
          aria-hidden
          className="absolute top-0 left-0 origin-top-left border-0 bg-white"
          style={{
            width: DESIGN_WIDTH,
            height: DESIGN_HEIGHT,
            // Inline (beats the `.design-split iframe { max-width: 100% }`
            // rule) so the 1280px logical width survives and scales cleanly
            // instead of collapsing to the container width.
            maxWidth: 'none',
            transform: `scale(${scale})`,
            pointerEvents: 'none',
          }}
        />
      ) : null}
    </div>
  );
}
