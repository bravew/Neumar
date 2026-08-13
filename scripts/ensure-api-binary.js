#!/usr/bin/env node

/**
 * Ensures the API sidecar binary exists for the current platform.
 * Used by predev:app so `pnpm dev:app` works without a full build.
 * If the binary is missing, runs the appropriate build:api:binary:* script.
 *
 * Binary name is read from /branding.json (single source of truth).
 */

import { execSync } from 'child_process';
import { cpSync, existsSync, readFileSync, readdirSync, rmSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const DIST_DIR = join(PROJECT_ROOT, 'src-api', 'dist');
const DESIGN_MODE_SRC = join(
  PROJECT_ROOT,
  'src-api',
  'src',
  'shared',
  'design-mode',
);
const DESIGN_MODE_DEST = join(DIST_DIR, 'design-mode');
const BUILTIN_PLUGINS_SRC = join(PROJECT_ROOT, 'plugins', 'builtin');
const BUILTIN_PLUGINS_DEST = join(DIST_DIR, 'plugins', 'builtin');

function assertPortableResourcePaths(dir, root = dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (/[^\x00-\x7F]/.test(entry.name)) {
      throw new Error(
        `Non-ASCII resource path is not safe for signed macOS bundles: ${fullPath.replace(
          root + '/',
          '',
        )}`,
      );
    }
    if (entry.isDirectory()) {
      assertPortableResourcePaths(fullPath, root);
    }
  }
}

function syncResourceCatalog(src, dest, label) {
  if (!existsSync(src)) {
    console.warn(`[ensure-api-binary] ${label} not found at ${src}`);
    return;
  }

  assertPortableResourcePaths(src);
  rmSync(dest, { recursive: true, force: true });
  cpSync(src, dest, {
    recursive: true,
    filter: (source) => {
      return !source.endsWith('.ts') && !source.endsWith('.tsx');
    },
  });
  console.log(
    `[ok] ${label} synced to ${dest.replace(PROJECT_ROOT + '/', '')}`,
  );
}

syncResourceCatalog(DESIGN_MODE_SRC, DESIGN_MODE_DEST, 'design-mode catalog');
syncResourceCatalog(
  BUILTIN_PLUGINS_SRC,
  BUILTIN_PLUGINS_DEST,
  'builtin plugins',
);

// Read binary name from branding.json (single source of truth)
const branding = JSON.parse(
  readFileSync(join(PROJECT_ROOT, 'branding.json'), 'utf-8'),
);
const BINARY_NAME = branding.api.binaryName;

// Map (platform, arch) to binary name (no path) and pnpm script
function getBinaryInfo() {
  const platform = process.platform;
  const arch = process.arch;

  if (platform === 'darwin') {
    const script =
      arch === 'arm64'
        ? 'build:api:binary:mac-arm'
        : 'build:api:binary:mac-intel';
    const triple =
      arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin';
    return { name: `${BINARY_NAME}-${triple}`, script };
  }
  if (platform === 'linux') {
    return {
      name: `${BINARY_NAME}-x86_64-unknown-linux-gnu`,
      script: 'build:api:binary:linux',
    };
  }
  if (platform === 'win32') {
    return {
      name: `${BINARY_NAME}-x86_64-pc-windows-msvc.exe`,
      script: 'build:api:binary:windows',
    };
  }
  return null;
}

const info = getBinaryInfo();
if (!info) {
  console.warn(
    `[ensure-api-binary] Unsupported platform; Tauri may fail if ${BINARY_NAME} is required.`,
  );
  process.exit(0);
}

const binaryPath = join(DIST_DIR, info.name);
if (existsSync(binaryPath)) {
  console.log(`[ok] ${BINARY_NAME} binary found: ${info.name}`);
  process.exit(0);
}

console.log(`Building ${BINARY_NAME} for current platform (${info.name})...`);
try {
  execSync(`pnpm ${info.script}`, {
    cwd: PROJECT_ROOT,
    stdio: 'inherit',
  });
  console.log(`[ok] ${BINARY_NAME} binary built successfully`);
} catch (err) {
  console.error(
    `Failed to build ${BINARY_NAME} binary. Run manually: pnpm`,
    info.script,
  );
  process.exit(1);
}
