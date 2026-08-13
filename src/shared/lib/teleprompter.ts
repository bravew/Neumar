export const TELEPROMPTER_WINDOW_LABEL = 'teleprompter';
export const TELEPROMPTER_WINDOW_QUERY_KEY = 'neumaWindow';
export const TELEPROMPTER_WINDOW_QUERY_VALUE = 'teleprompter';
export const TELEPROMPTER_EVENT_STATE = 'neuma://teleprompter-state';
export const TELEPROMPTER_EVENT_CONTROL = 'neuma://teleprompter-control';

export interface TeleprompterStatePayload {
  script: string;
  wpm: number;
  fontSize: number;
  mirror: boolean;
  opacity: number;
  running: boolean;
  elapsedMs: number;
}

export type TeleprompterControlPayload =
  | { type: 'start'; elapsedMs: number }
  | { type: 'pause'; elapsedMs: number }
  | { type: 'reset' };

export interface TeleprompterWindowResult {
  label: string;
  created: boolean;
}

export function isTeleprompterLocation(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    new URLSearchParams(window.location.search).get(
      TELEPROMPTER_WINDOW_QUERY_KEY,
    ) === TELEPROMPTER_WINDOW_QUERY_VALUE
  );
}

export function isTauriRuntime(): boolean {
  if (typeof window === 'undefined') return false;
  return '__TAURI_INTERNALS__' in window || '__TAURI__' in window;
}

export async function openTeleprompterWindow(
  state: TeleprompterStatePayload,
): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke<TeleprompterWindowResult>('open_teleprompter', {
    input: {
      title: 'Teleprompter',
      width: 760,
      height: 520,
      alwaysOnTop: true,
    },
  });
  await emitTeleprompterState(state);
  window.setTimeout(() => void emitTeleprompterState(state), 250);
  return true;
}

export async function closeTeleprompterWindow(): Promise<void> {
  if (!isTauriRuntime()) return;
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('close_teleprompter');
}

export async function emitTeleprompterState(
  state: TeleprompterStatePayload,
): Promise<void> {
  if (!isTauriRuntime()) return;
  const { emitTo } = await import('@tauri-apps/api/event');
  await emitTo(TELEPROMPTER_WINDOW_LABEL, TELEPROMPTER_EVENT_STATE, state);
}

export async function emitTeleprompterControl(
  control: TeleprompterControlPayload,
): Promise<void> {
  if (!isTauriRuntime()) return;
  const { emitTo } = await import('@tauri-apps/api/event');
  await emitTo(TELEPROMPTER_WINDOW_LABEL, TELEPROMPTER_EVENT_CONTROL, control);
}
