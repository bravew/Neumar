import fs from 'node:fs/promises';
import path from 'node:path';

import { loadSkillFromDir, type LoadedSkill } from '@/shared/plugins/loader';
import type { PluginManifest } from '@/shared/plugins/manifest';

export async function loadPluginLocalSkills(
  pluginRoot: string,
  manifest: PluginManifest,
): Promise<LoadedSkill[]> {
  const skillsRoot = resolveContainedPath(pluginRoot, manifest.skills);
  if (!skillsRoot) return [];
  let entries: { name: string; isDirectory: () => boolean }[];
  try {
    entries = await fs.readdir(skillsRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const loaded = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) =>
        loadSkillFromDir(manifest.name, path.join(skillsRoot, entry.name)),
      ),
  );
  return loaded.filter((skill): skill is LoadedSkill => skill !== null);
}

export function findLocalSkill(
  skills: readonly LoadedSkill[],
  name: string,
): LoadedSkill | undefined {
  const normalized = name.toLowerCase();
  return skills.find(
    (skill) =>
      skill.name.toLowerCase() === normalized ||
      skill.bareName.toLowerCase() === normalized ||
      path.basename(skill.path).toLowerCase() === normalized,
  );
}

export function resolveContainedPath(
  rootDir: string,
  relativePath: string,
): string | null {
  const root = path.resolve(rootDir);
  const candidate = path.resolve(root, relativePath);
  if (candidate !== root && !candidate.startsWith(root + path.sep)) {
    return null;
  }
  return candidate;
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
