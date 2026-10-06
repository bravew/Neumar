/**
 * Skills Loader (compat shim)
 *
 * @deprecated Import from `@/shared/plugins` directly in new code.
 *
 * Preserves the v1 API surface (`loadSkills`, `findSkill`, `getSkillNames`,
 * `loadSkillFromDir`, `getSkillsPath`) so existing callers in the agent
 * runtime, MCP loader, and UI keep working.
 */

import { access } from 'node:fs/promises';
import { basename, join } from 'path';

import { getAllSkillsDirs, getClaudeSkillsDir } from '@/config/constants';

import {
  loadAllSkills,
  loadSkillFromDir as loadOneSkill,
  type LoadedSkill as PluginLoadedSkill,
  type SkillMetadata as PluginSkillMetadata,
} from '@/shared/plugins';

export type SkillMetadata = PluginSkillMetadata;
export type LoadedSkill = PluginLoadedSkill;

export interface SkillsConfig {
  enabled: boolean;
}

export async function loadSkillFromDir(
  skillDir: string,
): Promise<LoadedSkill | null> {
  return loadOneSkill(null, skillDir);
}

export function getSkillsPath(): string {
  return getClaudeSkillsDir();
}

const SKILL_SLUG_RE = /^[a-z0-9_-]+$/i;

/**
 * Keep profile skill slugs that exist in any discovered skill root. The slug
 * itself is still a single path segment, so this never joins a traversal.
 * A later root does not change the result: existence in one root is enough.
 */
export async function resolveExistingSkillSlugs(
  slugs: readonly string[],
): Promise<{ found: string[]; missing: string[] }> {
  const candidates = slugs.filter(
    (slug) => typeof slug === 'string' && SKILL_SLUG_RE.test(slug),
  );
  const roots = getAllSkillsDirs().map((dir) => dir.path);
  const found: string[] = [];
  const missing: string[] = [];
  await Promise.all(
    candidates.map(async (slug) => {
      const exists = await skillSlugExists(roots, slug);
      (exists ? found : missing).push(slug);
    }),
  );
  return { found, missing };
}

async function skillSlugExists(
  roots: readonly string[],
  slug: string,
): Promise<boolean> {
  const checks = await Promise.all(
    roots.map(async (root) => {
      try {
        await access(join(root, slug, 'SKILL.md'));
        return true;
      } catch {
        return false;
      }
    }),
  );
  return checks.some(Boolean);
}

export async function loadSkills(
  skillsConfig?: SkillsConfig,
): Promise<LoadedSkill[]> {
  return loadAllSkills({ enabled: skillsConfig?.enabled });
}

export function getSkillNames(skills: LoadedSkill[]): string[] {
  return skills.map((s) => s.name);
}

export function findSkill(
  skills: LoadedSkill[],
  nameOrSlug: string,
): LoadedSkill | undefined {
  const lower = nameOrSlug.toLowerCase();
  return skills.find(
    (s) =>
      s.name.toLowerCase() === lower ||
      s.bareName.toLowerCase() === lower ||
      basename(s.path).toLowerCase() === lower,
  );
}
