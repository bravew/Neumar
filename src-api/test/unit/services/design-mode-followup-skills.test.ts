import { describe, expect, it } from 'vitest';

import {
  listDesignSkills,
  readDesignSkillExample,
} from '@/shared/services/design-mode/catalogs';

describe('DesignMode 2026-06-06 follow-up bundled skills', () => {
  it('loads glass-dashboard as a self-contained, licensed builtin skill', async () => {
    const skills = await listDesignSkills();
    const skill = skills.find((s) => s.slug === 'glass-dashboard');

    expect(skill, 'glass-dashboard').toBeTruthy();
    expect(skill?.id).toBe('bundled:glass-dashboard');
    expect(skill?.origin).toBe('builtin');
    expect(skill?.od.surface).toBe('prototype');
    expect(skill?.od.examplePrompt).toBeTruthy();
    expect(skill?.content).toContain('License note: First-party');

    const example = await readDesignSkillExample(skill!.id);
    expect(example).toContain('<!doctype html>');
    // Sandbox-safe: the seed must not pull any external resource.
    expect(example).not.toMatch(/https?:\/\//);
    // Glassmorphism core + accessibility fallback are present.
    expect(example).toContain('backdrop-filter');
    expect(example).toContain('@supports not (backdrop-filter');
    expect(example).toContain('prefers-reduced-motion');
    // Output-contract anchors for the agent to target.
    expect(example).toContain('data-od-id="dashboard-shell"');
  });
});
