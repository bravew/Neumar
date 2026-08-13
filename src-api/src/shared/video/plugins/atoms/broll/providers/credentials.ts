import { getSetting } from '@/shared/db/operations';
import { getProviderConfig } from '@/shared/video/store';

import type { BrollProviderCredentials, BrollProviderId } from '../types';

interface StoredProvider {
  id: string;
  name: string;
  apiKey: string;
  baseUrl: string;
  enabled?: boolean;
}

export function resolveBrollCredentials(
  provider: BrollProviderId,
): BrollProviderCredentials | null {
  if (provider === 'pexels') return resolvePexelsCredentials();
  if (provider === 'pixabay') return resolvePixabayCredentials();
  return resolveStoryblocksCredentials();
}

function resolvePexelsCredentials(): BrollProviderCredentials | null {
  const config = getProviderConfig('pexels');
  const stored = findStoredProvider('pexels');
  const apiKey =
    stringSetting(config.settings.apiKey) ??
    env('PEXELS_API_KEY') ??
    stored?.apiKey;
  if (!apiKey) return null;
  return {
    apiKey,
    baseUrl:
      stringSetting(config.settings.baseUrl) ??
      stored?.baseUrl ??
      'https://api.pexels.com/v1',
  };
}

function resolvePixabayCredentials(): BrollProviderCredentials | null {
  const config = getProviderConfig('pixabay');
  const stored = findStoredProvider('pixabay');
  const apiKey =
    stringSetting(config.settings.apiKey) ??
    env('PIXABAY_API_KEY') ??
    stored?.apiKey;
  if (!apiKey) return null;
  return {
    apiKey,
    baseUrl:
      stringSetting(config.settings.baseUrl) ??
      stored?.baseUrl ??
      'https://pixabay.com/api/videos/',
  };
}

function resolveStoryblocksCredentials(): BrollProviderCredentials | null {
  const config = getProviderConfig('storyblocks');
  const publicKey =
    stringSetting(config.settings.publicKey) ?? env('STORYBLOCKS_PUBLIC_KEY');
  const privateKey =
    stringSetting(config.settings.privateKey) ?? env('STORYBLOCKS_PRIVATE_KEY');
  if (!publicKey || !privateKey) return null;
  return {
    apiKey: publicKey,
    publicKey,
    privateKey,
    baseUrl:
      stringSetting(config.settings.baseUrl) ?? 'https://api.storyblocks.com',
    projectId:
      stringSetting(config.settings.projectId) ??
      env('STORYBLOCKS_PROJECT_ID') ??
      'neuma',
    userId:
      stringSetting(config.settings.userId) ??
      env('STORYBLOCKS_USER_ID') ??
      'neuma',
  };
}

function findStoredProvider(provider: BrollProviderId): StoredProvider | null {
  return (
    readStoredProviders().find((candidate) => {
      const haystack = [candidate.id, candidate.name, candidate.baseUrl].map(
        (value) => value.toLowerCase(),
      );
      return haystack.some((value) => value.includes(provider));
    }) ?? null
  );
}

function readStoredProviders(): StoredProvider[] {
  const raw = getSetting('providers');
  if (!raw) return [];
  try {
    let parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'string') parsed = JSON.parse(parsed);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isStoredProvider);
  } catch {
    return [];
  }
}

function isStoredProvider(value: unknown): value is StoredProvider {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === 'string' &&
    typeof record.name === 'string' &&
    typeof record.apiKey === 'string' &&
    Boolean(record.apiKey) &&
    typeof record.baseUrl === 'string' &&
    isSafeBaseUrl(record.baseUrl) &&
    (record.enabled === undefined || record.enabled !== false)
  );
}

// Defense-in-depth against SSRF: provider baseUrl comes from user-editable
// settings JSON and is used to build server-side fetch targets. safeFetch's
// host allowlist is the primary guard; rejecting non-HTTPS and local/private
// hosts here keeps a misconfigured baseUrl from ever reaching it.
function isSafeBaseUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  const host = parsed.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) return false;
  if (
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  ) {
    return false;
  }
  return true;
}

function stringSetting(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : undefined;
}
