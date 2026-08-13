#!/usr/bin/env node

/**
 * Migrate bundled design-mode catalogs into the parent plugin directory
 * (dev-doc/plan/07-04-plugin-system checkpoint 2).
 *
 *   src-api/src/shared/design-mode/design-systems/<slug>/  →  plugins/builtin/design-systems/<slug>/
 *   src-api/src/shared/design-mode/skills/<slug>/          →  plugins/builtin/design-skills/<slug>/skills/<slug>/
 *
 * Content bodies are copied byte-identical; only wrapping manifests
 * (.claude-plugin/plugin.json + design-plugin.json) are generated. Idempotent:
 * re-running replaces the generated plugin folders from the source tree.
 *
 * Usage:
 *   node scripts/migrate-design-catalogs.mjs             # copy + generate manifests
 *   node scripts/migrate-design-catalogs.mjs --verify    # byte-compare source ↔ migrated tree
 *   node scripts/migrate-design-catalogs.mjs --delete-source  # verify, then remove source trees
 */

import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');
const SYSTEMS_SRC = path.join(
  repoRoot,
  'src-api/src/shared/design-mode/design-systems',
);
const SKILLS_SRC = path.join(repoRoot, 'src-api/src/shared/design-mode/skills');
const SYSTEMS_DEST = path.join(repoRoot, 'plugins/builtin/design-systems');
const SKILLS_DEST = path.join(repoRoot, 'plugins/builtin/design-skills');

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SYSTEM_EXTRAS = ['_schema', 'README.md'];

function listContentDirs(root, markerFile) {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        !entry.name.startsWith('.') &&
        !entry.name.startsWith('_') &&
        existsSync(path.join(root, entry.name, markerFile)),
    )
    .map((entry) => entry.name)
    .sort();
}

function truncate(text, max = 500) {
  const clean = (text ?? '').trim();
  if (!clean) return null;
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Minimal SKILL.md frontmatter reader: supports `key: value` and `key: |` /
 * `key: >` block scalars — enough for the bundled design skills.
 */
function readFrontmatter(file) {
  const content = readFileSync(file, 'utf-8');
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const lines = match[1].split('\n');
  const out = {};
  for (let i = 0; i < lines.length; i++) {
    const kv = lines[i].match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (!kv) continue;
    const [, key, rawValue] = kv;
    if (rawValue === '|' || rawValue === '>' || rawValue === '') {
      const block = [];
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) {
        block.push(lines[i + 1].trim());
        i++;
      }
      if (block.length > 0) {
        out[key] = block.join(' ');
      }
    } else {
      out[key] = rawValue.replace(/^['"]|['"]$/g, '');
    }
  }
  return out;
}

function assertManifest(manifest, sourceDir) {
  if (!NAME_RE.test(manifest.name)) {
    throw new Error(
      `Generated plugin name invalid: ${manifest.name} (${sourceDir})`,
    );
  }
  if (!manifest.description || manifest.description.length > 500) {
    throw new Error(
      `Generated description invalid for ${manifest.name} (${sourceDir})`,
    );
  }
}

function writeJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function migrateDesignSystem(slug) {
  const src = path.join(SYSTEMS_SRC, slug);
  const dest = path.join(SYSTEMS_DEST, slug);
  let meta = {};
  try {
    meta = JSON.parse(readFileSync(path.join(src, 'manifest.json'), 'utf-8'));
  } catch {
    // No od manifest — fall back to DESIGN.md-derived fields.
  }
  const design = readFileSync(path.join(src, 'DESIGN.md'), 'utf-8');
  const fallbackSummary = design
    .split('\n')
    .find((line) => line.trim() && !line.startsWith('#'))
    ?.replace(/^>\s?/, '')
    .trim();
  const description =
    truncate(meta.description) ??
    truncate(fallbackSummary) ??
    `Bundled design system: ${slug}`;

  const manifest = {
    name: `design-system-${slug}`,
    version: '0.1.0',
    description,
    ...(typeof meta.name === 'string' && meta.name
      ? { displayName: meta.name }
      : {}),
    keywords: ['design-system'],
    metadata: {
      neuma: {
        surfaces: ['design'],
        designManifest: './design-plugin.json',
      },
    },
  };
  assertManifest(manifest, src);

  rmSync(dest, { recursive: true, force: true });
  cpSync(src, dest, { recursive: true });
  writeJson(path.join(dest, '.claude-plugin/plugin.json'), manifest);
  writeJson(path.join(dest, 'design-plugin.json'), {
    specVersion: '1.0.0',
    designSystems: [{ id: slug, path: './' }],
  });
}

function migrateDesignSkill(slug) {
  const src = path.join(SKILLS_SRC, slug);
  const dest = path.join(SKILLS_DEST, slug);
  const fm = readFrontmatter(path.join(src, 'SKILL.md'));
  const description =
    truncate(fm.description) ?? `Bundled design skill: ${slug}`;

  const manifest = {
    name: `design-skill-${slug}`,
    version:
      typeof fm.version === 'string' && /^\d+\.\d+\.\d+/.test(fm.version)
        ? fm.version
        : '0.1.0',
    description,
    keywords: ['design-skill'],
    metadata: {
      neuma: {
        surfaces: ['design'],
      },
    },
  };
  assertManifest(manifest, src);

  rmSync(dest, { recursive: true, force: true });
  cpSync(src, path.join(dest, 'skills', slug), { recursive: true });
  writeJson(path.join(dest, '.claude-plugin/plugin.json'), manifest);
}

function migrateSystemExtras() {
  // The package-format schema docs and the catalog README move with the
  // content they document. `_schema` carries no plugin manifest, so the
  // loader and registry generator ignore it.
  for (const extra of SYSTEM_EXTRAS) {
    const src = path.join(SYSTEMS_SRC, extra);
    if (!existsSync(src)) continue;
    const dest = path.join(SYSTEMS_DEST, extra);
    rmSync(dest, { recursive: true, force: true });
    cpSync(src, dest, { recursive: true });
  }
}

// ---------------------------------------------------------------------------
// Verify: byte-compare every source file against its migrated counterpart.
// ---------------------------------------------------------------------------

function* walkFiles(dir, base = dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkFiles(full, base);
    } else if (entry.isFile()) {
      yield path.relative(base, full);
    }
  }
}

function compareTrees(srcRoot, destRoot, label) {
  const problems = [];
  let checked = 0;
  for (const rel of walkFiles(srcRoot)) {
    const srcFile = path.join(srcRoot, rel);
    const destFile = path.join(destRoot, rel);
    if (!existsSync(destFile)) {
      problems.push(`${label}: missing ${rel}`);
      continue;
    }
    const a = readFileSync(srcFile);
    const b = readFileSync(destFile);
    if (!a.equals(b)) {
      problems.push(`${label}: differs ${rel}`);
    }
    checked++;
  }
  return { checked, problems };
}

function verify() {
  const problems = [];
  let checked = 0;

  const systems = listContentDirs(SYSTEMS_SRC, 'DESIGN.md');
  const skills = listContentDirs(SKILLS_SRC, 'SKILL.md');

  if (systems.length === 0 && skills.length === 0) {
    // Source trees already deleted — validate the migrated tree standalone.
    const migratedSystems = listContentDirs(SYSTEMS_DEST, 'DESIGN.md');
    const migratedSkills = readdirSync(SKILLS_DEST, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => e.name);
    for (const slug of migratedSystems) {
      const manifest = path.join(
        SYSTEMS_DEST,
        slug,
        '.claude-plugin/plugin.json',
      );
      if (!existsSync(manifest))
        problems.push(`system ${slug}: missing plugin.json`);
    }
    for (const slug of migratedSkills) {
      const manifest = path.join(
        SKILLS_DEST,
        slug,
        '.claude-plugin/plugin.json',
      );
      const skillMd = path.join(SKILLS_DEST, slug, 'skills', slug, 'SKILL.md');
      if (!existsSync(manifest))
        problems.push(`skill ${slug}: missing plugin.json`);
      if (!existsSync(skillMd))
        problems.push(`skill ${slug}: missing SKILL.md`);
    }
    report(
      problems,
      migratedSystems.length + migratedSkills.length,
      'standalone',
    );
    return problems.length === 0;
  }

  for (const slug of systems) {
    const result = compareTrees(
      path.join(SYSTEMS_SRC, slug),
      path.join(SYSTEMS_DEST, slug),
      `system ${slug}`,
    );
    checked += result.checked;
    problems.push(...result.problems);
    if (
      !existsSync(path.join(SYSTEMS_DEST, slug, '.claude-plugin/plugin.json'))
    ) {
      problems.push(`system ${slug}: missing generated plugin.json`);
    }
  }
  for (const slug of skills) {
    const result = compareTrees(
      path.join(SKILLS_SRC, slug),
      path.join(SKILLS_DEST, slug, 'skills', slug),
      `skill ${slug}`,
    );
    checked += result.checked;
    problems.push(...result.problems);
    if (
      !existsSync(path.join(SKILLS_DEST, slug, '.claude-plugin/plugin.json'))
    ) {
      problems.push(`skill ${slug}: missing generated plugin.json`);
    }
  }
  report(
    problems,
    checked,
    `${systems.length} systems, ${skills.length} skills`,
  );
  return problems.length === 0;
}

function report(problems, checked, detail) {
  if (problems.length > 0) {
    for (const problem of problems) console.error(`[verify] FAIL ${problem}`);
    console.error(`[verify] ${problems.length} problems (${detail})`);
  } else {
    console.log(`[verify] OK — ${checked} files byte-identical (${detail})`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const mode = process.argv[2] ?? '--copy';

if (mode === '--verify') {
  process.exit(verify() ? 0 : 1);
} else if (mode === '--delete-source') {
  if (!verify()) {
    console.error('[migrate] verify failed; refusing to delete source trees');
    process.exit(1);
  }
  rmSync(SYSTEMS_SRC, { recursive: true, force: true });
  rmSync(SKILLS_SRC, { recursive: true, force: true });
  console.log('[migrate] removed source design-systems/ and skills/ trees');
} else if (mode === '--copy') {
  const systems = listContentDirs(SYSTEMS_SRC, 'DESIGN.md');
  const skills = listContentDirs(SKILLS_SRC, 'SKILL.md');
  if (systems.length === 0 && skills.length === 0) {
    console.error('[migrate] nothing to migrate (source trees empty or gone)');
    process.exit(1);
  }
  mkdirSync(SYSTEMS_DEST, { recursive: true });
  mkdirSync(SKILLS_DEST, { recursive: true });
  for (const slug of systems) migrateDesignSystem(slug);
  for (const slug of skills) migrateDesignSkill(slug);
  migrateSystemExtras();
  console.log(
    `[migrate] migrated ${systems.length} design systems and ${skills.length} design skills`,
  );
  if (!verify()) process.exit(1);
} else {
  console.error(`[migrate] unknown mode: ${mode}`);
  process.exit(1);
}
