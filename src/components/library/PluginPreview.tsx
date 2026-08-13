/**
 * PluginPreview — a live, scaled, sandboxed preview of a design-system
 * plugin's bundled `components.html` (served by `/plugins/:id/preview`).
 * Mirrors DesignSystemLivePreview: the desktop-authored page renders at a
 * fixed logical width in a null-origin iframe and is scaled down to the box,
 * so it reads as a shrunk page rather than a cramped mobile layout.
 *
 * Isolation: `allow-scripts` without `allow-same-origin` plus the injected CSP
 * — trusted local plugin HTML that still cannot reach the host.
 */

import { useEffect, useRef, useState } from 'react';

import {
  generateNonce,
  SANDBOX_ATTR,
  wrapFullDocumentSrcdoc,
} from '@/components/artifacts/live/iframe-sandbox';
import { API_BASE_URL } from '@/config';

const DESIGN_WIDTH = 1280;
const DESIGN_HEIGHT = (DESIGN_WIDTH * 3) / 4;

export function PluginPreview({
  pluginId,
  onUnavailable,
}: {
  pluginId: string;
  /** Called when the plugin has no preview so the parent can hide the section. */
  onUnavailable?: () => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const nonce = useRef(generateNonce()).current;
  const [html, setHtml] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [visible, setVisible] = useState(false);
  const [scale, setScale] = useState(0.4);

  // Lazy trigger: only fetch + mount the iframe once the card nears the
  // viewport, so a grid of design systems doesn't spawn every iframe at once.
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

  useEffect(() => {
    if (!visible) return;
    const ac = new AbortController();
    let cancelled = false;
    setHtml(null);
    setFailed(false);
    fetch(`${API_BASE_URL}/plugins/${encodeURIComponent(pluginId)}/preview`, {
      signal: ac.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        return res.text();
      })
      .then((text) => {
        if (!cancelled) setHtml(text);
      })
      .catch(() => {
        if (cancelled || ac.signal.aborted) return;
        setFailed(true);
        onUnavailable?.();
      });
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [pluginId, visible, onUnavailable]);

  // Scale the fixed-width design down to the container.
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

  if (failed) return null;

  return (
    <div
      ref={containerRef}
      className="bg-muted relative aspect-[4/3] w-full overflow-hidden rounded-md border"
      data-testid="plugin-preview"
    >
      {html ? (
        <iframe
          title="preview"
          srcDoc={wrapFullDocumentSrcdoc(html, nonce)}
          sandbox={SANDBOX_ATTR}
          scrolling="no"
          tabIndex={-1}
          aria-hidden
          className="absolute top-0 left-0 origin-top-left border-0 bg-white"
          style={{
            width: DESIGN_WIDTH,
            height: DESIGN_HEIGHT,
            // Inline so an ancestor `iframe { max-width: 100% }` rule can't
            // collapse the 1280px logical width and the scaled preview.
            maxWidth: 'none',
            transform: `scale(${scale})`,
            pointerEvents: 'none',
          }}
        />
      ) : (
        <div className="text-muted-foreground absolute inset-0 flex items-center justify-center text-xs">
          …
        </div>
      )}
    </div>
  );
}
