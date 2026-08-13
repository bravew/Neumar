import fs from 'node:fs/promises';
import path from 'node:path';

import { isIgnoredProjectDirName } from '../ignored-project-dirs';

const MAX_ENTRIES = 50_000;
const MAX_FILE_BYTES = 100 * 1024 * 1024;

export interface FolderImportSummary {
  path: string;
  fileCount: number;
  totalBytes: number;
}

export async function validateImportFolder(
  inputPath: string,
): Promise<FolderImportSummary> {
  const canonical = await fs.realpath(inputPath);
  assertNotSystemPath(canonical);
  const stat = await fs.stat(canonical);
  if (!stat.isDirectory()) throw new Error('Import path must be a directory.');

  let fileCount = 0;
  let totalBytes = 0;
  const seen = new Set<string>();

  async function visit(dir: string) {
    const real = await fs.realpath(dir);
    if (seen.has(real)) return;
    seen.add(real);
    const entries = await fs.readdir(real, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && isIgnoredProjectDirName(entry.name)) continue;
      const abs = path.join(real, entry.name);
      if (entry.isDirectory()) {
        await visit(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      const item = await fs.stat(abs);
      if (item.size > MAX_FILE_BYTES) {
        throw new Error(`File exceeds 100 MB import limit: ${entry.name}`);
      }
      fileCount += 1;
      totalBytes += item.size;
      if (fileCount > MAX_ENTRIES) {
        throw new Error('Folder import exceeds 50,000 file limit.');
      }
    }
  }

  await visit(canonical);
  return { path: canonical, fileCount, totalBytes };
}

function assertNotSystemPath(value: string) {
  const normalized = value.replace(/\\/g, '/').toLowerCase();
  const parsed = path.parse(value);
  if (path.normalize(value) === path.normalize(parsed.root)) {
    throw new Error(
      'Filesystem root cannot be imported as a DesignMode project.',
    );
  }
  const blocked = [
    '/system',
    '/bin',
    '/sbin',
    '/usr/bin',
    '/usr/sbin',
    '/etc',
    '/proc',
    '/dev',
    '/sys',
    '/run',
    'c:/windows',
    'c:/program files',
  ];
  if (
    blocked.some(
      (prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`),
    )
  ) {
    throw new Error(
      'System directories cannot be imported as DesignMode projects.',
    );
  }
}
