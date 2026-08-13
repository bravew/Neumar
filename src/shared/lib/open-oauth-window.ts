import { randomUUID } from '@/shared/utils/uuid';

import { openExternalUrl } from './open-external-url';

export interface OAuthWindowHandle {
  /** Navigate the pre-opened popup to the resolved authorization URL. */
  load: (url: string) => Promise<void>;
  /** Closes the popup if it is still open. Safe to call multiple times. */
  close: () => Promise<void>;
}

function isTauriRuntime(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as Record<string, unknown>;
  return Boolean(w.__TAURI_INTERNALS__ ?? w.__TAURI__ ?? w.__TAURI_IPC__);
}

interface TauriWebviewLike {
  close(): Promise<void>;
}

async function openTauriWebview(
  url: string,
  options: { label?: string; title?: string },
): Promise<TauriWebviewLike | null> {
  try {
    const mod = await import('@tauri-apps/api/webviewWindow');
    const label = options.label ?? `oauth-${randomUUID()}`;
    // If a previous popup with the same label is still hanging around, close
    // it so Tauri doesn't refuse the new window.
    try {
      const existing = await mod.WebviewWindow.getByLabel(label);
      if (existing) await existing.close();
    } catch {
      /* no prior window */
    }
    const popup = new mod.WebviewWindow(label, {
      url,
      title: options.title ?? 'Authorize',
      width: 520,
      height: 720,
      resizable: true,
      focus: true,
      center: true,
    });
    // Wait for creation to settle so we surface IPC errors here instead of
    // silently leaving the user without a popup. Created vs error fires on
    // the WebviewWindow event channel.
    await new Promise<void>((resolve, reject) => {
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        resolve();
      }, 1500);
      popup.once('tauri://created', () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve();
      });
      popup.once('tauri://error', (event: { payload: unknown }) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        reject(
          new Error(
            typeof event.payload === 'string'
              ? event.payload
              : JSON.stringify(event.payload),
          ),
        );
      });
    });
    return popup;
  } catch (err) {
    if (import.meta.env.DEV) {
      console.error(
        '[openOAuthWindow] Tauri WebviewWindow failed, falling back to external browser',
        err,
      );
    }
    return null;
  }
}

/**
 * Open an OAuth popup. Returns a handle with `load(url)` that navigates the
 * window once the redirect URL is known.
 *
 * Browser: pre-opens `window.open('', '_blank')` synchronously so the popup
 * blocker keeps the gesture intact, then assigns `location.href` on load.
 * Tauri: defers creation to load(), opens an in-app `WebviewWindow`, and on
 * failure falls back to the system browser via the opener plugin.
 */
export function openOAuthWindow(
  options: { label?: string; title?: string } = {},
): OAuthWindowHandle {
  if (isTauriRuntime()) {
    let popupRef: TauriWebviewLike | null = null;
    return {
      load: async (url: string) => {
        popupRef = await openTauriWebview(url, options);
        if (!popupRef) await openExternalUrl(url);
      },
      close: async () => {
        if (!popupRef) return;
        try {
          await popupRef.close();
        } catch {
          /* already closed */
        }
      },
    };
  }

  // Browser path: pre-open synchronously so the popup blocker keeps the user
  // gesture intact, then assign location.href once we know where to go.
  const popup =
    typeof window === 'undefined'
      ? null
      : window.open('', options.label ?? '_blank');

  return {
    load: async (url: string) => {
      if (popup && !popup.closed) {
        try {
          popup.location.href = url;
        } catch {
          await openExternalUrl(url);
        }
        return;
      }
      await openExternalUrl(url);
    },
    close: async () => {
      try {
        popup?.close();
      } catch {
        /* already closed */
      }
    },
  };
}
