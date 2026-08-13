import { execFileSync, spawnSync } from 'child_process';
import {
  copyFileSync,
  cpSync,
  createWriteStream,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
} from 'fs';
import { createRequire } from 'module';
import { dirname, join, relative as pathRelative, resolve } from 'path';
import { pipeline } from 'stream/promises';

import { config } from 'dotenv';
import { build } from 'esbuild';

// Minimal logger shim — avoids bare console.* (forbidden in src-api/ per CLAUDE.md)
const buildLog = (...args) => process.stdout.write(args.join(' ') + '\n');
const buildWarn = (...args) =>
  process.stderr.write('[warn] ' + args.join(' ') + '\n');
const buildError = (...args) =>
  process.stderr.write('[error] ' + args.join(' ') + '\n');

// OAuth env vars to inline at build time.
// Google credentials are bundled (PKCE + redirect URI validation protect the flow).
// Slack/Notion credentials are user-provided via Settings (never bundled).
const OAUTH_KEYS = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'];

// Rollout flags are build-time decisions for packaged sidecars.
const BUILD_FLAG_KEYS = ['NEUMA_CONNECTORS_PLATFORM_V2'];

// Load .env (does not overwrite existing env vars)
config();

// Build esbuild `define` map for bundled OAuth keys and rollout flags.
const define = {};
const missing = [];

for (const key of OAUTH_KEYS) {
  const value = process.env[key];
  if (value) {
    define[`process.env.${key}`] = JSON.stringify(value);
  } else {
    missing.push(key);
  }
}

for (const key of BUILD_FLAG_KEYS) {
  const value = process.env[key];
  if (value) {
    define[`process.env.${key}`] = JSON.stringify(value);
  }
}

if (missing.length) {
  buildWarn(
    `[build] Warning: missing env vars (will remain as process.env.* at runtime): ${missing.join(', ')}`,
  );
}

// ── Node.js ABI version mapping ──────────────────────────────────────────────
// Maps pkg target Node.js major version to NODE_MODULE_VERSION (ABI).
// When adding a new Node.js major, add its MODULE_VERSION here.
const NODE_ABI_MAP = {
  18: 108,
  20: 115,
  22: 127,
};

// ── Cross-compilation target resolution ───────────────────────────────────────
// Set PKG_TARGET_PLATFORM (darwin, linux, win32) and PKG_TARGET_ARCH (arm64, x64)
// to cross-compile for a different platform. Falls back to the host system values.
const TARGET_PLATFORM = process.env.PKG_TARGET_PLATFORM || process.platform;
const TARGET_ARCH = process.env.PKG_TARGET_ARCH || process.arch;

/**
 * esbuild plugin: replace the 'bindings' module with a pkg-compatible resolver.
 *
 * better-sqlite3 uses `require('bindings')('better_sqlite3.node')` to locate
 * its native addon. Inside a pkg binary, the default `bindings` module fails
 * because it resolves paths relative to the snapshot VFS.
 *
 * This plugin replaces `bindings` with a resolver that looks for .node files
 * in __dirname (the bundle directory). When pkg includes the .node file as an
 * asset in the VFS, it automatically extracts it to a temp directory and loads
 * it from there.
 */
const nativeBindingsPlugin = {
  name: 'native-bindings',
  setup(b) {
    b.onResolve({ filter: /^bindings$/ }, () => ({
      path: 'bindings',
      namespace: 'native-bindings',
    }));
    // Use a static require path so pkg can resolve and include the .node file.
    // better-sqlite3 is the only consumer of `bindings` in this codebase.
    b.onLoad({ filter: /.*/, namespace: 'native-bindings' }, () => ({
      contents: `module.exports = function() { return require('./better_sqlite3.node'); };`,
      resolveDir: resolve('dist'),
      loader: 'js',
    }));
    // Mark native .node addons as external — they can't be bundled by esbuild.
    // grammy uses require("./platform.node") which resolves to platform.node.js —
    // we must let esbuild bundle those. Only mark as external when a .js counterpart
    // doesn't exist (i.e. it's a real native addon like better_sqlite3.node).
    b.onResolve({ filter: /\.node$/ }, (args) => {
      if (args.resolveDir) {
        const candidate = join(args.resolveDir, args.path + '.js');
        if (existsSync(candidate)) return; // Let esbuild resolve .node → .node.js
      }
      return { path: args.path, external: true };
    });
  },
};

/**
 * esbuild plugin: stub HuggingFace's optional sharp import, and route app-level
 * sharp calls through a RESOURCES_DIR-aware loader.
 *
 * CAMS, assets, and design export code use sharp at runtime. In a pkg binary,
 * sharp's JS can be snapshotted but its optional native @img packages cannot.
 * The shim loads sharp from Tauri Resources where those native packages live.
 */
const sharpResolverPlugin = {
  name: 'sharp-resolver',
  setup(b) {
    b.onResolve({ filter: /^sharp$/ }, (args) => {
      if (args.importer.includes('@huggingface/transformers')) {
        return {
          path: 'sharp',
          namespace: 'sharp-stub',
        };
      }
      if (args.namespace === 'sharp-shim') {
        return { path: 'sharp', external: true };
      }
      return { path: 'sharp', namespace: 'sharp-shim' };
    });
    b.onLoad({ filter: /.*/, namespace: 'sharp-stub' }, () => ({
      contents: `module.exports = {};`,
      loader: 'js',
    }));
    b.onLoad({ filter: /.*/, namespace: 'sharp-shim' }, () => ({
      contents: `
        var _path = require('path');
        var _fs = require('fs');
        var _sharp;
        var _resDir = process.env.RESOURCES_DIR;
        if (_resDir) {
          var _bundled = _path.join(
            _resDir, '_up_', 'src-api', 'dist', 'sharp',
            'node_modules', 'sharp'
          );
          if (_fs.existsSync(_bundled)) {
            _sharp = require(_bundled);
          }
        }
        if (!_sharp) {
          if (process.pkg) {
            throw new Error(
              'sharp: RESOURCES_DIR not set or bundled native package missing in pkg binary. ' +
              'RESOURCES_DIR=' + (process.env.RESOURCES_DIR ?? '(not set)')
            );
          }
          _sharp = require('sharp');
        }
        module.exports = _sharp;
      `,
      loader: 'js',
    }));
  },
};

/**
 * esbuild plugin: shim onnxruntime-node with RESOURCES_DIR-aware loader.
 *
 * @huggingface/transformers (bundled by esbuild) contains a top-level
 * require("onnxruntime-node") in its Node.js backend (transformers.node.mjs).
 * This executes at module initialization — before our loadOnnxRuntime() function
 * with RESOURCES_DIR logic can run. In a pkg binary, this bare require resolves
 * from the VFS where native .node addons don't exist.
 *
 * This plugin replaces ALL require("onnxruntime-node") with a shim that checks
 * RESOURCES_DIR first (production/Tauri) and falls back to normal require (dev).
 * onnxruntime-node is removed from the `external` array so this plugin can
 * intercept the imports.
 */
const onnxruntimeShimPlugin = {
  name: 'onnxruntime-shim',
  setup(b) {
    b.onResolve({ filter: /^onnxruntime-node$/ }, (args) => {
      // Requires from within the shim itself → mark as external (dev fallback)
      if (args.namespace === 'onnxruntime-shim') {
        return { path: 'onnxruntime-node', external: true };
      }
      // All other requires → redirect to shim
      return { path: 'onnxruntime-node', namespace: 'onnxruntime-shim' };
    });
    b.onLoad({ filter: /.*/, namespace: 'onnxruntime-shim' }, () => ({
      contents: `
        var _path = require('path');
        var _fs = require('fs');
        var _ort;
        var _resDir = process.env.RESOURCES_DIR;
        if (_resDir) {
          var _bundled = _path.join(
            _resDir, '_up_', 'src-api', 'dist', 'onnxruntime',
            'node_modules', 'onnxruntime-node'
          );
          if (_fs.existsSync(_bundled)) {
            _ort = require(_bundled);
          }
        }
        if (!_ort) {
          if (process.pkg) {
            throw new Error(
              'onnxruntime-node: RESOURCES_DIR not set or bundled addon missing in pkg binary. ' +
              'RESOURCES_DIR=' + (process.env.RESOURCES_DIR ?? '(not set)')
            );
          }
          _ort = require('onnxruntime-node');
        }
        module.exports = _ort;
      `,
      loader: 'js',
    }));
  },
};

/**
 * Download a prebuilt better-sqlite3 native addon from GitHub releases.
 * Returns the path to the downloaded .node file, or null on failure.
 *
 * @param {string} version   - better-sqlite3 version (e.g. "12.6.2")
 * @param {number} abi       - NODE_MODULE_VERSION (e.g. 115 for Node 20)
 * @param {string} platform  - OS name: "darwin", "linux", "win32"
 * @param {string} arch      - CPU arch: "arm64", "x64"
 */
async function downloadPrebuilt(version, abi, platform, arch) {
  const tag = `v${version}`;
  const tarName = `better-sqlite3-${tag}-node-v${abi}-${platform}-${arch}.tar.gz`;
  const url = `https://github.com/WiseLibs/better-sqlite3/releases/download/${tag}/${tarName}`;

  const cacheDir = resolve('dist/.native-cache');
  const cachedFile = join(
    cacheDir,
    `better_sqlite3-node${abi}-${platform}-${arch}.node`,
  );

  if (existsSync(cachedFile)) {
    buildLog(`[build] Using cached prebuilt: ${cachedFile}`);
    return cachedFile;
  }

  buildLog(`[build] Downloading prebuilt: ${url}`);
  mkdirSync(cacheDir, { recursive: true });

  try {
    const tarPath = join(cacheDir, tarName);
    const res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await pipeline(res.body, createWriteStream(tarPath));

    // Extract the .node file from the tarball
    execFileSync('tar', ['xzf', tarPath, '-C', cacheDir], { stdio: 'pipe' });

    // The prebuilt tar contains: build/Release/better_sqlite3.node
    const extractedPath = join(
      cacheDir,
      'build',
      'Release',
      'better_sqlite3.node',
    );
    if (existsSync(extractedPath)) {
      copyFileSync(extractedPath, cachedFile);
      // Cleanup extracted files and tarball
      execFileSync('rm', ['-rf', join(cacheDir, 'build'), tarPath], {
        stdio: 'pipe',
      });
      buildLog(`[build] Prebuilt downloaded and cached: ${cachedFile}`);
      return cachedFile;
    }
    throw new Error('better_sqlite3.node not found in tarball');
  } catch (err) {
    buildWarn(`[build] Failed to download prebuilt: ${err.message}`);
    return null;
  }
}

/**
 * Resolve the correct better_sqlite3.node for the pkg target.
 *
 * Strategy:
 * 1. If PKG_NODE_RANGE env var is set (e.g. "20"), download prebuilt for that ABI
 * 2. Fall back to locally compiled .node (works when system Node.js matches pkg target)
 */
async function resolveNativeAddon() {
  const dest = resolve('dist/better_sqlite3.node');

  // Determine better-sqlite3 version from package.json
  const bsVersion = (
    await import('better-sqlite3/package.json', { with: { type: 'json' } })
  ).default.version;

  // If PKG_NODE_RANGE is set, download prebuilt for that Node.js ABI
  const pkgNodeRange = process.env.PKG_NODE_RANGE;
  if (pkgNodeRange) {
    const abi = NODE_ABI_MAP[parseInt(pkgNodeRange, 10)];
    if (!abi) {
      buildWarn(
        `[build] Unknown PKG_NODE_RANGE=${pkgNodeRange}, falling back to local .node`,
      );
    } else {
      const systemAbi = parseInt(process.versions.modules, 10);
      if (abi === systemAbi) {
        // System Node.js matches the target — use locally compiled
        buildLog(
          `[build] System ABI (${systemAbi}) matches target — using local .node`,
        );
      } else {
        // Need prebuilt for a different ABI
        const arch = TARGET_ARCH === 'arm64' ? 'arm64' : 'x64';
        const prebuilt = await downloadPrebuilt(
          bsVersion,
          abi,
          TARGET_PLATFORM,
          arch,
        );
        if (prebuilt) {
          copyFileSync(prebuilt, dest);
          buildLog(`[build] Copied prebuilt better_sqlite3.node to dist/`);
          return;
        }
        throw new Error(
          `[build] No better_sqlite3 prebuilt available for target ABI ${abi}; ` +
            `refusing to copy local ABI ${systemAbi}. Build with Node ${pkgNodeRange} ` +
            'or provide a matching prebuilt native addon.',
        );
      }
    }
  }

  // Fall back to locally compiled .node file
  const localAddon = resolve(
    'node_modules/better-sqlite3/build/Release/better_sqlite3.node',
  );
  if (existsSync(localAddon)) {
    copyFileSync(localAddon, dest);
    buildLog('[build] Copied local better_sqlite3.node to dist/');
  } else {
    buildWarn(
      '[build] Warning: better_sqlite3.node not found — binary may fail at runtime',
    );
  }
}

/**
 * Copy sherpa-onnx native addon files for Tauri resource bundling.
 *
 * pkg-compiled binaries can't resolve sherpa-onnx-node's native .node addon
 * via normal require() — the addon.js resolution paths are relative to the
 * VFS snapshot. Instead, we bundle the native files in Tauri Resources and
 * load them from an absolute path at runtime.
 *
 * Structure: dist/sherpa-onnx/
 *   ├── *.js, package.json  (from sherpa-onnx-node)
 *   ├── sherpa-onnx.node    (from sherpa-onnx-darwin-arm64)
 *   └── lib*.dylib           (from sherpa-onnx-darwin-arm64)
 */
/**
 * Copy the design-mode catalog tree to dist/ so it ships as a Tauri resource.
 * Skip TS/TSX source files; only data files (.json, .md, etc.) are needed.
 */
function assertPortableDesignModePaths(dir, root = dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (/[^\x00-\x7F]/.test(entry.name)) {
      throw new Error(
        `Non-ASCII design-mode path is not safe for signed macOS bundles: ${fullPath.replace(
          root + '/',
          '',
        )}`,
      );
    }
    if (entry.isDirectory()) {
      assertPortableDesignModePaths(fullPath, root);
    }
  }
}

function copyDesignModeCatalog() {
  const src = resolve('src/shared/design-mode');
  const dest = resolve('dist/design-mode');
  if (!existsSync(src)) {
    buildWarn('[build] src/shared/design-mode not found, skipping copy');
    return;
  }
  assertPortableDesignModePaths(src);
  rmSync(dest, { recursive: true, force: true });
  cpSync(src, dest, {
    recursive: true,
    filter: (source) => {
      // Skip TypeScript source — keep .json, .md, and everything else.
      return !source.endsWith('.ts') && !source.endsWith('.tsx');
    },
  });
  buildLog('[build] Copied design-mode catalog to dist/design-mode/');
}

/**
 * Copy the repo-shipped builtin plugins (`/plugins/builtin/`) to dist/ so they
 * ship as a Tauri resource. `shared/plugins/paths.ts` resolves this via
 * RESOURCES_DIR/_up_/src-api/dist/plugins/builtin/ at runtime.
 */
function copyBuiltinPlugins() {
  const src = resolve('../plugins/builtin');
  const dest = resolve('dist/plugins/builtin');
  if (!existsSync(src)) {
    buildWarn('[build] /plugins/builtin not found, skipping copy');
    return;
  }
  assertPortableDesignModePaths(src);
  rmSync(dest, { recursive: true, force: true });
  cpSync(src, dest, {
    recursive: true,
    filter: (source) => {
      return !source.endsWith('.ts') && !source.endsWith('.tsx');
    },
  });
  buildLog('[build] Copied builtin plugins to dist/plugins/builtin/');
}

/**
 * Inspect a Mach-O / ELF / PE file and return the set of native library names
 * it directly references. Used to prune unreferenced dylibs from the bundle
 * (CP3a in dev-doc/plan/2026-05-05-package-size-optimization.md).
 *
 * Returns a Set of plain filenames (no @rpath/ prefix). On platforms or
 * environments where the inspector isn't available, returns null — caller
 * should fall back to copying every native file.
 */
function getDirectlyReferencedLibs(binaryPath) {
  if (!existsSync(binaryPath)) return null;
  if (TARGET_PLATFORM === 'darwin') {
    const r = spawnSync('otool', ['-L', binaryPath], { encoding: 'utf8' });
    if (r.status !== 0) return null;
    const referenced = new Set();
    for (const line of r.stdout.split('\n').slice(1)) {
      const m = line.trim().match(/^(\S+)/);
      if (!m) continue;
      const path = m[1];
      // Strip @rpath/ @loader_path/ etc. prefix; keep just the leaf filename.
      referenced.add(path.split('/').pop());
    }
    return referenced;
  }
  if (TARGET_PLATFORM === 'linux') {
    const r = spawnSync('readelf', ['-d', binaryPath], { encoding: 'utf8' });
    if (r.status !== 0) return null;
    const referenced = new Set();
    for (const line of r.stdout.split('\n')) {
      const m = line.match(/\(NEEDED\)\s+Shared library: \[([^\]]+)\]/);
      if (m) referenced.add(m[1]);
    }
    return referenced;
  }
  // Windows DLL deps via `dumpbin /dependents` would require the MSVC tools;
  // skip the prune on Windows for now and let the full set ship.
  return null;
}

function isNativeFile(filename) {
  return (
    filename.endsWith('.node') ||
    filename.endsWith('.dylib') ||
    filename.endsWith('.dll') ||
    filename.endsWith('.so') ||
    /\.so\.\d+/.test(filename)
  );
}

function resolvePackageDir(packageName) {
  const segments = packageName.split('/');
  const packagePath = [process.cwd(), resolve(process.cwd(), '..')]
    .flatMap((root) => [
      join(root, 'node_modules', ...segments),
      join(root, 'node_modules', '.pnpm', 'node_modules', ...segments),
    ])
    .find((candidate) => existsSync(candidate));
  return packagePath ? realpathSync(packagePath) : null;
}

function copyNodePackage(packageName, destBase) {
  const source = resolvePackageDir(packageName);
  if (!source) {
    buildWarn(`[build] ${packageName} not found, skipping copy`);
    return false;
  }

  const dest = join(destBase, ...packageName.split('/'));
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(source, dest, { recursive: true, dereference: true });
  return true;
}

// pnpm gives each package its own isolated dependency resolution — a
// transitive dependency (e.g. semver's lru-cache, or lru-cache's own
// yallist) can live only inside that package's private node_modules, at a
// different major version than whatever is hoisted to the top level.
// Follow each package's actual require() resolution recursively instead of
// assuming the hoisted copy is compatible.
function copyPackageDependenciesDeep(
  fromPackageName,
  destBase,
  seen = new Set(),
) {
  const fromDir = resolvePackageDir(fromPackageName);
  if (!fromDir) return;
  copyDepsFromDir(fromDir, destBase, seen);
}

function copyDepsFromDir(fromDir, destBase, seen) {
  const pkgJsonPath = join(fromDir, 'package.json');
  if (!existsSync(pkgJsonPath)) return;

  const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
  const deps = Object.keys(pkgJson.dependencies ?? {});
  if (deps.length === 0) return;

  const req = createRequire(pkgJsonPath);
  for (const depName of deps) {
    if (seen.has(depName)) continue;
    seen.add(depName);

    let depEntry;
    try {
      depEntry = req.resolve(depName);
    } catch {
      buildWarn(
        `[build] ${depName} not resolvable from ${pkgJson.name}, skipping copy`,
      );
      continue;
    }

    let dir = dirname(depEntry);
    while (dir !== dirname(dir) && !existsSync(join(dir, 'package.json'))) {
      dir = dirname(dir);
    }
    if (!existsSync(join(dir, 'package.json'))) {
      buildWarn(
        `[build] Could not locate package.json for ${depName}, skipping copy`,
      );
      continue;
    }

    const dest = join(destBase, ...depName.split('/'));
    rmSync(dest, { recursive: true, force: true });
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(dir, dest, { recursive: true, dereference: true });

    copyDepsFromDir(dir, destBase, seen);
  }
}

function sharpNativePackages() {
  // TARGET_ARCH must use Node.js naming (arm64/x64/ia32). Fail loudly on an
  // unknown value (e.g. Rust's `aarch64`) rather than silently bundling the
  // wrong native binaries.
  if (!['arm64', 'x64', 'ia32'].includes(TARGET_ARCH)) {
    throw new Error(
      `Unknown TARGET_ARCH "${TARGET_ARCH}" — expected Node.js arch naming (arm64, x64, ia32)`,
    );
  }
  const arch =
    TARGET_ARCH === 'arm64' ? 'arm64' : TARGET_ARCH === 'ia32' ? 'ia32' : 'x64';

  if (TARGET_PLATFORM === 'darwin') {
    return [`@img/sharp-darwin-${arch}`, `@img/sharp-libvips-darwin-${arch}`];
  }
  if (TARGET_PLATFORM === 'linux') {
    return [`@img/sharp-linux-${arch}`, `@img/sharp-libvips-linux-${arch}`];
  }
  if (TARGET_PLATFORM === 'win32') {
    return [`@img/sharp-win32-${arch}`];
  }
  return [];
}

function copySharpNative() {
  const destBase = resolve('dist/sharp/node_modules');
  rmSync(resolve('dist/sharp'), { recursive: true, force: true });
  mkdirSync(destBase, { recursive: true });

  const copiedSharp = copyNodePackage('sharp', destBase);
  if (!copiedSharp) {
    buildWarn('[build] sharp package missing — image processing may fail');
    return;
  }

  for (const packageName of [
    '@img/colour',
    'detect-libc',
    'semver',
    ...sharpNativePackages(),
  ]) {
    copyNodePackage(packageName, destBase);
  }

  // semver's own dependency chain (lru-cache -> yallist) isn't reachable
  // via the hoisted node_modules lookups copyNodePackage relies on (see
  // copyPackageDependenciesDeep) — without it, the pkg-bundled sidecar
  // crashes at startup with "Cannot find module 'lru-cache'"/'yallist'.
  copyPackageDependenciesDeep('semver', destBase);

  buildLog(`[build] Copied sharp native files to dist/sharp/`);
}

function copySherpaOnnxNative() {
  const platform = TARGET_PLATFORM;
  const arch = TARGET_ARCH;
  const platformArch = `${platform === 'win32' ? 'win32' : platform}-${arch}`;
  const nativePkg = `sherpa-onnx-${platformArch}`;

  const sherpaNodeLink = resolve('node_modules/sherpa-onnx-node');
  if (!existsSync(sherpaNodeLink)) {
    buildWarn('[build] sherpa-onnx-node not found, skipping native copy');
    return;
  }

  // Resolve real path (pnpm uses symlinks → .pnpm store)
  const sherpaNodeDir = realpathSync(sherpaNodeLink);

  // Resolve platform-specific package (pnpm stores it as a sibling in the .pnpm store)
  let nativeDir = resolve(`node_modules/${nativePkg}`);
  if (!existsSync(nativeDir)) {
    // pnpm: platform package is a sibling via the real path
    const pnpmSibling = join(sherpaNodeDir, '..', nativePkg);
    if (existsSync(pnpmSibling)) {
      nativeDir = pnpmSibling;
    } else {
      buildWarn(`[build] ${nativePkg} not found, skipping native copy`);
      return;
    }
  }

  const destDir = resolve('dist/sherpa-onnx');

  // Wipe stale output first: onnxruntime dylib filenames are version-pinned
  // (libonnxruntime.1.24.4.dylib -> libonnxruntime.1.27.0.dylib on a bump),
  // so without this, an old build's dylib never gets overwritten by a copy
  // loop that only writes files present in the current source dir — it just
  // sits there as dead weight, silently inflating every future .app/DMG.
  rmSync(destDir, { recursive: true, force: true });
  mkdirSync(destDir, { recursive: true });

  // Copy JS files from sherpa-onnx-node
  for (const file of readdirSync(sherpaNodeDir)) {
    if (file.endsWith('.js') || file === 'package.json') {
      copyFileSync(join(sherpaNodeDir, file), join(destDir, file));
    }
  }

  // Discover the dylib(s) directly referenced by sherpa-onnx.node so we can
  // skip unreferenced runtime versions that ship in the platform package
  // (e.g. libonnxruntime.dylib, libonnxruntime.1.23.2.dylib are 67 MB of
  // dead weight on macOS — verified via `otool -L sherpa-onnx.node`).
  const sherpaAddon = join(nativeDir, 'sherpa-onnx.node');
  const referenced = getDirectlyReferencedLibs(sherpaAddon);
  let skipped = 0;

  for (const file of readdirSync(nativeDir)) {
    if (!isNativeFile(file)) continue;

    // Always keep the addon itself + libsherpa-* files (transitively needed).
    const isAddonOrSherpaApi =
      file === 'sherpa-onnx.node' || file.includes('sherpa-onnx');

    if (
      !isAddonOrSherpaApi &&
      referenced &&
      !referenced.has(file) &&
      // Always keep at least one onnxruntime dylib even if otool didn't pick
      // it up (defensive): the canonical versioned filename pattern.
      !isCanonicalOnnxRuntimeFile(file, referenced)
    ) {
      skipped++;
      continue;
    }
    copyFileSync(join(nativeDir, file), join(destDir, file));
  }

  if (skipped > 0) {
    buildLog(
      `[build] sherpa-onnx: pruned ${skipped} unreferenced native file(s)`,
    );
  }
  buildLog(`[build] Copied sherpa-onnx native files to dist/sherpa-onnx/`);
}

/**
 * Defensive guard: if `otool -L` somehow returned an empty referenced-set
 * (e.g. addon was stripped of LC_LOAD_DYLIB commands), keep the canonical
 * versioned ORT dylib so the runtime still loads.
 */
function isCanonicalOnnxRuntimeFile(file, referenced) {
  if (referenced.size > 0) return false;
  // Highest-versioned libonnxruntime.<x>.<y>.<z>.dylib in the dir wins.
  return /^libonnxruntime\.\d+\.\d+\.\d+\.(dylib|so(\.\d+)*)$/.test(file);
}

/**
 * Delete libonnxruntime dylibs not referenced by onnxruntime_binding.node.
 *
 * onnxruntime-node ships the same dylib under multiple names (SONAME +
 * full-version, ~36 MB each). Stale dylibs from earlier unify-runs may also
 * linger (Tauri dereferences symlinks during bundling, turning each into a
 * real copy). The binding only loads ONE @rpath/libonnxruntime.X.dylib at
 * runtime, so everything else in that dir is dead weight in the .app.
 *
 * Symlinks won't help: Tauri's resource copier follows them. Only deleting
 * the unused files actually shrinks the DMG.
 */
function pruneUnreferencedRuntimeDylibs(dir) {
  const bindingFile = readdirSync(dir).find(
    (f) => f.endsWith('.node') && f.includes('binding'),
  );
  if (!bindingFile) return;

  const referenced = getDirectlyReferencedLibs(join(dir, bindingFile));
  if (!referenced || referenced.size === 0) return;

  const dylibPattern = /^libonnxruntime[\.\-_].*\.(dylib|so(\.\d+)*)$/;
  let prunedCount = 0;
  let savedBytes = 0;

  for (const name of readdirSync(dir)) {
    if (!dylibPattern.test(name)) continue;
    if (referenced.has(name)) continue;

    const path = join(dir, name);
    const stat = lstatSync(path);
    // For symlinks, use the link size (the file pointed to may legitimately
    // exist elsewhere); for real files, this is the byte payload we recover.
    savedBytes += stat.size;
    rmSync(path, { force: true });
    prunedCount += 1;
  }

  if (prunedCount > 0) {
    buildLog(
      `[build] Pruned ${prunedCount} unreferenced libonnxruntime file(s) from ${pathRelative(resolve('.'), dir)} → saved ${(savedBytes / 1_000_000).toFixed(1)} MB`,
    );
  }
}

/**
 * Copy onnxruntime-node native addon files for Tauri resource bundling.
 *
 * Unlike sherpa-onnx (self-contained), onnxruntime-node depends on onnxruntime-common.
 * We bundle the full module + its dependency as a self-contained node_modules in Resources.
 * At runtime, require() with absolute path bypasses pkg's VFS and loads from real filesystem.
 *
 * Structure: dist/onnxruntime/node_modules/
 *   ├── onnxruntime-node/
 *   │   ├── dist/*.js, package.json
 *   │   └── bin/napi-v6/<platform>/<arch>/*.node + *.dylib
 *   └── onnxruntime-common/
 *       └── dist/*.js, package.json
 */
function copyOnnxruntimeNative() {
  const ortLink = resolve('node_modules/onnxruntime-node');
  if (!existsSync(ortLink)) {
    buildWarn('[build] onnxruntime-node not found, skipping native copy');
    return;
  }

  // Resolve real path (pnpm uses symlinks → .pnpm store)
  const ortDir = realpathSync(ortLink);

  const platform = TARGET_PLATFORM;
  const arch = TARGET_ARCH === 'arm64' ? 'arm64' : 'x64';
  const nativeSrc = join(ortDir, 'bin', 'napi-v6', platform, arch);
  if (!existsSync(nativeSrc)) {
    buildWarn(`[build] onnxruntime native dir not found: ${nativeSrc}`);
    return;
  }

  // Find onnxruntime-common (pnpm stores it as a sibling via the real path)
  let commonDir = resolve('node_modules/onnxruntime-common');
  if (!existsSync(commonDir)) {
    // pnpm: sibling via the real resolved path in .pnpm store
    const pnpmSibling = join(ortDir, '..', 'onnxruntime-common');
    if (existsSync(pnpmSibling)) {
      commonDir = pnpmSibling;
    } else {
      // Search in parent node_modules (workspace root)
      const parentCommon = resolve('../node_modules/onnxruntime-common');
      if (existsSync(parentCommon)) {
        commonDir = parentCommon;
      }
    }
  }

  const destBase = resolve('dist/onnxruntime/node_modules');

  // Copy onnxruntime-node JS files
  const ortDest = join(destBase, 'onnxruntime-node');
  const ortDistDest = join(ortDest, 'dist');
  mkdirSync(ortDistDest, { recursive: true });

  if (existsSync(join(ortDir, 'package.json'))) {
    copyFileSync(join(ortDir, 'package.json'), join(ortDest, 'package.json'));
  }
  for (const file of readdirSync(join(ortDir, 'dist'))) {
    if (file.endsWith('.js') || file.endsWith('.json')) {
      copyFileSync(join(ortDir, 'dist', file), join(ortDistDest, file));
    }
  }

  // Copy native .node + .dylib files
  const nativeDest = join(ortDest, 'bin', 'napi-v6', platform, arch);
  mkdirSync(nativeDest, { recursive: true });
  for (const file of readdirSync(nativeSrc)) {
    if (
      file.endsWith('.node') ||
      file.endsWith('.dylib') ||
      file.endsWith('.dll') ||
      file.endsWith('.so')
    ) {
      copyFileSync(join(nativeSrc, file), join(nativeDest, file));
    }
  }

  // Drop libonnxruntime variants not referenced by the binding (~70 MB of
  // duplicated/orphaned dylibs on macOS arm64). Run after unifyOnnxRuntime so
  // any rewrites have already settled. Symlinks would be dereferenced by
  // Tauri's resource bundler — only deletion actually shrinks the .app.
  pruneUnreferencedRuntimeDylibs(nativeDest);

  // Copy onnxruntime-common (has nested dist/cjs/ directory structure)
  if (existsSync(commonDir)) {
    const commonDest = join(destBase, 'onnxruntime-common');
    mkdirSync(commonDest, { recursive: true });
    // Deep copy the module (dist/cjs/ has nested subdirectories)
    copyFileSync(
      join(commonDir, 'package.json'),
      join(commonDest, 'package.json'),
    );
    if (existsSync(join(commonDir, 'dist'))) {
      cpSync(join(commonDir, 'dist'), join(commonDest, 'dist'), {
        recursive: true,
      });
    }
  } else {
    buildWarn(
      '[build] onnxruntime-common not found — onnxruntime may fail at runtime',
    );
  }

  buildLog(`[build] Copied onnxruntime native files to dist/onnxruntime/`);
}

/**
 * Unify the ONNX runtime dylib between sherpa-onnx-node and onnxruntime-node.
 *
 * Both packages ship their own ~34 MB `libonnxruntime.<patch>.dylib`. They use
 * the same minor version but different patches (e.g. sherpa 1.24.4 vs ort-node
 * 1.24.3) — ABI-compatible per ORT semver. We rewrite onnxruntime_binding.node
 * to load sherpa's dylib via @rpath, then drop the duplicate copy.
 *
 * macOS only for now (uses `install_name_tool` + `codesign`); Linux equivalent
 * (`patchelf --replace-needed`) is wired for completeness. Windows is left
 * untouched — DLL imports table editing is more involved and not yet tested.
 *
 * Set NEUMAR_SKIP_ORT_UNIFY=1 in env to opt out (e.g. when validating CP3a in
 * isolation).
 */
function unifyOnnxRuntime() {
  if (process.env.NEUMAR_SKIP_ORT_UNIFY === '1') {
    buildLog('[build] ORT unification skipped (NEUMAR_SKIP_ORT_UNIFY=1)');
    return;
  }

  const sherpaDir = resolve('dist/sherpa-onnx');
  if (!existsSync(sherpaDir)) return;

  // Find sherpa's referenced ORT dylib (e.g. libonnxruntime.1.24.4.dylib).
  const sherpaAddon = join(sherpaDir, 'sherpa-onnx.node');
  if (!existsSync(sherpaAddon)) return;
  const sherpaRefs = getDirectlyReferencedLibs(sherpaAddon);
  if (!sherpaRefs) return;
  const sherpaOrtName = [...sherpaRefs].find((f) =>
    /^libonnxruntime\.\d+\.\d+\.\d+\.(dylib|so(\.\d+)*)$/.test(f),
  );
  if (!sherpaOrtName) return;

  // Find the ort-node binding addon and inspect its referenced ORT.
  const ortPlatform = TARGET_PLATFORM;
  const ortArch = TARGET_ARCH === 'arm64' ? 'arm64' : 'x64';
  const ortBindingDir = resolve(
    `dist/onnxruntime/node_modules/onnxruntime-node/bin/napi-v6/${ortPlatform}/${ortArch}`,
  );
  if (!existsSync(ortBindingDir)) return;
  const bindingFile = readdirSync(ortBindingDir).find(
    (f) => f.endsWith('.node') && f.includes('binding'),
  );
  if (!bindingFile) return;
  const bindingPath = join(ortBindingDir, bindingFile);

  const ortRefs = getDirectlyReferencedLibs(bindingPath);
  if (!ortRefs) return;
  const ortName = [...ortRefs].find((f) =>
    /^libonnxruntime\.\d+\.\d+\.\d+\.(dylib|so(\.\d+)*)$/.test(f),
  );
  if (!ortName) return;
  if (ortName === sherpaOrtName) {
    buildLog(`[build] ORT already unified on ${sherpaOrtName}`);
    return;
  }

  // Rewrite the load command, then re-sign so the binary remains valid.
  if (TARGET_PLATFORM === 'darwin') {
    const change = spawnSync(
      'install_name_tool',
      ['-change', `@rpath/${ortName}`, `@rpath/${sherpaOrtName}`, bindingPath],
      { encoding: 'utf8' },
    );
    if (change.status !== 0) {
      buildWarn(
        `[build] install_name_tool failed (${change.stderr.trim()}); leaving ORT duplicated`,
      );
      return;
    }
    // Ad-hoc sign so the addon stays loadable post-edit. Tauri's outer
    // codesign step will re-sign at the bundle level.
    const sign = spawnSync(
      'codesign',
      ['--force', '--sign', '-', bindingPath],
      {
        encoding: 'utf8',
      },
    );
    if (sign.status !== 0) {
      buildWarn(`[build] codesign failed: ${sign.stderr.trim()}`);
      return;
    }
  } else if (TARGET_PLATFORM === 'linux') {
    const patch = spawnSync(
      'patchelf',
      ['--replace-needed', ortName, sherpaOrtName, bindingPath],
      { encoding: 'utf8' },
    );
    if (patch.status !== 0) {
      buildWarn(
        `[build] patchelf failed (${patch.stderr.trim()}); leaving ORT duplicated`,
      );
      return;
    }
  } else {
    return; // Windows path intentionally not implemented yet.
  }

  // Drop the now-redundant ORT dylib from onnxruntime-node's bin dir.
  const dupDylib = join(ortBindingDir, ortName);
  if (existsSync(dupDylib)) {
    rmSync(dupDylib, { force: true });
  }

  // Ensure sherpa's runtime is reachable from the addon's @rpath. Tauri lays
  // both packages under .../Resources/_up_/src-api/dist/, so add a symlink
  // (or copy fallback) from the ort-node bin dir back to sherpa's shipped
  // runtime. Use a tmp-then-rename pattern so the swap is atomic and survives
  // any prior stale entry (broken symlinks, half-written files, even a
  // directory by accident).
  const sherpaSharedDylib = join(sherpaDir, sherpaOrtName);
  const linkTarget = join(ortBindingDir, sherpaOrtName);
  if (!existsSync(sherpaSharedDylib)) {
    buildWarn(
      `[build] sherpa source dylib missing at ${sherpaSharedDylib}; ORT unification may not load at runtime`,
    );
    return;
  }

  // Hard-clear anything currently at linkTarget. lstatSync (NOT existsSync)
  // catches broken symlinks; rmSync with force+recursive handles files,
  // symlinks, and the (very unlikely) case where a directory is in the way.
  try {
    lstatSync(linkTarget);
    rmSync(linkTarget, { force: true, recursive: true });
  } catch {
    // Nothing there — proceed.
  }

  const tmpTarget = `${linkTarget}.tmp.${process.pid}.${Date.now()}`;
  // Compute the correct relative path automatically. Hardcoded ".." counts
  // silently produce broken symlinks (Tauri's resource validator then fails
  // with "resource path doesn't exist" on a symlink that points to nowhere).
  const relTarget = pathRelative(dirname(linkTarget), sherpaSharedDylib);
  let usedSymlink = false;
  try {
    symlinkSync(relTarget, tmpTarget);
    usedSymlink = true;
  } catch (err) {
    // Symlinks unsupported (rare CI filesystems) → fall back to a real copy.
    try {
      copyFileSync(sherpaSharedDylib, tmpTarget);
    } catch (copyErr) {
      buildWarn(
        `[build] ORT dedup fallback copy failed (${copyErr.message}); leaving binding without dedup link`,
      );
      try {
        unlinkSync(tmpTarget);
      } catch {
        // tmp file may not exist; ignore
      }
      return;
    }
  }

  // Atomic swap into place. renameSync replaces existing files/symlinks on
  // POSIX without a window where linkTarget is missing.
  renameSync(tmpTarget, linkTarget);

  if (!usedSymlink) {
    buildWarn(
      `[build] ORT dedup used a copy (symlink unsupported on this fs); +${Math.round(35e6 / 1e6)} MB to bundle`,
    );
  }

  buildLog(
    `[build] Unified ORT: rewrote ${bindingFile} ${ortName} → ${sherpaOrtName}`,
  );
}

try {
  // Polyfill import.meta.url for CJS output.
  // ESM-only packages like @openai/codex-sdk use createRequire(import.meta.url)
  // which is undefined in CJS. This replaces it with the CJS equivalent.
  // See: https://github.com/evanw/esbuild/issues/1633
  define['import.meta.url'] = '_importMetaUrl';

  await build({
    entryPoints: ['src/index.ts'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: [
      'sherpa-onnx-node',
      // Playwright is dynamically imported in design.ts/sandbox.ts. Bundling it
      // pulls chromium-bidi internals esbuild can't resolve, so leave it for
      // runtime resolution (the pkg snapshot / installed node_modules).
      'playwright',
      'playwright-core',
      '@playwright/test',
      'chromium-bidi',
      'chromium-bidi/*',
      // pdfjs-dist exposes an optional NodeCanvasFactory. CAMS only reads PDF
      // metadata/text and renders placeholder thumbnails, so do not bundle the
      // native canvas package.
      'canvas',
      // Remotion defaults to webpack for our bundle call, but @remotion/bundler
      // imports its optional Rspack path at module initialization. Keep the
      // native Rspack bindings out of the pkg-sidecar bundle.
      '@rspack/binding',
      '@rspack/binding-*',
      // Remotion render toolchain — dynamically imported in
      // remotion-renderer.ts. Bundling it eagerly drags in webpack,
      // @remotion/studio, esbuild, media-parser, etc. (~30 MB of JS).
      // Resolved at runtime from the sibling node_modules tree.
      '@remotion/bundler',
      '@remotion/renderer',
      // The composition (remotion-composition.ts) and entry
      // (remotion-render-entry.ts) are loaded by @remotion/bundler off disk
      // and webpack-compiled in a child process — they don't need to live in
      // the sidecar bundle.
      '@remotion/transitions',
      '@remotion/transitions/*',
      'remotion',
    ],
    plugins: [sharpResolverPlugin, onnxruntimeShimPlugin, nativeBindingsPlugin],
    outfile: 'dist/bundle.cjs',
    banner: {
      js: "const _importMetaUrl = require('url').pathToFileURL(__filename).href;",
    },
    define,
  });

  buildLog('[build] dist/bundle.cjs written');

  // Resolve and copy the correct native addon for the pkg target
  await resolveNativeAddon();

  // Copy native speech/embedding addon files for Tauri resource bundling
  copySharpNative();
  copySherpaOnnxNative();
  copyOnnxruntimeNative();

  // Drop duplicated ORT runtime: rewrite onnxruntime_binding.node to load
  // sherpa's shipped libonnxruntime.* via @rpath, then delete the dup copy.
  // See dev-doc/plan/2026-05-05-package-size-optimization.md CP3b.
  unifyOnnxRuntime();

  // Copy design-mode catalog (prompt-templates/, craft/, design-systems/,
  // skills/) so it ships with the Tauri bundle. catalogs.ts resolves this via
  // RESOURCES_DIR/_up_/src-api/dist/design-mode/ at runtime.
  copyDesignModeCatalog();

  // Copy repo builtin plugins so bundled plugin content ships with the app.
  copyBuiltinPlugins();
} catch (error) {
  buildError('[build] FAILED:', error.message || error);
  process.exit(1);
}
