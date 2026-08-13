import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'error';

interface UpdateInfo {
  version: string;
  body: string | undefined;
  date: string | undefined;
}

interface UpdateProgress {
  downloaded: number;
  total: number | null;
}

export interface AppUpdaterValue {
  status: UpdateStatus;
  updateInfo: UpdateInfo | null;
  progress: UpdateProgress;
  error: string | null;
  checkForUpdate: () => Promise<void>;
  downloadAndInstall: () => Promise<void>;
  restartApp: () => Promise<void>;
  dismissUpdate: () => void;
}

const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const INITIAL_DELAY_MS = 5_000; // 5s after app start
const LATEST_JSON_URL = 'https://cdn.neumar.app/latest.json';

function isTauri(): boolean {
  return '__TAURI_INTERNALS__' in window || '__TAURI__' in window;
}

/** Compare two semver-like version strings (e.g. "26.4.4"). Returns true if remote > local. */
function isNewerVersion(remote: string, local: string): boolean {
  const r = remote.replace(/^v/, '').split('.').map(Number);
  const l = local.split('.').map(Number);
  for (let i = 0; i < Math.max(r.length, l.length); i++) {
    const rv = r[i] ?? 0;
    const lv = l[i] ?? 0;
    if (rv > lv) return true;
    if (rv < lv) return false;
  }
  return false;
}

/**
 * Fallback version check: fetch latest.json directly and compare versions.
 * Used when the Tauri updater plugin fails (e.g. empty platforms) or in web mode.
 */
async function fetchLatestVersion(
  currentVersion: string,
  signal?: AbortSignal,
): Promise<UpdateInfo | null> {
  const res = await fetch(LATEST_JSON_URL, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data: unknown = await res.json();
  const remoteVersion: string =
    typeof data === 'object' &&
    data !== null &&
    'version' in data &&
    typeof (data as Record<string, unknown>).version === 'string'
      ? ((data as Record<string, unknown>).version as string)
      : '';
  if (isNewerVersion(remoteVersion, currentVersion)) {
    const rec = data as Record<string, unknown>;
    return {
      version: remoteVersion.replace(/^v/, ''),
      body: typeof rec.notes === 'string' ? rec.notes : undefined,
      date: typeof rec.pub_date === 'string' ? rec.pub_date : undefined,
    };
  }
  return null;
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string' && error.trim().length > 0) return error;
  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string' &&
    error.message.trim().length > 0
  ) {
    return error.message;
  }
  return fallback;
}

const IDLE_VALUE: AppUpdaterValue = {
  status: 'idle',
  updateInfo: null,
  progress: { downloaded: 0, total: null },
  error: null,
  checkForUpdate: async () => {},
  downloadAndInstall: async () => {},
  restartApp: async () => {},
  dismissUpdate: () => {},
};

const AppUpdaterContext = createContext<AppUpdaterValue>(IDLE_VALUE);

/**
 * Single instance of the updater logic. Only runs inside Tauri.
 */
function useAppUpdaterImpl(): AppUpdaterValue {
  const [status, setStatus] = useState<UpdateStatus>('idle');
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [progress, setProgress] = useState<UpdateProgress>({
    downloaded: 0,
    total: null,
  });
  const [error, setError] = useState<string | null>(null);

  // Store the Tauri Update object in a ref to avoid serialization issues
  const updateRef = useRef<unknown>(null);
  const dismissedVersionRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const updateInfoRef = useRef<UpdateInfo | null>(null);
  const checkInProgressRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const checkForUpdate = useCallback(async () => {
    // Version checking only makes sense inside the Tauri desktop app
    if (!isTauri()) return;
    if (checkInProgressRef.current) return;
    checkInProgressRef.current = true;

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      setStatus('checking');
      setError(null);

      // Get current app version
      let currentVersion = '0.0.0';
      if (isTauri()) {
        const { getVersion } = await import('@tauri-apps/api/app');
        currentVersion = await getVersion();
      }

      // Try Tauri updater first (supports in-app download + install)
      let handled = false;
      if (isTauri()) {
        try {
          const { check } = await import('@tauri-apps/plugin-updater');
          const result = await check();

          if (!mountedRef.current) return;

          if (result && result.version !== dismissedVersionRef.current) {
            updateRef.current = result;
            const info: UpdateInfo = {
              version: result.version,
              body: result.body,
              date: result.date,
            };
            updateInfoRef.current = info;
            setUpdateInfo(info);
            setStatus('available');
            handled = true;
          } else if (result === null) {
            // Tauri updater says current version — fall through to HTTP check
            // in case the dismissed version differs between the two paths
          }
        } catch {
          // Tauri updater failed (e.g. empty platforms in latest.json) — fall through
        }
      }

      if (!handled && mountedRef.current) {
        // Fallback: fetch latest.json directly and compare versions
        const info = await fetchLatestVersion(
          currentVersion,
          controller.signal,
        );

        if (!mountedRef.current) return;

        if (info && info.version !== dismissedVersionRef.current) {
          updateRef.current = null; // No Tauri update object — download via browser
          updateInfoRef.current = info;
          setUpdateInfo(info);
          setStatus('available');
        } else {
          setStatus('idle');
        }
      }
    } catch (e) {
      if (!mountedRef.current) return;
      setError(errorMessage(e, 'Update check failed'));
      setStatus('error');
    } finally {
      checkInProgressRef.current = false;
      controller.abort();
    }
  }, []);

  const downloadAndInstall = useCallback(async () => {
    const update = updateRef.current as {
      downloadAndInstall: (
        cb: (event: {
          event: string;
          data: { contentLength?: number; chunkLength: number };
        }) => void,
      ) => Promise<void>;
    } | null;

    // Fallback: no Tauri update object — open download page in browser
    if (!update) {
      const ua = navigator.userAgent.toLowerCase();
      const installer = ua.includes('win')
        ? 'neumar-setup.exe'
        : ua.includes('linux')
          ? 'neumar.AppImage'
          : 'neumar.dmg';
      const downloadUrl = `https://cdn.neumar.app/installer/${installer}`;
      try {
        const { openUrl } = await import('@tauri-apps/plugin-opener');
        await openUrl(downloadUrl);
      } catch {
        window.open(downloadUrl, '_blank');
      }
      return;
    }

    let didError = false;
    try {
      setStatus('downloading');
      setProgress({ downloaded: 0, total: null });
      setError(null);

      await update.downloadAndInstall((event) => {
        if (event.event === 'Started') {
          setProgress({
            downloaded: 0,
            total: event.data.contentLength ?? null,
          });
        } else if (event.event === 'Progress') {
          setProgress((prev) => ({
            ...prev,
            downloaded: prev.downloaded + event.data.chunkLength,
          }));
        } else if (event.event === 'Finished') {
          setStatus('ready');
        }
      });
      // Safety: if Finished event didn't fire, the promise resolving still means success
      setStatus((prev) => (prev === 'downloading' ? 'ready' : prev));
    } catch (e) {
      didError = true;
      setError(errorMessage(e, 'Download failed'));
      setStatus('error');
    } finally {
      // Only reset progress on error — don't overwrite 'ready' status
      if (didError) {
        setProgress({ downloaded: 0, total: null });
      }
    }
  }, []);

  const restartApp = useCallback(async () => {
    try {
      const { relaunch } = await import('@tauri-apps/plugin-process');
      await relaunch();
    } catch {
      // relaunch unavailable (dev mode or plugin not registered) — reload the webview
      window.location.reload();
    }
  }, []);

  const dismissUpdate = useCallback(() => {
    if (updateInfoRef.current) {
      dismissedVersionRef.current = updateInfoRef.current.version;
    }
    updateRef.current = null;
    updateInfoRef.current = null;
    setUpdateInfo(null);
    setStatus('idle');
  }, []);

  // Auto-check on mount and at interval — only in Tauri desktop app
  useEffect(() => {
    if (!isTauri()) return;

    mountedRef.current = true;
    const initialTimeout = setTimeout(checkForUpdate, INITIAL_DELAY_MS);
    const interval = setInterval(checkForUpdate, CHECK_INTERVAL_MS);

    return () => {
      mountedRef.current = false;
      abortControllerRef.current?.abort();
      clearTimeout(initialTimeout);
      clearInterval(interval);
    };
  }, [checkForUpdate]);

  return {
    status,
    updateInfo,
    progress,
    error,
    checkForUpdate,
    downloadAndInstall,
    restartApp,
    dismissUpdate,
  };
}

export function AppUpdaterProvider({ children }: { children: ReactNode }) {
  const value = useAppUpdaterImpl();
  return (
    <AppUpdaterContext.Provider value={value}>
      {children}
    </AppUpdaterContext.Provider>
  );
}

export function useAppUpdater(): AppUpdaterValue {
  return useContext(AppUpdaterContext);
}
