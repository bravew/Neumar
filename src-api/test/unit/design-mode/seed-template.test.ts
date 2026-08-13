import { describe, expect, it } from 'vitest';

import { readDesignSkillSeedTemplate } from '@/shared/services/design-mode/catalogs';

// Regression: a fresh design build seeds its `index.html` from a skill's
// `assets/template.html` so the agent composes from a real token/class system
// and its read-before-write habit lands on a file that exists (instead of
// erroring on a missing file and stalling). These guard that the bundled
// seed templates resolve through catalogRoot() + bundled-skill discovery.
describe('design skill seed templates', () => {
  it('resolves the web-prototype seed (default for prototype/template)', async () => {
    const seed = await readDesignSkillSeedTemplate('web-prototype');
    expect(seed).toBeTruthy();
    expect(seed).toContain('<style>');
  });

  it('resolves the simple-deck seed (default for deck)', async () => {
    const seed = await readDesignSkillSeedTemplate('simple-deck');
    expect(seed).toBeTruthy();
  });

  it('returns null for an unknown skill (caller falls back to direct create)', async () => {
    expect(await readDesignSkillSeedTemplate('does-not-exist-xyz')).toBeNull();
  });
});
