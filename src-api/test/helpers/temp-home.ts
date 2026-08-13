import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

export async function withTempHome<T>(
  fn: (home: string) => Promise<T>,
): Promise<T> {
  const tempHome = mkdtempSync(join(tmpdir(), 'neumar-test-'));
  const originalHome = process.env.HOME;
  process.env.HOME = tempHome;

  try {
    return await fn(tempHome);
  } finally {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    rmSync(tempHome, { recursive: true, force: true });
  }
}
