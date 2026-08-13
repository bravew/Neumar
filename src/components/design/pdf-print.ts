import type { ArtifactPdfInput } from '@/shared/hooks/useDesignMode';

const PRINT_READY_MESSAGE = 'neuma:print-ready';
const PRINT_FALLBACK_MS = 1200;
const PRINT_CLEANUP_MS = 1000;
const PRINT_MEASURE_RETRY_MS = 50;

export async function printArtifactPdfInput(
  input: ArtifactPdfInput,
): Promise<void> {
  if (await printArtifactPdfInputWithTauri(input)) return;
  await printArtifactPdfInputWithFrame(input);
}

async function printArtifactPdfInputWithTauri(
  input: ArtifactPdfInput,
): Promise<boolean> {
  if (!isTauriRuntime()) return false;

  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('export_artifact_pdf_input', { input });
    return true;
  } catch {
    // Fall back to the cross-platform print dialog when byte export is not available.
  }

  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('print_artifact_pdf_input', { input });
    return true;
  } catch {
    return false;
  }
}

function isTauriRuntime(): boolean {
  if (typeof window === 'undefined') return false;
  const candidate = window as typeof window & {
    __TAURI__?: unknown;
    __TAURI_INTERNALS__?: unknown;
  };
  return Boolean(candidate.__TAURI__ || candidate.__TAURI_INTERNALS__);
}

export function isUsablePrintSize(width: number, height: number): boolean {
  return (
    Number.isFinite(width) && Number.isFinite(height) && width > 1 && height > 1
  );
}

function frameHasUsablePrintSize(iframe: HTMLIFrameElement): boolean {
  try {
    const doc = iframe.contentDocument;
    if (!doc) return false;

    const root = doc.documentElement;
    const body = doc.body;
    const width = Math.max(
      root?.scrollWidth ?? 0,
      body?.scrollWidth ?? 0,
      root?.clientWidth ?? 0,
      body?.clientWidth ?? 0,
    );
    const height = Math.max(
      root?.scrollHeight ?? 0,
      body?.scrollHeight ?? 0,
      root?.clientHeight ?? 0,
      body?.clientHeight ?? 0,
    );
    return isUsablePrintSize(width, height);
  } catch {
    return false;
  }
}

async function printArtifactPdfInputWithFrame(
  input: ArtifactPdfInput,
): Promise<void> {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    throw new Error('PDF printing is only available in a browser window');
  }

  const iframe = document.createElement('iframe');
  iframe.title = input.title || input.defaultFilename;
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '1px';
  iframe.style.height = '1px';
  iframe.style.border = '0';
  iframe.style.opacity = '0';
  iframe.setAttribute('aria-hidden', 'true');

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let fallbackTimer: number | undefined;
    let measureTimer: number | undefined;

    const cleanupListeners = () => {
      window.removeEventListener('message', onMessage);
      iframe.removeEventListener('load', onLoad);
      if (fallbackTimer !== undefined) window.clearTimeout(fallbackTimer);
      if (measureTimer !== undefined) window.clearTimeout(measureTimer);
    };
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      cleanupListeners();
      fn();
    };
    const triggerPrint = () => {
      const target = iframe.contentWindow;
      if (!target) {
        settle(() => reject(new Error('PDF print frame failed to load')));
        return;
      }
      try {
        target.focus();
        target.print();
        window.setTimeout(() => iframe.remove(), PRINT_CLEANUP_MS);
        settle(resolve);
      } catch (error) {
        iframe.remove();
        settle(() =>
          reject(error instanceof Error ? error : new Error(String(error))),
        );
      }
    };
    const schedulePrintWhenUsable = (force = false) => {
      if (settled) return;
      if (force || frameHasUsablePrintSize(iframe)) {
        triggerPrint();
        return;
      }
      if (measureTimer !== undefined) window.clearTimeout(measureTimer);
      measureTimer = window.setTimeout(
        () => schedulePrintWhenUsable(false),
        PRINT_MEASURE_RETRY_MS,
      );
    };
    const onMessage = (event: MessageEvent) => {
      if (
        event.source === iframe.contentWindow &&
        event.data === PRINT_READY_MESSAGE
      ) {
        schedulePrintWhenUsable();
      }
    };
    const onLoad = () => {
      fallbackTimer = window.setTimeout(
        () => schedulePrintWhenUsable(true),
        PRINT_FALLBACK_MS,
      );
    };

    window.addEventListener('message', onMessage);
    iframe.addEventListener('load', onLoad);
    document.body.append(iframe);
    iframe.srcdoc = input.html;
  });
}
