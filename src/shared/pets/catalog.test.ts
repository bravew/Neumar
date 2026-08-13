import { describe, expect, it } from 'vitest';

import { PET_ATLAS_LAYOUT } from './atlas';
import { BUILTIN_PETS, getPetForSettings } from './catalog';

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

interface PetManifestEntry {
  slug: string;
  petJson: string;
  spritesheet: string;
}

interface PetManifest {
  pets: PetManifestEntry[];
}

const petsRoot = join(process.cwd(), 'public/pets');
const manifest = JSON.parse(
  readFileSync(join(petsRoot, 'manifest.json'), 'utf8'),
) as PetManifest;

describe('BUILTIN_PETS', () => {
  it('keeps catalog entries aligned with bundled pet assets', () => {
    const ids = new Set<string>();
    const manifestEntries = new Map(
      manifest.pets.map((entry) => [entry.slug, entry]),
    );

    for (const pet of BUILTIN_PETS) {
      expect(ids.has(pet.id)).toBe(false);
      ids.add(pet.id);
      expect(pet.atlasLayout).toBe(PET_ATLAS_LAYOUT);
      expect(pet.spritesheetUrl).toBe(`/pets/${pet.id}/spritesheet.webp`);

      const manifestEntry = manifestEntries.get(pet.id);
      expect(manifestEntry).toEqual({
        slug: pet.id,
        petJson: `${pet.id}/pet.json`,
        spritesheet: `${pet.id}/spritesheet.webp`,
      });
      expect(
        manifestEntry
          ? existsSync(join(petsRoot, manifestEntry.petJson))
          : false,
      ).toBe(true);
      expect(
        manifestEntry
          ? existsSync(join(petsRoot, manifestEntry.spritesheet))
          : false,
      ).toBe(true);
    }

    expect([...manifestEntries.keys()].sort()).toEqual([...ids].sort());
  });

  it('resolves custom pet selections to the local pet API spritesheet', () => {
    const pet = getPetForSettings({
      enabled: true,
      activePetId: 'my-custom-pet',
      activePetSource: 'custom',
      customPet: {
        id: 'my-custom-pet',
        name: 'My Custom Pet',
        description: 'A local pet.',
        accent: '#22d3ee',
        glyph: 'M',
        greeting: 'Hello.',
      },
      showAgentActivity: true,
      position: { right: 24, bottom: 24 },
      windowPosition: { x: 64, y: 64 },
    });

    expect(pet).toMatchObject({
      id: 'my-custom-pet',
      name: 'My Custom Pet',
      spritesheetUrl:
        'http://127.0.0.1:5126/pets/custom/my-custom-pet/spritesheet',
      atlasLayout: PET_ATLAS_LAYOUT,
    });
  });
});
