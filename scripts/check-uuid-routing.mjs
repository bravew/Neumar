import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_ROOT = path.join(ROOT, 'src');
const UUID_HELPER = path.join(SRC_ROOT, 'shared/utils/uuid.ts');
const CHECKED_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(fullPath)));
      continue;
    }
    if (entry.isFile() && CHECKED_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }
  return files;
}

const offenders = [];
for (const file of await walk(SRC_ROOT)) {
  if (file === UUID_HELPER) continue;
  const body = await readFile(file, 'utf-8');
  if (body.includes('crypto.randomUUID(')) {
    offenders.push(path.relative(ROOT, file));
  }
}

if (offenders.length > 0) {
  console.error(
    [
      'Direct crypto.randomUUID() calls must route through src/shared/utils/uuid.ts.',
      ...offenders.map((file) => `- ${file}`),
    ].join('\n'),
  );
  process.exit(1);
}
