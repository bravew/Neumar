import { SETTINGS_CATEGORIES, type SettingsCategory } from './types';

export const SETTINGS_DISMISSED_EVENT = 'settings-dismissed';

export function openSettings(category?: SettingsCategory) {
  window.dispatchEvent(new CustomEvent('open-settings', { detail: category }));
}

export function isSettingsCategory(value: unknown): value is SettingsCategory {
  return SETTINGS_CATEGORIES.some((category) => category === value);
}
