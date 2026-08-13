import { useEffect, useRef, useState } from 'react';

import { cn } from '@/shared/lib/utils';

import {
  acceptMessage,
  type InspectStylePatch,
  SANDBOX_ATTR,
} from './iframe-sandbox';
import type { PaletteBridgeRequest } from './palette-bridge';

interface IframeSandboxProps {
  /** Full HTML document; caller embeds CSP + bootstrap via `wrapHtmlSrcdoc`. */
  srcdoc: string;
  /** Nonce embedded in `srcdoc`'s bootstrap; messages must echo it back. */
  nonce: string;
  /**
   * Stable React key — pass the artifact id, NOT id@version. Streaming
   * `append` events bump the version every chunk; keying by version
   * unmounts and remounts the iframe each time, causing visible flashes.
   * srcDoc updates already drive the in-frame document reload.
   */
  identity: string;
  onMessage?: (msg: { type: 'event' | 'request'; payload: unknown }) => void;
  title?: string;
  inspectPatch?: InspectStylePatch | null;
  paletteRequest?: PaletteBridgeRequest | null;
  onFrameRef?: (node: HTMLIFrameElement | null) => void;
  /**
   * Fixed iframe height in px. When set (device-preset preview: Phone/Tablet/
   * Desktop), the iframe is exactly this tall and scrolls internally — so a
   * `100vh`/`100%` document resolves against a real viewport instead of the
   * self-referential auto-measured height, which collapses such layouts. When
   * omitted (Auto mode / embedded bubbles), height auto-fits to content.
   */
  fixedHeight?: number;
}

const MAX_HEIGHT = 4000;
const SHELL_READY_WATCHDOG_MS = 2000;

export function IframeSandbox({
  srcdoc,
  nonce,
  identity,
  onMessage,
  title = 'live artifact',
  inspectPatch,
  paletteRequest,
  onFrameRef,
  fixedHeight,
}: IframeSandboxProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const shellReadyRef = useRef(false);
  const shellReadyGenerationRef = useRef(0);
  const [height, setHeight] = useState(120);
  const [transportReady, setTransportReady] = useState(false);

  useEffect(() => {
    const generation = shellReadyGenerationRef.current + 1;
    shellReadyGenerationRef.current = generation;
    shellReadyRef.current = false;
    setTransportReady(false);

    const timer = window.setTimeout(() => {
      if (
        shellReadyGenerationRef.current !== generation ||
        shellReadyRef.current
      ) {
        return;
      }
      console.warn('[LiveArtifact] shell_ready_timeout', {
        degraded: true,
        watchdogMs: SHELL_READY_WATCHDOG_MS,
      });
      setTransportReady(true);
    }, SHELL_READY_WATCHDOG_MS);

    return () => window.clearTimeout(timer);
  }, [identity, nonce, srcdoc]);

  useEffect(() => {
    function listener(event: MessageEvent) {
      const accepted = acceptMessage(
        event,
        iframeRef.current?.contentWindow ?? null,
        nonce,
      );
      if (!accepted) return;
      if (accepted.type === 'resize' && typeof accepted.height === 'number') {
        setHeight(Math.min(accepted.height, MAX_HEIGHT));
        return;
      }
      if (accepted.type === 'shell:ready') {
        shellReadyRef.current = true;
        setTransportReady(true);
        return;
      }
      if (accepted.type === 'event' || accepted.type === 'request') {
        onMessage?.({ type: accepted.type, payload: accepted.payload });
      }
    }
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, [nonce, onMessage]);

  useEffect(() => {
    if (!inspectPatch || !transportReady) return;
    iframeRef.current?.contentWindow?.postMessage(
      {
        nonce,
        type: 'neuma-inspect-style',
        patch: inspectPatch,
      },
      '*',
    );
  }, [inspectPatch, nonce, transportReady]);

  useEffect(() => {
    if (!paletteRequest || !transportReady) return;
    iframeRef.current?.contentWindow?.postMessage(
      {
        nonce,
        ...paletteRequest,
      },
      '*',
    );
  }, [paletteRequest, nonce, transportReady]);

  return (
    <iframe
      key={identity}
      ref={(node) => {
        iframeRef.current = node;
        onFrameRef?.(node);
      }}
      sandbox={SANDBOX_ATTR}
      srcDoc={srcdoc}
      title={title}
      className={cn('block w-full border-0 bg-transparent')}
      style={{ height: fixedHeight ?? height }}
      scrolling={fixedHeight != null ? 'auto' : 'no'}
      referrerPolicy="no-referrer"
    />
  );
}
