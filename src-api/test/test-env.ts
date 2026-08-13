import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

export function installTestEnv(): { cleanup: () => void; tempHome: string } {
  const tempHome = mkdtempSync(join(tmpdir(), 'neumar-test-'));
  const originalKeys = new Set(Object.keys(process.env));
  const originalEnv = { ...process.env };

  process.env.HOME = tempHome;

  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.LINEAR_API_KEY;
  delete process.env.PORT;

  const cleanup = () => {
    // Remove any keys that were added during the test
    for (const key of Object.keys(process.env)) {
      if (!originalKeys.has(key)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnv);
    rmSync(tempHome, { recursive: true, force: true });
  };

  return { cleanup, tempHome };
}
