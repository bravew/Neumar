/**
 * Shared Gemini URL detection utility.
 *
 * Detects whether a base URL points to the native Google Gemini API
 * (generativelanguage.googleapis.com or aiplatform.googleapis.com)
 * vs. an OpenAI-compatible proxy (e.g., OpenRouter).
 *
 * Native Gemini uses `?key=API_KEY` query param auth.
 * Proxies use `Authorization: Bearer` header auth.
 */
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('Providers');

function stripQueryAndHash(input: string): string {
  return input.split(/[?#]/, 1)[0] ?? input;
}

function sanitizeForLog(input: string): string {
  const trimmed = input.trim();
  try {
    const url = new URL(trimmed);
    if (url.search) url.search = '?[redacted]';
    if (url.hash) url.hash = '#[redacted]';
    return url.toString();
  } catch {
    return stripQueryAndHash(trimmed);
  }
}

export function normalizeGeminiBaseUrl(input: string): string {
  const trimmed = input.trim();
  let normalized = stripQueryAndHash(trimmed).replace(/\/+$/, '');
  normalized = normalized.replace(/\/v1(?:beta)?$/i, '');

  if (normalized !== trimmed) {
    logger.debug('gemini_base_url_normalized', {
      raw: sanitizeForLog(trimmed),
      normalized,
    });
  }

  return normalized;
}

export function isNativeGeminiUrl(baseUrl: string): boolean {
  const normalized = normalizeGeminiBaseUrl(baseUrl);
  const lower = normalized.toLowerCase();
  try {
    const hostname = new URL(normalized).hostname.toLowerCase();
    return (
      hostname === 'generativelanguage.googleapis.com' ||
      hostname === 'aiplatform.googleapis.com' ||
      hostname.endsWith('.aiplatform.googleapis.com')
    );
  } catch {
    // Allow hostname-only provider entries without a URL scheme.
  }

  return (
    lower.includes('generativelanguage.googleapis.com') ||
    lower.includes('aiplatform.googleapis.com')
  );
}
