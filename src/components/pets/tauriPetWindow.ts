import type {
  PetSettingsConfig,
  PetWindowPosition,
} from '@/shared/db/settings';

export const PET_WINDOW_LABEL = 'pet-overlay';
export const PET_WINDOW_QUERY_KEY = 'neumaWindow';
export const PET_WINDOW_QUERY_VALUE = 'pet-overlay';
export const PET_WINDOW_URL = `index.html?${PET_WINDOW_QUERY_KEY}=${PET_WINDOW_QUERY_VALUE}`;
export const PET_WINDOW_WIDTH = 132;
export const PET_WINDOW_HEIGHT = 132;
export const PET_WINDOW_TRANSPARENT_COLOR = '#00000000';

export const PET_EVENT_STATE = 'neuma://pet-overlay-state';
export const PET_EVENT_PATCH = 'neuma://pet-overlay-patch';
export const PET_EVENT_OPEN_SETTINGS = 'neuma://pet-open-settings';

export interface PetWindowStatePayload {
  settings: PetSettingsConfig;
  isAgentRunning: boolean;
}

export interface PetWindowPatchPayload {
  enabled?: boolean;
  activePetId?: string;
  activePetSource?: PetSettingsConfig['activePetSource'];
  customPet?: PetSettingsConfig['customPet'];
  showAgentActivity?: boolean;
  windowPosition?: PetWindowPosition;
}

export function isTauriRuntime(): boolean {
  if (typeof window === 'undefined') return false;
  return '__TAURI_INTERNALS__' in window || '__TAURI__' in window;
}

export function isPetWindowLocation(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    new URLSearchParams(window.location.search).get(PET_WINDOW_QUERY_KEY) ===
    PET_WINDOW_QUERY_VALUE
  );
}

export function sameWindowPosition(
  a: PetWindowPosition | null | undefined,
  b: PetWindowPosition | null | undefined,
): boolean {
  if (!a || !b) return false;
  return (
    Math.round(a.x) === Math.round(b.x) && Math.round(a.y) === Math.round(b.y)
  );
}
