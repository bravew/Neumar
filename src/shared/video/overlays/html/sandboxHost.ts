import {
  instantiateOverlayDocument,
  type OverlayInstantiation,
} from '@neumar/video-ir';

// Iframe host for pure-HTML vivid overlays. The overlay document renders in
// an iframe layered above the preview canvas (never rasterized per frame) and
// is driven by the compositor clock through the seek shim's postMessage
// protocol. Preview and export run the exact same shim, which is what makes
// preview == export.
//
// Trust model: built-in preset documents are first-party code, so they run
// same-origin (required for future on-demand rasterization); plugin-pack
// documents get the strict `allow-scripts`-only sandbox (opaque origin — the
// parent cannot reach in, and the document cannot reach out; its CSP already
// blocks all network).

export interface OverlaySandboxHostOptions {
  container: HTMLElement;
  /** Output of compileOverlayDocument().html; instantiated with `instantiation`. */
  compiledHtml?: string;
  instantiation?: OverlayInstantiation;
  /** Alternatively, a fully instantiated document (skips instantiation). */
  srcdoc?: string;
  /** Built-in presets: true. Plugin-pack documents: false. */
  trusted?: boolean;
  readyTimeoutMs?: number;
  seekTimeoutMs?: number;
}

export interface OverlaySandboxHost {
  readonly iframe: HTMLIFrameElement;
  /** Resolves once the document announced neuma-overlay-ready (fonts loaded). */
  readonly ready: Promise<void>;
  /** Seek the document to tMs; resolves after the document's two-rAF settle. */
  seek(tMs: number): Promise<void>;
  dispose(): void;
}

interface PendingSeek {
  resolve: () => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export function createOverlaySandboxHost(
  options: OverlaySandboxHostOptions,
): OverlaySandboxHost {
  const {
    container,
    compiledHtml,
    instantiation,
    srcdoc,
    trusted = false,
    readyTimeoutMs = 5000,
    seekTimeoutMs = 2000,
  } = options;
  const documentHtml =
    srcdoc ??
    (compiledHtml && instantiation
      ? instantiateOverlayDocument(compiledHtml, instantiation)
      : null);
  if (documentHtml === null) {
    throw new Error(
      'createOverlaySandboxHost needs either srcdoc or compiledHtml + instantiation',
    );
  }

  const iframe = document.createElement('iframe');
  iframe.setAttribute(
    'sandbox',
    trusted ? 'allow-scripts allow-same-origin' : 'allow-scripts',
  );
  iframe.setAttribute('aria-hidden', 'true');
  iframe.tabIndex = -1;
  Object.assign(iframe.style, {
    position: 'absolute',
    inset: '0',
    width: '100%',
    height: '100%',
    border: '0',
    background: 'transparent',
    pointerEvents: 'none',
    colorScheme: 'normal',
  });

  let disposed = false;
  let seq = 0;
  const pendingSeeks = new Map<number, PendingSeek>();

  let readyResolve!: () => void;
  let readyReject!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  const readyTimer = setTimeout(() => {
    readyReject(new Error('Overlay document did not become ready in time'));
  }, readyTimeoutMs);

  const onMessage = (event: MessageEvent) => {
    if (event.source !== iframe.contentWindow) return;
    const data = event.data as
      | { type?: string; seq?: number }
      | null
      | undefined;
    if (!data || typeof data !== 'object') return;
    if (data.type === 'neuma-overlay-ready') {
      clearTimeout(readyTimer);
      readyResolve();
      return;
    }
    if (data.type === 'neuma-overlay-seeked' && typeof data.seq === 'number') {
      const pending = pendingSeeks.get(data.seq);
      if (!pending) return;
      pendingSeeks.delete(data.seq);
      clearTimeout(pending.timer);
      pending.resolve();
    }
  };
  window.addEventListener('message', onMessage);

  iframe.srcdoc = documentHtml;
  container.appendChild(iframe);
  const seekTargetOrigin = trusted ? window.location.origin : '*';

  // Swallow the timeout rejection when nobody awaits ready before dispose.
  ready.catch(() => {});

  const seek = async (tMs: number): Promise<void> => {
    if (disposed) throw new Error('Overlay host is disposed');
    await ready;
    // dispose() may have run while awaiting ready — never register a pending
    // seek on a disposed host or it can only ever time out.
    if (disposed) throw new Error('Overlay host is disposed');
    const target = iframe.contentWindow;
    if (!target) throw new Error('Overlay iframe has no content window');
    seq += 1;
    const currentSeq = seq;
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingSeeks.delete(currentSeq);
        reject(new Error(`Overlay seek timed out (t=${tMs}ms)`));
      }, seekTimeoutMs);
      pendingSeeks.set(currentSeq, { resolve, reject, timer });
      target.postMessage(
        { type: 'neuma-overlay-seek', tMs, seq: currentSeq },
        seekTargetOrigin,
      );
    });
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    clearTimeout(readyTimer);
    window.removeEventListener('message', onMessage);
    for (const pending of pendingSeeks.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Overlay host disposed'));
    }
    pendingSeeks.clear();
    iframe.remove();
  };

  return { iframe, ready, seek, dispose };
}
