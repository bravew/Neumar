import en from './messages/en';
import es from './messages/es';
import fr from './messages/fr';
import hi from './messages/hi';
import pt from './messages/pt';
import zh from './messages/zh';

export type Language =
  | 'en-US'
  | 'zh-CN'
  | 'es-ES'
  | 'fr-FR'
  | 'hi-IN'
  | 'pt-BR';

export const translations = {
  'en-US': en,
  'zh-CN': zh,
  'es-ES': es,
  'fr-FR': fr,
  'hi-IN': hi,
  'pt-BR': pt,
} as const;

export type TranslationKeys = typeof en;

// Helper function to get nested translation value by path
export function getNestedValue(
  obj: Record<string, unknown>,
  path: string,
): string {
  const keys = path.split('.');
  let current: unknown = obj;

  for (const key of keys) {
    if (current && typeof current === 'object' && key in current) {
      current = (current as Record<string, unknown>)[key];
    } else {
      return path; // Return the path if not found
    }
  }

  return typeof current === 'string' ? current : path;
}

// Get system language
export function getSystemLanguage(): Language {
  if (typeof navigator === 'undefined') return 'en-US';

  const lang =
    navigator.language ||
    (navigator as { userLanguage?: string }).userLanguage ||
    'en-US';

  // Check if Chinese
  if (lang.startsWith('zh')) {
    return 'zh-CN';
  }

  // Check if Spanish
  if (lang.startsWith('es')) {
    return 'es-ES';
  }

  // Check if French
  if (lang.startsWith('fr')) {
    return 'fr-FR';
  }

  // Check if Hindi
  if (lang.startsWith('hi')) {
    return 'hi-IN';
  }

  // Check if Portuguese
  if (lang.startsWith('pt')) {
    return 'pt-BR';
  }

  return 'en-US';
}

/** Canonical list of supported languages — use this everywhere instead of hardcoding. */
export const LANGUAGE_OPTIONS: { value: Language; label: string }[] = [
  { value: 'en-US', label: 'English' },
  { value: 'zh-CN', label: '简体中文' },
  { value: 'es-ES', label: 'Español' },
  { value: 'fr-FR', label: 'Français' },
  { value: 'hi-IN', label: 'हिन्दी' },
  { value: 'pt-BR', label: 'Português' },
];

// Re-export messages for direct access
export { en, es, fr, hi, pt, zh };
