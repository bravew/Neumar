import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

// Read-only probe: it reports whether a newer HyperFrames exists and never
// changes a file. It runs inside `pnpm validate`, so an offline machine or a
// missing CLI must warn rather than fail the whole validation run — only the
// upgrade decision itself is gated, and that stays a human call.
function warn(message) {
  console.warn(`HyperFrames upgrade check skipped: ${message}`);
  process.exit(0);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const videoRoot = path.join(root, 'src-video');
const result = spawnSync(
  'pnpm',
  ['exec', 'hyperframes', 'upgrade', '--project', '.', '--check', '--json'],
  { cwd: videoRoot, encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: 30_000 },
);

if (result.error) warn(result.error.message);
if (result.status !== 0) {
  warn(
    (result.stderr || result.stdout || '').trim() || `exit ${result.status}`,
  );
}

let payload;
try {
  payload = JSON.parse(result.stdout);
} catch {
  warn('the CLI returned malformed JSON.');
}

const current = payload?._meta?.version;
const latest = payload?._meta?.latestVersion;
const updateAvailable = payload?._meta?.updateAvailable;
if (
  typeof current !== 'string' ||
  typeof latest !== 'string' ||
  typeof updateAvailable !== 'boolean'
) {
  warn('the CLI returned an invalid payload.');
}

if (updateAvailable) {
  console.log(
    `HyperFrames update available: ${current} -> ${latest}. No files changed; ask before upgrading.`,
  );
} else {
  console.log(`HyperFrames ${current} is current. No files changed.`);
}
