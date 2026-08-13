import { useDeferredValue, useMemo } from 'react';

import { cn } from '@/shared/lib/utils';

import { wrapHtmlFrameSrcdoc } from './html-frame-srcdoc';
import { generateNonce } from './iframe-sandbox';
import { IframeSandbox } from './IframeSandbox';

interface HtmlFramePreviewProps {
  /** Full HTML from the template's `source/index.html`. */
  rawHtml: string;
  /** Variable map injected at `window.__NEUMA_VARS__`. */
  variables: Record<string, unknown>;
  /**
   * Stable identity (template id + node id). Same caveat as IframeSandbox:
   * do NOT include a version that bumps on every variable change, or the
   * iframe will remount and flash.
   */
  identity: string;
  /** When `posterUrl` is set and `mode === 'poster'`, render the still instead. */
  posterUrl?: string;
  /** Toggle between live iframe and the rendered still. */
  mode?: 'live' | 'poster';
  className?: string;
  title?: string;
}

// Phase 6 M1 — HTML-frame preview surface.
//
// Thin wrapper over IframeSandbox. Reuses the existing sandbox security
// model (no `allow-same-origin`, nonce-validated postMessage, meta CSP)
// instead of rolling its own. The only template-specific piece is the
// srcdoc wrapper that injects `window.__NEUMA_VARS__`.
//
// Variable changes flow through `useDeferredValue` so a fast typist in the
// variable form doesn't tear down the iframe on every keystroke — React's
// concurrent scheduler coalesces high-frequency updates into a single
// srcdoc rebuild.
export function HtmlFramePreview({
  rawHtml,
  variables,
  identity,
  posterUrl,
  mode = 'live',
  className,
  title = 'html-frame preview',
}: HtmlFramePreviewProps) {
  const deferredVariables = useDeferredValue(variables);
  const deferredHtml = useDeferredValue(rawHtml);

  const nonce = useMemo(() => generateNonce(), [identity]);

  const srcdoc = useMemo(
    () =>
      wrapHtmlFrameSrcdoc({
        rawHtml: deferredHtml,
        nonce,
        variables: deferredVariables,
      }),
    [deferredHtml, deferredVariables, nonce],
  );

  if (mode === 'poster' && posterUrl) {
    return (
      <img
        src={posterUrl}
        alt={title}
        className={cn('block w-full', className)}
      />
    );
  }

  return (
    <div className={cn('block w-full', className)}>
      <IframeSandbox
        srcdoc={srcdoc}
        nonce={nonce}
        identity={identity}
        title={title}
      />
    </div>
  );
}
