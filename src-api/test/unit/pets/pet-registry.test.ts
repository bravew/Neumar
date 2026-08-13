import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  installCommunityPet,
  listCommunityPets,
  listCustomPets,
  readCustomPetSpritesheet,
  sanitizePetId,
} from '@/shared/pets/pet-registry';

const webpBytes = new Uint8Array([
  82, 73, 70, 70, 16, 0, 0, 0, 87, 69, 66, 80, 86, 80, 56, 32, 0, 0, 0, 0,
]);

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'neumar-pets-'));
  tempDirs.push(dir);
  return dir;
}

describe('pet registry', () => {
  it('sanitizes ids for route-safe folder references', () => {
    expect(sanitizePetId('../Bad Pet!!')).toBe('bad-pet');
    expect(sanitizePetId('custom.pet_01')).toBe('custom.pet_01');
  });

  it('lists local custom pets and rejects manifest spritesheet path escapes', async () => {
    const rootDir = await makeTempDir();
    const petDir = path.join(rootDir, 'My Pet');
    await mkdir(petDir);
    await writeFile(
      path.join(petDir, 'pet.json'),
      JSON.stringify({
        displayName: 'My Pet',
        description: 'Local test pet',
        spritesheetPath: '../outside.webp',
      }),
    );
    await writeFile(path.join(petDir, 'spritesheet.webp'), webpBytes);

    const result = await listCustomPets({
      rootDir,
      baseUrl: 'http://127.0.0.1:5126',
    });

    expect(result.pets).toHaveLength(1);
    expect(result.pets[0]).toMatchObject({
      id: 'my-pet',
      displayName: 'My Pet',
      description: 'Local test pet',
      spritesheetUrl: 'http://127.0.0.1:5126/pets/custom/my-pet/spritesheet',
      spritesheetExt: 'webp',
    });

    const sheet = await readCustomPetSpritesheet('my-pet', { rootDir });
    expect(sheet?.absPath).toBe(path.join(petDir, 'spritesheet.webp'));
  });

  it('ignores unsupported manifest spritesheet extensions', async () => {
    const rootDir = await makeTempDir();
    const petDir = path.join(rootDir, 'Text Pet');
    await mkdir(petDir);
    await writeFile(
      path.join(petDir, 'pet.json'),
      JSON.stringify({
        displayName: 'Text Pet',
        spritesheetPath: 'spritesheet.txt',
      }),
    );
    await writeFile(path.join(petDir, 'spritesheet.txt'), 'not an image');
    await writeFile(path.join(petDir, 'spritesheet.webp'), webpBytes);

    const sheet = await readCustomPetSpritesheet('text-pet', { rootDir });

    expect(sheet).toMatchObject({
      absPath: path.join(petDir, 'spritesheet.webp'),
      ext: 'webp',
    });
  });

  it('installs a selected OpenPets community pet into the custom registry', async () => {
    const rootDir = await makeTempDir();
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const href = String(url);
      if (href.endsWith('/catalog.v3.json')) {
        return Response.json({
          total: 1,
          search: 'https://openpets.dev/pets/catalog.v3/search.json',
          pages: ['https://openpets.dev/pets/catalog.v3/page-000.json'],
        });
      }
      if (href.endsWith('/search.json')) {
        return Response.json({
          pages: ['https://openpets.dev/pets/catalog.v3/search-page-000.json'],
        });
      }
      if (href.endsWith('/search-page-000.json')) {
        return Response.json({
          pets: [{ id: 'test-pet', catalogPage: 0 }],
        });
      }
      if (href.endsWith('/page-000.json')) {
        return Response.json({
          pets: [
            {
              id: 'test-pet',
              displayName: 'Test Pet',
              description: 'A test community pet.',
              spritesheet:
                'https://openpets.dev/pets/test-pet/spritesheet.webp',
              category: 'western',
              original: true,
              featured: true,
            },
          ],
        });
      }
      if (href.endsWith('/spritesheet.webp')) {
        return new Response(webpBytes);
      }
      throw new Error(`Unexpected fetch: ${href}`);
    }) as unknown as typeof fetch;

    const result = await installCommunityPet('test-pet', {
      rootDir,
      fetchImpl,
    });

    expect(result.installed).toBe(true);
    expect(result.pet).toMatchObject({
      id: 'test-pet',
      displayName: 'Test Pet',
      description: 'A test community pet.',
      spritesheetExt: 'webp',
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://openpets.dev/pets/test-pet/spritesheet.webp',
      expect.objectContaining({ credentials: 'omit' }),
    );
  });

  it('rejects community spritesheet redirects to untrusted hosts', async () => {
    const rootDir = await makeTempDir();
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const href = String(url);
      if (href.endsWith('/catalog.v3.json')) {
        return Response.json({
          total: 1,
          search: 'https://openpets.dev/pets/catalog.v3/search.json',
          pages: ['https://openpets.dev/pets/catalog.v3/page-000.json'],
        });
      }
      if (href.endsWith('/search.json')) {
        return Response.json({
          pages: ['https://openpets.dev/pets/catalog.v3/search-page-000.json'],
        });
      }
      if (href.endsWith('/search-page-000.json')) {
        return Response.json({
          pets: [{ id: 'redirect-pet', catalogPage: 0 }],
        });
      }
      if (href.endsWith('/page-000.json')) {
        return Response.json({
          pets: [
            {
              id: 'redirect-pet',
              displayName: 'Redirect Pet',
              spritesheet:
                'https://openpets.dev/pets/redirect-pet/spritesheet.webp',
            },
          ],
        });
      }
      if (href.endsWith('/spritesheet.webp')) {
        return new Response(null, {
          status: 302,
          headers: { location: 'https://metadata.google.internal/latest' },
        });
      }
      throw new Error(`Unexpected fetch: ${href}`);
    }) as unknown as typeof fetch;

    await expect(
      installCommunityPet('redirect-pet', { rootDir, fetchImpl }),
    ).rejects.toThrow('Community pet host is not allowed');
  });

  it('defaults invalid community page limits instead of returning an empty list', async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const href = String(url);
      if (href.endsWith('/catalog.v3.json')) {
        return Response.json({
          total: 1,
          pages: ['https://openpets.dev/pets/catalog.v3/page-000.json'],
        });
      }
      if (href.endsWith('/page-000.json')) {
        return Response.json({
          pets: [
            {
              id: 'listed-pet',
              displayName: 'Listed Pet',
              spritesheet:
                'https://openpets.dev/pets/listed-pet/spritesheet.webp',
            },
          ],
        });
      }
      throw new Error(`Unexpected fetch: ${href}`);
    }) as unknown as typeof fetch;

    const result = await listCommunityPets({
      fetchImpl,
      limit: Number.NaN,
    });

    expect(result.pets).toHaveLength(1);
  });
});
