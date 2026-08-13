/**
 * Skills Loader (compat shim)
 *
 * @deprecated Import from `@/shared/plugins` directly in new code.
 *
 * Preserves the v1 API surface (`loadSkills`, `findSkill`, `getSkillNames`,
 * `loadSkillFromDir`, `getSkillsPath`) so existing callers in the agent
 * runtime, MCP loader, and UI keep working.
 */

import { basename } from 'path';

import { getClaudeSkillsDir } from '@/config/constants';

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
