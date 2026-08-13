import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

export function flag(args, name) {
  const idx = args.indexOf(name);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

export function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return full;
  });
}

export function extractField(source, field) {
  const re = new RegExp(`${field}\\s*[:=]\\s*['"\`]([^'"\`]+)['"\`]`);
  return source.match(re)?.[1];
}

const ID_RE = /(?:^|\n)\s*id:\s*([A-Za-z0-9_-]+)/;
const TIER_RE = /(?:^|\n)\s*tier:\s*(gate|periodic)/;

/** Parse the metadata neuma eval scripts care about from a case file's source. */
export function readCaseMeta(root, file) {
  const source = readFileSync(join(root, file), 'utf8');
  return {
    file,
    id:
      extractField(source, 'id') ??
      source.match(ID_RE)?.[1] ??
      file.split('/').pop(),
    tier:
      extractField(source, 'tier') ?? source.match(TIER_RE)?.[1] ?? 'unknown',
    touchfiles: parseTouchfiles(source),
  };
}

export function listCaseFiles(root, dirs) {
  return dirs
    .flatMap((dir) => walk(join(root, dir)))
    .filter((file) => file.endsWith('.case.ts') || file.endsWith('.case.yaml'))
    .map((file) => relative(root, file));
}

function parseTouchfiles(source) {
  const touchfiles = [];
  const tsArr = source.match(/touchfiles\s*:\s*\[([\s\S]*?)\]/);
  if (tsArr) {
    for (const quoted of tsArr[1].matchAll(/['"`]([^'"`]+)['"`]/g)) {
      touchfiles.push(quoted[1]);
    }
  }
  const yaml = source.match(/touchfiles:\s*\n((?:\s+-\s+.+\n?)+)/);
  if (yaml) {
    for (const line of yaml[1].split('\n')) {
      const match = line.match(/^\s+-\s+(.+?)\s*$/);
      if (match) touchfiles.push(match[1].replace(/^['"]|['"]$/g, ''));
    }
  }
  return [...new Set(touchfiles)];
}
