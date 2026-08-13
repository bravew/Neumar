/**
 * Stronghold — encrypted vault for API keys.
 *
 * Security model (two layers):
 *   OS Keychain → vault password → Stronghold vault → API keys
 *
 * - The vault password is a random 32-byte hex string generated once per
 *   device and stored in the OS native keychain (macOS Keychain Services,
 *   Windows Credential Manager, Linux libsecret).
 * - The Stronghold vault (~/.neumar/vault.hold) is AES-256-GCM encrypted
 *   at rest and can only be opened with the correct vault password.
 * - In browser / non-Tauri mode everything degrades gracefully to no-op.
 */

import { appDataDir } from '@tauri-apps/api/path';
import { remove } from '@tauri-apps/plugin-fs';
import type { Client, Store } from '@tauri-apps/plugin-stronghold';
import { Stronghold } from '@tauri-apps/plugin-stronghold';

import { getKeychainItem, saveKeychainItem } from './keychain';

// ── Constants ────────────────────────────────────────────────────────────────

const VAULT_PASSWORD_KEY = 'vault_password';
const CLIENT_NAME = 'neumar-api-keys';

// ── Helpers ──────────────────────────────────────────────────────────────────

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

function encode(text: string): number[] {
  return Array.from(new TextEncoder().encode(text));
}

function decode(bytes: number[]): string {
  return new TextDecoder().decode(new Uint8Array(bytes));
}

// ── Vault lifecycle ──────────────────────────────────────────────────────────

interface VaultHandle {
  stronghold: Stronghold;
  client: Client;
  store: Store;
}

let _vaultPromise: Promise<VaultHandle | null> | null = null;

async function getVaultPassword(): Promise<string> {
  const existing = await getKeychainItem(VAULT_PASSWORD_KEY);
  if (existing) return existing;

  // First launch — generate and persist a random vault password
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const password = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  await saveKeychainItem(VAULT_PASSWORD_KEY, password);
  return password;
}

async function loadVault(
  vaultPath: string,
  password: string,
): Promise<VaultHandle> {
  const stronghold = await Stronghold.load(vaultPath, password);

  let client: Client;
  try {
    client = await stronghold.loadClient(CLIENT_NAME);
  } catch {
    client = await stronghold.createClient(CLIENT_NAME);
    await stronghold.save();
  }

  return { stronghold, client, store: client.getStore() };
}

async function openVault(): Promise<VaultHandle | null> {
  if (!isTauri()) return null;

  try {
    const [dataDir, password] = await Promise.all([
      appDataDir(),
      getVaultPassword(),
    ]);

    const vaultPath = `${dataDir}/vault.hold`;

    try {
      return await loadVault(vaultPath, password);
    } catch (err) {
      // Vault file corrupted or password mismatch — delete and recreate.
      // Error strings from iota-stronghold crate via @tauri-apps/plugin-stronghold@2.3.x:
      //   "BadFileKey" — password doesn't match the vault's encryption key
      //   "decode/decrypt" — vault file data is corrupted or truncated
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('BadFileKey') || msg.includes('decode/decrypt')) {
        if (import.meta.env.DEV) {
          console.warn(
            '[Stronghold] Vault corrupted, recreating:',
            msg.slice(0, 120),
          );
        }
        try {
          await remove(vaultPath);
        } catch {
          // File may not exist
        }
        return await loadVault(vaultPath, password);
      }
      throw err;
    }
  } catch (err) {
    if (import.meta.env.DEV) {
      console.error('[Stronghold] Failed to open vault:', err);
    }
    return null;
  }
}

function getVault(): Promise<VaultHandle | null> {
  if (!_vaultPromise) {
    _vaultPromise = openVault();
  }
  return _vaultPromise;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Store an API key for a provider in the encrypted vault.
 * No-op if not running in Tauri or if key is empty.
 */
export async function setApiKey(
  providerId: string,
  apiKey: string,
): Promise<void> {
  if (!apiKey) return;
  const vault = await getVault();
  if (!vault) return;

  try {
    await vault.store.insert(`api_key_${providerId}`, encode(apiKey));
    await vault.stronghold.save();
  } catch (err) {
    if (import.meta.env.DEV) {
      console.error(`[Stronghold] Failed to save key for ${providerId}:`, err);
    }
  }
}

/**
 * Retrieve a stored API key for a provider.
 * Returns null if not found or vault unavailable.
 */
export async function getApiKey(providerId: string): Promise<string | null> {
  const vault = await getVault();
  if (!vault) return null;

  try {
    const bytes = await vault.store.get(`api_key_${providerId}`);
    if (!bytes) return null;
    return decode(Array.from(bytes));
  } catch {
    return null;
  }
}

/**
 * Remove a provider's API key from the vault.
 */
export async function removeApiKey(providerId: string): Promise<void> {
  const vault = await getVault();
  if (!vault) return;

  try {
    await vault.store.remove(`api_key_${providerId}`);
    await vault.stronghold.save();
  } catch {
    // Key may not exist — ignore
  }
}

/**
 * Fetch all API keys for the given provider IDs in one pass.
 * Returns a map of { providerId → apiKey } for providers that have a stored key.
 */
export async function getApiKeys(
  providerIds: string[],
): Promise<Record<string, string>> {
  const vault = await getVault();
  if (!vault) return {};

  const entries = await Promise.all(
    providerIds.map(async (id) => {
      try {
        const bytes = await vault.store.get(`api_key_${id}`);
        return bytes ? ([id, decode(Array.from(bytes))] as const) : null;
      } catch {
        return null;
      }
    }),
  );

  return Object.fromEntries(entries.filter(Boolean) as [string, string][]);
}

/**
 * Save API keys from a providers array to the vault (fire-and-forget).
 * Only providers with a non-empty apiKey are written.
 */
export function persistProviderKeys(
  providers: Array<{ id: string; apiKey?: string }>,
): void {
  for (const p of providers) {
    if (p.apiKey) {
      setApiKey(p.id, p.apiKey).catch(() => {});
    }
  }
}

/**
 * Merge vault API keys back into a providers array.
 * Returns a new array with apiKey fields populated from the vault.
 */
export async function mergeProviderKeys<
  T extends { id: string; apiKey?: string },
>(providers: T[]): Promise<T[]> {
  const ids = providers.map((p) => p.id);
  const keys = await getApiKeys(ids);
  if (Object.keys(keys).length === 0) return providers;

  return providers.map((p) => (keys[p.id] ? { ...p, apiKey: keys[p.id] } : p));
}
