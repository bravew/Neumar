import { useDeferredValue, useMemo, useRef } from 'react';

import DOMPurify from 'dompurify';

import {
  generateNonce,
  type InspectStylePatch,
  type SelectBridgeMode,
  wrapFullDocumentSrcdoc,
  wrapHtmlSrcdoc,
} from './iframe-sandbox';
import { IframeSandbox } from './IframeSandbox';
import type { PaletteBridgeRequest } from './palette-bridge';

interface HtmlSandboxProps {
  html: string;
  identity: string;
  title?: string;
  onMessage?: (msg: { type: 'event' | 'request'; payload: unknown }) => void;
  selectBridgeMode?: SelectBridgeMode;
  inspectPatch?: InspectStylePatch | null;
  paletteBridge?: string;
  initialPalette?: PaletteBridgeRequest | null;
  paletteRequest?: PaletteBridgeRequest | null;
  onFrameRef?: (node: HTMLIFrameElement | null) => void;
  /**
   * Render the artifact as a full document — keep its `<head>`/`<style>` and run
   * its inline `<script>` (e.g. canvas charts). For trusted local artifacts like
   * DesignMode prototypes; the null-origin sandbox + `connect-src 'none'` CSP
   * contain the scripts. Default false keeps the strict body-only sanitize for
   * untrusted/embedded HTML (task bubbles, etc.).
   */
  renderFullDocument?: boolean;
  /** Fixed iframe height for device-preset previews — see IframeSandbox. */
  fixedHeight?: number;
}

const FORBID_HANDLERS = [
  'onerror',
  'onload',
  'onclick',
  'onmouseover',
  'onmouseenter',
  'onfocus',
];

export function HtmlSandbox({
  html,
  identity,
  title,
  onMessage,
  selectBridgeMode = 'off',
  inspectPatch,
  paletteBridge,
  initialPalette,
  paletteRequest,
  onFrameRef,
  renderFullDocument = false,
  fixedHeight,
}: HtmlSandboxProps) {
  // Stable nonce per iframe lifecycle; iframe is keyed by identity so a
  // version bump remounts and re-rolls the nonce naturally.
  const nonce = useRef(generateNonce()).current;

  // Coalesce streaming chunks so we don't re-sanitize+re-render on every
  // sub-100ms append.
  const deferredHtml = useDeferredValue(html);

  const srcdoc = useMemo(() => {
    const opts = {
      paletteBridge,
      initialPalette: initialPalette ?? undefined,
    };
    // Trusted local full-document artifact (e.g. a DesignMode prototype with a
    // styled dashboard + canvas charts): render it as authored, injecting the
    // CSP + bridge into its own head/body so its scripts execute. We do NOT run
    // it through DOMPurify — that mangles/partially-strips inline JS, breaking
    // charts. Isolation comes from the null-origin sandbox (no allow-same-origin
    // → can't reach the host) + the `connect-src 'none'` CSP (can't exfiltrate),
    // which is exactly what the sandbox is for.
    if (renderFullDocument) {
      return wrapFullDocumentSrcdoc(
        deferredHtml,
        nonce,
        selectBridgeMode,
        opts,
      );
    }
    // Untrusted/embedded HTML (task bubbles, etc.): strip event handlers and
    // dangerous tags, then wrap as a body fragment in the sandbox shell.
    const clean = String(
      DOMPurify.sanitize(deferredHtml, { FORBID_ATTR: FORBID_HANDLERS }),
    );
    return wrapHtmlSrcdoc(clean, nonce, selectBridgeMode, opts);
  }, [
    deferredHtml,
    initialPalette,
    nonce,
    paletteBridge,
    renderFullDocument,
    selectBridgeMode,
  ]);

  return (
    <IframeSandbox
      srcdoc={srcdoc}
      nonce={nonce}
      identity={identity}
      title={title ?? 'html artifact'}
      onMessage={onMessage}
      inspectPatch={inspectPatch}
      paletteRequest={paletteRequest}
      onFrameRef={onFrameRef}
      fixedHeight={fixedHeight}
    />
  );
}
