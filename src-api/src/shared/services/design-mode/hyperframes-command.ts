import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HYPERFRAMES_BIN =
  process.platform === 'win32' ? 'hyperframes.cmd' : 'hyperframes';

export function resolveHyperframesCommand() {
  const configured = process.env.NEUMA_HYPERFRAMES_BIN?.trim();
  if (configured) return configured;
  return resolveWorkspaceHyperframesBin() ?? 'hyperframes';
}

function resolveWorkspaceHyperframesBin() {
  let moduleDir: string;
  try {
    moduleDir = path.dirname(fileURLToPath(import.meta.url));
  } catch {
    return null;
  }
  const candidate = path.resolve(
    moduleDir,
    '../../../../../src-video/node_modules/.bin',
    HYPERFRAMES_BIN,
  );
  return existsSync(candidate) ? candidate : null;
}
