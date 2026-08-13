/**
 * Voice display utilities — formatting and language resolution helpers
 * shared across speech settings components.
 */

import type { Voice } from './types';

/**
 * Resolve a language code like "en-US", "cmn", "multi" to an i18n label.
 */
export function resolveLanguageLabel(
  lang: string | undefined,
  s: Record<string, string | undefined>,
): string | undefined {
  if (!lang) return undefined;
  // Build a key like "speechLangEnUS" from "en-US"
  const langKey =
    'speechLang' +
    lang
      .replace(/[-_]/g, '')
      .replace(/^(.)/, (_m, c: string) => c.toUpperCase());
  return s[langKey] ?? lang;
}

/**
 * Format a voice entry for display in the dropdown.
 *
 * When `groupHasLang` is true (the optgroup header already shows the
 * language), the label is simply  "Name"  or  "Name — Description".
 * Otherwise:  "Name (Language)"  or  "Name (Language) — Description".
 */
export function formatVoiceLabel(
  v: Voice,
  s: Record<string, string | undefined>,
  groupHasLang = false,
): string {
  // Strip bracket prefix "[Kokoro] " and inline language suffix " (en-US)"
  const baseName = v.name
    .replace(/^\[[^\]]+\]\s*/, '')
    .replace(/\s*\([a-z]{2,3}(-[A-Z]{2})?\)\s*$/, '')
    .trim();

  if (groupHasLang) {
    return v.description ? `${baseName} — ${v.description}` : baseName;
  }

  if (!v.language) return baseName;
  const langLabel = resolveLanguageLabel(v.language, s);

  if (v.description) {
    return `${baseName} (${langLabel}) — ${v.description}`;
  }
  return `${baseName} (${langLabel})`;
}
