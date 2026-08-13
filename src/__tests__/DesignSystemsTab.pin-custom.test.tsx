import { describe, expect, it } from 'vitest';

import { orderDesignSystems } from '@/components/design/tabs/DesignSystemsTab';
import type { DesignSystemRecord } from '@/shared/types/design-mode';

describe('orderDesignSystems', () => {
  it('pins editable and installed systems above bundled systems alphabetically', () => {
    const ordered = orderDesignSystems([
      system('z-bundled', 'Zulu', 'bundled'),
      system('b-installed', 'Beta', 'installed'),
      system('a-custom', 'Alpha', 'installed', true),
      system('a-bundled', 'Alpha Bundled', 'bundled'),
    ]);

    expect(ordered.map((item) => item.id)).toEqual([
      'a-custom',
      'b-installed',
      'a-bundled',
      'z-bundled',
    ]);
  });
});

function system(
  id: string,
  title: string,
  origin: 'bundled' | 'installed',
  editable = false,
): DesignSystemRecord {
  return {
    id,
    title,
    category: 'General',
    summary: title,
    body: `# ${title}`,
    swatches: [],
    tokens: [],
    origin,
    editable,
  };
}
