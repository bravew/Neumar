import { getNotificationPreferences } from './preferences';

export type CompletionStatus = 'succeeded' | 'failed' | 'error' | 'progress';
export type NotificationPermissionState =
  | NotificationPermission
  | 'unsupported';

export interface OsNotificationOptions {
  runId: string;
  kind: CompletionStatus;
  title: string;
  body: string;
  link?: string;
  data?: Record<string, string>;
}

export type OsNotificationResult =
  | 'shown'
  | 'unsupported'
  | 'permission-denied'
  | 'suppressed-focused'
  | 'failed';

interface PermissionOptions {
  request?: boolean;
}

interface SendOptions extends PermissionOptions {
  ignoreFocus?: boolean;
  ignorePreference?: boolean;
}

let lastTauriPermissionState: NotificationPermissionState | null = null;

function isTauri(): boolean {
  return (
    typeof window !== 'undefined' &&
    ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
  );
}

function notificationIdForRun(runId: string, kind: CompletionStatus): number {
  const input = `${runId}:${kind}`;
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (Math.imul(31, hash) + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash || 1);
}

export async function isWindowFocusedAndVisible(): Promise<boolean> {
  if (typeof document === 'undefined') return false;

  if (isTauri()) {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const currentWindow = getCurrentWindow();
      const [focused, visible] = await Promise.all([
        currentWindow.isFocused(),
        currentWindow.isVisible(),
      ]);
      return focused && visible;
    } catch {
      // Fall through to the browser signal below.
    }
  }

  return !document.hidden && document.hasFocus();
}

export async function getNotificationPermissionState(): Promise<NotificationPermissionState> {
  if (isTauri()) {
    try {
      const { isPermissionGranted } =
        await import('@tauri-apps/plugin-notification');
      if (await isPermissionGranted()) {
        lastTauriPermissionState = 'granted';
        return 'granted';
      }
      return lastTauriPermissionState === 'denied' ? 'denied' : 'default';
    } catch {
      return 'unsupported';
    }
  }

  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission;
}

export async function ensureOsPermission({
  request = false,
}: PermissionOptions = {}): Promise<boolean> {
  if (isTauri()) {
    try {
      const { isPermissionGranted, requestPermission } =
        await import('@tauri-apps/plugin-notification');
      if (await isPermissionGranted()) {
        lastTauriPermissionState = 'granted';
        return true;
      }
      if (!request) return false;
      const permission = await requestPermission();
      lastTauriPermissionState = permission;
      return permission === 'granted';
    } catch {
      return false;
    }
  }

  if (typeof Notification === 'undefined') return false;
  if (Notification.permission === 'granted') return true;
  if (!request || Notification.permission === 'denied') return false;
  return (await Notification.requestPermission()) === 'granted';
}

function browserNotificationOptions(
  opts: OsNotificationOptions,
): NotificationOptions {
  return {
    body: opts.body,
    icon: '/favicon.ico',
    tag: `neumar-agent-${opts.runId}`,
    data: {
      ...opts.data,
      kind: opts.kind,
      link: opts.link,
      runId: opts.runId,
    },
  };
}

async function dispatchNotification(
  opts: OsNotificationOptions,
): Promise<OsNotificationResult> {
  try {
    if (isTauri()) {
      const { sendNotification } =
        await import('@tauri-apps/plugin-notification');
      await sendNotification({
        id: notificationIdForRun(opts.runId, opts.kind),
        title: opts.title,
        body: opts.body,
        autoCancel: true,
        extra: {
          ...opts.data,
          kind: opts.kind,
          link: opts.link,
          runId: opts.runId,
        },
      });
      return 'shown';
    }

    if (typeof Notification === 'undefined') return 'unsupported';
    const note = new Notification(opts.title, browserNotificationOptions(opts));
    note.onclick = () => {
      if (typeof window !== 'undefined') {
        window.focus();
      }
    };
    return 'shown';
  } catch {
    return 'failed';
  }
}

export async function sendOsNotification(
  opts: OsNotificationOptions,
  {
    request = false,
    ignoreFocus = false,
    ignorePreference = false,
  }: SendOptions = {},
): Promise<OsNotificationResult> {
  if (opts.kind === 'progress') return 'unsupported';

  const prefs = getNotificationPreferences();
  if (!ignorePreference && !prefs.desktopEnabled) return 'permission-denied';

  if (!ignoreFocus) {
    const focusedAndVisible = await isWindowFocusedAndVisible();
    const mayInterrupt =
      opts.kind === 'failed' ||
      opts.kind === 'error' ||
      prefs.notifyWhileFocused;
    if (focusedAndVisible && !mayInterrupt) {
      return 'suppressed-focused';
    }
  }

  if (!(await ensureOsPermission({ request }))) {
    return 'permission-denied';
  }

  return dispatchNotification(opts);
}
