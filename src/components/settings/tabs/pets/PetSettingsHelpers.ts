import { useEffect, useRef } from 'react';

import type { PetCustomSelection } from '@/shared/db/settings';
import type { CommunityPetSummary, CustomPetSummary } from '@/shared/pets/api';
import { PET_ATLAS_LAYOUT } from '@/shared/pets/atlas';
import type { PetCatalogItem } from '@/shared/pets/catalog';

// Reset on every mount — StrictMode's first cleanup would otherwise leave
// the ref stuck at false and silently drop post-async state updates.
export function useMountedRef() {
  const ref = useRef(true);
  useEffect(() => {
    ref.current = true;
    return () => void (ref.current = false);
  }, []);
  return ref;
}

const CUSTOM_PET_ACCENTS = [
  '#22d3ee',
  '#a78bfa',
  '#f472b6',
  '#34d399',
  '#f59e0b',
  '#60a5fa',
] as const;

export function customSelectionFromSummary(
  pet: CustomPetSummary,
  greeting: string,
): PetCustomSelection {
  return {
    id: pet.id,
    name: pet.displayName,
    description: pet.description,
    accent: accentForId(pet.id),
    glyph: glyphForName(pet.displayName),
    greeting,
    ...(pet.sourceUrl ? { sourceUrl: pet.sourceUrl } : {}),
  };
}

export function communityPetToCatalogItem(
  pet: CommunityPetSummary,
): PetCatalogItem {
  return {
    id: pet.id,
    name: pet.displayName,
    description: pet.description,
    accent: accentForId(pet.id),
    glyph: glyphForName(pet.displayName),
    greeting: '',
    spritesheetUrl: pet.spritesheetUrl,
    atlasLayout: PET_ATLAS_LAYOUT,
    sourceUrl: pet.sourceUrl,
  };
}

export async function openFolderInSystem(folderPath: string): Promise<void> {
  try {
    const { openPath } = await import('@tauri-apps/plugin-opener');
    await openPath(folderPath);
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn('[Pets] openFolderInSystem failed:', error);
    }
  }
}

function accentForId(id: string): string {
  const total = [...id].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return CUSTOM_PET_ACCENTS[total % CUSTOM_PET_ACCENTS.length] ?? '#22d3ee';
}

function glyphForName(name: string): string {
  return name.trim().charAt(0).toUpperCase() || 'P';
}
