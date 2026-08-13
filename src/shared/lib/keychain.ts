/**
 * Keychain Wrapper
 *
 * Provides a TypeScript API around the tauri-plugin-keychain Rust plugin.
 * Falls back to localStorage (insecure) when not running in Tauri.
 *
 * In Tauri, credentials are stored in:
 *   - macOS: Keychain Services
 *   - Windows: Credential Locker
 *   - Linux: Secret Service (via libsecret)
 */

import { APP_SLUG } from '@/config/branding';

const PREFIX = `${APP_SLUG}.auth`;

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

async function invoke<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
  return tauriInvoke<T>(cmd, args);
}

/**
 * Save a value to the secure keychain.
 */
export async function saveKeychainItem(
  key: string,
  value: string,
): Promise<void> {
  const fullKey = `${PREFIX}.${key}`;

  if (isTauri()) {
    try {
      await invoke('plugin:keychain|save_item', {
        key: fullKey,
        password: value,
      });
      return;
    } catch {
      // Keychain plugin unavailable — fall through to localStorage
    }
  }

  // Fallback: localStorage (vault password is not sensitive on its own —
  // the vault's AES-256-GCM + Argon2 encryption still protects the keys)
  try {
    localStorage.setItem(fullKey, value);
  } catch {
    // Ignore
  }
}

/**
 * Retrieve a value from the secure keychain.
 */
export async function getKeychainItem(key: string): Promise<string | null> {
  const fullKey = `${PREFIX}.${key}`;

  if (isTauri()) {
    try {
      const result = await invoke<string | null>('plugin:keychain|get_item', {
        key: fullKey,
      });
      if (result != null) return result;
    } catch {
      // Keychain plugin unavailable — fall through to localStorage
    }
  }

  // Fallback: localStorage
  try {
    return localStorage.getItem(fullKey);
  } catch {
    return null;
  }
}

/**
 * Remove a value from the secure keychain.
 */
export async function removeKeychainItem(key: string): Promise<void> {
  const fullKey = `${PREFIX}.${key}`;

  if (isTauri()) {
    try {
      await invoke('plugin:keychain|remove_item', { key: fullKey });
      return;
    } catch {
      // Keychain plugin unavailable — fall through to localStorage
    }
  }

  // Fallback: localStorage
  try {
    localStorage.removeItem(fullKey);
  } catch {
    // Ignore
  }
}
