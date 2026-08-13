import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const SCRIPT = await readFile(
  new URL('./check-uuid-routing.mjs', import.meta.url),
  'utf-8',
);

test('uuid routing check flags direct frontend crypto.randomUUID calls', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'uuid-routing-'));
  try {
    await mkdir(path.join(root, 'src/shared/utils'), { recursive: true });
    await mkdir(path.join(root, 'src/components'), { recursive: true });
    await writeFile(
      path.join(root, 'src/shared/utils/uuid.ts'),
      'export const id = () => crypto.randomUUID();\n',
    );
    await writeFile(
      path.join(root, 'src/components/Bad.tsx'),
      'export const id = crypto.randomUUID();\n',
    );
    await mkdir(path.join(root, 'scripts'), { recursive: true });
    await writeFile(path.join(root, 'scripts/check-uuid-routing.mjs'), SCRIPT);

    const { spawnSync } = await import('node:child_process');
    const result = spawnSync(
      process.execPath,
      [path.join(root, 'scripts/check-uuid-routing.mjs')],
      { encoding: 'utf-8' },
    );

    assert.equal(result.status, 1);
    assert.match(result.stderr, /src\/components\/Bad\.tsx/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
