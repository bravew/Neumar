import { useEffect, useRef, useState } from 'react';

import {
  generateNonce,
  SANDBOX_ATTR,
  wrapFullDocumentSrcdoc,
} from '@/components/artifacts/live/iframe-sandbox';
import type { DesignSystemRecord } from '@/shared/types/design-mode';

import { loadShowcaseHtml, peekShowcaseHtml } from './design-system-html';
import { DesignSystemThumb } from './DesignSystemPreview';

/**
 * Logical render width of the off-screen design. The system's `components.html`
 * is authored for a desktop viewport; we render it at this width and scale the
 * whole iframe down to the card so the hero looks like a real shrunk page
 * rather than a cramped mobile layout. The box is 4:3 to match
 * {@link DesignSystemThumb}, the fallback shown while the preview loads.
 */
const DESIGN_WIDTH = 1280;
const DESIGN_HEIGHT = (DESIGN_WIDTH * 3) / 4;

/**
 * Live design-system preview for a catalog card (Open Design `/design-systems`
 * grid parity). Lazily renders the system's real `components.html` in a scaled,
 * sandboxed, null-origin iframe once the card scrolls into view — falling back
 * to the synthetic {@link DesignSystemThumb} while loading or when a system has
 * no authored preview. Isolation: `allow-scripts` without `allow-same-origin`
 * plus the injected CSP (`connect-src 'none'`) — the content is trusted local
 * catalog HTML, but it still can't reach the host or exfiltrate.
 */
export function DesignSystemLivePreview({
  system,
  testId,
}: {
  system: DesignSystemRecord;
  testId?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const nonce = useRef(generateNonce()).current;
  const [visible, setVisible] = useState(false);
  const [html, setHtml] = useState<string | null>(
    () => peekShowcaseHtml(system.id) ?? null,
  );
  const [scale, setScale] = useState(0.25);

  // Lazy trigger: only fetch + mount the iframe once the card nears the
  // viewport, so a 150-system grid doesn't spawn 150 iframes at once.
  useEffect(() => {
    const node = containerRef.current;
    if (!node || visible) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [visible]);

  // Scale the off-screen design down to the card's current width.
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

  // Fetch the generated showcase once visible.
  useEffect(() => {
    if (!visible || html !== null || peekShowcaseHtml(system.id) === null)
      return;
    let cancelled = false;
    loadShowcaseHtml(system.id)
      .then((next) => {
        if (!cancelled && next) setHtml(next);
      })
      .catch(() => {
        // Network error — keep the thumb fallback.
      });
    return () => {
      cancelled = true;
    };
  }, [visible, html, system.id]);

  const showLive = visible && Boolean(html);

  return (
    <div
      ref={containerRef}
      className="bg-muted relative aspect-[4/3] overflow-hidden border-b"
      data-testid={testId}
    >
      {/* Fallback hero — always rendered underneath; the live iframe paints
          over it once ready, so there's no flash of empty space. */}
      <div className="absolute inset-0">
        <DesignSystemThumb system={system} />
      </div>
      {showLive && (
        <iframe
          title={system.title}
          srcDoc={wrapFullDocumentSrcdoc(html as string, nonce)}
          sandbox={SANDBOX_ATTR}
          scrolling="no"
          tabIndex={-1}
          aria-hidden
          className="absolute top-0 left-0 origin-top-left border-0 bg-white"
          style={{
            width: DESIGN_WIDTH,
            height: DESIGN_HEIGHT,
            transform: `scale(${scale})`,
            pointerEvents: 'none',
          }}
        />
      )}
    </div>
  );
}
