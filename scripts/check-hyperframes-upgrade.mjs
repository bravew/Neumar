import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const videoRoot = path.join(root, 'src-video');
const result = spawnSync(
  'pnpm',
  ['exec', 'hyperframes', 'upgrade', '--project', '.', '--check', '--json'],
  { cwd: videoRoot, encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: 30_000 },
);

if (result.error) throw result.error;
if (result.status !== 0) {
  process.stderr.write(result.stderr || result.stdout);
  process.exit(result.status ?? 1);
}

let payload;
try {
  payload = JSON.parse(result.stdout);
} catch {
  throw new Error('HyperFrames upgrade check returned malformed JSON.');
}

const current = payload?._meta?.version;
const latest = payload?._meta?.latestVersion;
const updateAvailable = payload?._meta?.updateAvailable;
if (
  typeof current !== 'string' ||
  typeof latest !== 'string' ||
  typeof updateAvailable !== 'boolean'
) {
  throw new Error('HyperFrames upgrade check returned an invalid payload.');
}

if (updateAvailable) {
  console.log(
    `HyperFrames update available: ${current} -> ${latest}. No files changed; ask before upgrading.`,
  );
} else {
  console.log(`HyperFrames ${current} is current. No files changed.`);
}
