import {
  DEFAULT_PET_SETTINGS,
  type PetCustomSelection,
  type PetSettingsConfig,
} from '@/shared/db/settings';

export function normalizePetSettings(
  settings: PetSettingsConfig | undefined,
): PetSettingsConfig {
  const customPet = normalizeCustomPet(settings?.customPet);
  const activePetSource =
    settings?.activePetSource === 'custom' && customPet ? 'custom' : 'builtin';

  return {
    ...DEFAULT_PET_SETTINGS,
    ...settings,
    activePetSource,
    customPet,
    position: {
      ...DEFAULT_PET_SETTINGS.position,
      ...settings?.position,
    },
    windowPosition: {
      ...DEFAULT_PET_SETTINGS.windowPosition,
      ...settings?.windowPosition,
    },
  };
}

// Mirrors the backend slug regex (see MEMORY.md): word-char start, then word
// chars / dot / dash. Rejects path-traversal patterns (`..`, `/`, `\`) on the
// renderer side so an attacker who reaches the IPC payload can't smuggle a
// poisoned id into settings storage or any downstream URL builder.
const PET_ID_PATTERN = /^[\w][\w.-]*$/;

export function normalizeCustomPet(value: unknown): PetCustomSelection | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  const id = pickString(candidate.id);
  const name = pickString(candidate.name);
  const accent = pickString(candidate.accent);
  const glyph = pickString(candidate.glyph);
  const greeting = pickString(candidate.greeting);
  const sourceUrl = pickString(candidate.sourceUrl);
  if (!id || !name || !accent || !glyph || !greeting) {
    return null;
  }
  if (!PET_ID_PATTERN.test(id) || id.length > 120) {
    return null;
  }

  return {
    id,
    name,
    description: pickString(candidate.description) ?? '',
    accent,
    glyph,
    greeting,
    ...(sourceUrl ? { sourceUrl } : {}),
  };
}

function pickString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}
