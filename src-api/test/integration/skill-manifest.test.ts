import { describe, expect, it } from 'vitest';

// Test frontmatter parsing by importing the loader and testing directly
describe('Skill Manifest Enhancement', () => {
  describe('Frontmatter parsing', () => {
    it('extracts trigger, category, icon fields from YAML', async () => {
      const { loadSkillFromDir } = await import('@/shared/skills/loader');
      // We test the parser indirectly via loadSkillFromDir
      // Create a mock skill in temp dir
      const fs = await import('fs/promises');
      const path = await import('path');
      const os = await import('os');

      const tmpDir = path.join(os.tmpdir(), `skill-test-${Date.now()}`);
      await fs.mkdir(tmpDir, { recursive: true });
      await fs.writeFile(
        path.join(tmpDir, 'SKILL.md'),
        `---
name: Test Skill
description: A test skill
trigger: /test
category: dev
icon: FileText
---

# Test Skill

This is a test skill.`,
      );

      const skill = await loadSkillFromDir(tmpDir);
      expect(skill).not.toBeNull();
      expect(skill!.metadata.name).toBe('Test Skill');
      expect(skill!.metadata.trigger).toBe('/test');
      expect(skill!.metadata.category).toBe('dev');
      expect(skill!.metadata.icon).toBe('FileText');

      // Cleanup
      await fs.rm(tmpDir, { recursive: true });
    });

    it('missing optional fields default gracefully', async () => {
      const { loadSkillFromDir } = await import('@/shared/skills/loader');
      const fs = await import('fs/promises');
      const path = await import('path');
      const os = await import('os');

      const tmpDir = path.join(
        os.tmpdir(),
        `skill-test-no-optional-${Date.now()}`,
      );
      await fs.mkdir(tmpDir, { recursive: true });
      await fs.writeFile(
        path.join(tmpDir, 'SKILL.md'),
        `---
name: Basic Skill
description: No trigger or category
---

Basic content.`,
      );

      const skill = await loadSkillFromDir(tmpDir);
      expect(skill).not.toBeNull();
      expect(skill!.metadata.trigger).toBeUndefined();
      expect(skill!.metadata.category).toBeUndefined();
      expect(skill!.metadata.icon).toBeUndefined();

      await fs.rm(tmpDir, { recursive: true });
    });

    it('keeps a lone quote description literal', async () => {
      const { loadSkillFromDir } = await import('@/shared/skills/loader');
      const fs = await import('fs/promises');
      const path = await import('path');
      const os = await import('os');

      const tmpDir = path.join(
        os.tmpdir(),
        `skill-test-lone-quote-${Date.now()}`,
      );
      await fs.mkdir(tmpDir, { recursive: true });
      await fs.writeFile(
        path.join(tmpDir, 'SKILL.md'),
        `---
name: Quote Skill
description: "
---

Body.`,
      );

      const skill = await loadSkillFromDir(tmpDir);
      expect(skill).not.toBeNull();
      expect(skill!.metadata.description).toBe('"');

      await fs.rm(tmpDir, { recursive: true });
    });
  });
});
