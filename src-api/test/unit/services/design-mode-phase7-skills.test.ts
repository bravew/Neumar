import { describe, expect, it } from 'vitest';

import {
  listDesignSkills,
  readDesignSkillExample,
} from '@/shared/services/design-mode/catalogs';

describe('DesignMode Phase 7 bundled skills', () => {
  it('loads the new first-party skills with examples and license notes', async () => {
    const skills = await listDesignSkills();
    const bySlug = new Map(skills.map((skill) => [skill.slug, skill]));
    const expected = [
      ['reference-design-contract', 'document'],
      ['community-hallmark', 'campaign'],
      ['contact-widget', 'prototype'],
      ['redesign-existing-projects', 'prototype'],
    ] as const;

    for (const [slug, surface] of expected) {
      const skill = bySlug.get(slug);
      expect(skill, slug).toBeTruthy();
      expect(skill?.origin).toBe('builtin');
      expect(skill?.od.surface).toBe(surface);
      expect(skill?.od.examplePrompt).toBeTruthy();
      expect(skill?.content).toContain('License note: First-party');
      await expect(readDesignSkillExample(skill!.id)).resolves.toContain(
        '<!doctype html>',
      );
    }
  });
});
