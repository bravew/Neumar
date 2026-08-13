import { describe, expect, it } from 'vitest';

import { normalizePetSettings } from './settings';

describe('normalizePetSettings', () => {
  it('keeps valid custom pet selections', () => {
    const settings = normalizePetSettings({
      enabled: true,
      activePetId: 'local-pet',
      activePetSource: 'custom',
      customPet: {
        id: 'local-pet',
        name: 'Local Pet',
        description: 'A local companion.',
        accent: ' #22d3ee ',
        glyph: 'L',
        greeting: 'Hello.',
        sourceUrl: ' https://openpets.dev/pets/local-pet ',
      },
      showAgentActivity: true,
      position: { right: 24, bottom: 24 },
      windowPosition: { x: 64, y: 64 },
    });

    expect(settings.activePetSource).toBe('custom');
    expect(settings.customPet).toEqual({
      id: 'local-pet',
      name: 'Local Pet',
      description: 'A local companion.',
      accent: '#22d3ee',
      glyph: 'L',
      greeting: 'Hello.',
      sourceUrl: 'https://openpets.dev/pets/local-pet',
    });
  });

  it('falls back to built-in pets when persisted custom metadata is malformed', () => {
    const settings = normalizePetSettings({
      enabled: true,
      activePetId: 'bad-custom-pet',
      activePetSource: 'custom',
      customPet: {
        id: 'bad-custom-pet',
        name: 123,
        description: null,
        accent: '#22d3ee',
        glyph: 'B',
        greeting: 'Hello.',
      },
      showAgentActivity: true,
      position: { right: 24, bottom: 24 },
      windowPosition: { x: 64, y: 64 },
    } as unknown as Parameters<typeof normalizePetSettings>[0]);

    expect(settings.activePetSource).toBe('builtin');
    expect(settings.customPet).toBeNull();
  });
});
