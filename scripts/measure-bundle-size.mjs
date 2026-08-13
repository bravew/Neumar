#!/usr/bin/env node
/**
 * Walk the most recent Tauri build output + src-api dist and emit a JSON
 * size report. Modeled on Open Design's MacSizeReport (see
 * `_sample/open-design` commit 3935aeb · `tools/pack/src/mac.ts`).
 *
 * Usage:
 *   node scripts/measure-bundle-size.mjs
 *   node scripts/measure-bundle-size.mjs --triple aarch64-apple-darwin
 *   node scripts/measure-bundle-size.mjs --json   # machine-readable only
 *
 * Output:
 *   bundle-size-report.json (also printed as a table unless --json)
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const out = { jsonOnly: false, triple: null, output: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--json') out.jsonOnly = true;
    else if (argv[i] === '--triple') out.triple = argv[++i];
    else if (argv[i] === '--output') out.output = argv[++i];
  }
  return out;
}

function dirSize(path) {
  let total = 0;
  let stat;
  try {
    stat = statSync(path);
  } catch {
    return 0;
  }
  if (!stat.isDirectory()) return stat.size;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    total += dirSize(join(path, entry.name));
  }
  return total;
}

function fileSize(path) {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

function detectHostTriple() {
  if (process.platform === 'darwin') {
    return process.arch === 'arm64'
      ? 'aarch64-apple-darwin'
      : 'x86_64-apple-darwin';
  }
  if (process.platform === 'linux') return 'x86_64-unknown-linux-gnu';
  if (process.platform === 'win32') return 'x86_64-pc-windows-msvc';
  return null;
}

function findBundleRoot(triple) {
  // Tauri 2 may emit either `target/release/bundle/` or
  // `target/<triple>/release/bundle/` depending on `tauri build` invocation.
  const candidates = [
    join(ROOT, 'src-tauri', 'target', triple, 'release', 'bundle'),
    join(ROOT, 'src-tauri', 'target', 'release', 'bundle'),
  ];
  for (const c of candidates) {
    try {
      statSync(c);
      return c;
    } catch {
      // try next
    }
  }
  return null;
}

function findFirst(dir, suffix) {
  try {
    const entries = readdirSync(dir)
      .filter((e) => e.endsWith(suffix))
      .map((e) => ({ name: e, mtime: statSync(join(dir, e)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    if (entries[0]) return join(dir, entries[0].name);
  } catch {
    // missing dir
  }
  return null;
}

function findApp(bundleRoot) {
  const macosDir = join(bundleRoot, 'macos');
  return findFirst(macosDir, '.app');
}

function findDmg(bundleRoot) {
  return findFirst(join(bundleRoot, 'dmg'), '.dmg');
}

function findInstaller(bundleRoot, ext) {
  const dirs = ['nsis', 'msi', 'appimage', 'deb', 'rpm'];
  for (const d of dirs) {
    const f = findFirst(join(bundleRoot, d), ext);
    if (f) return f;
  }
  return null;
}

function dmgFormat(dmgPath) {
  if (!dmgPath || process.platform !== 'darwin') return null;
  try {
    const out = execFileSync('hdiutil', ['imageinfo', dmgPath], {
      encoding: 'utf8',
    });
    const m = out.match(/Format:\s*(\S+)/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

function buildReport({ triple }) {
  const distRoot = join(ROOT, 'src-api', 'dist');
  const bundleRoot = findBundleRoot(triple);
  const app = bundleRoot ? findApp(bundleRoot) : null;
  const dmg = bundleRoot ? findDmg(bundleRoot) : null;
  const exeWin = bundleRoot ? findInstaller(bundleRoot, '.exe') : null;
  const msiWin = bundleRoot ? findInstaller(bundleRoot, '.msi') : null;
  const appImage = bundleRoot ? findInstaller(bundleRoot, '.AppImage') : null;
  const deb = bundleRoot ? findInstaller(bundleRoot, '.deb') : null;

  let appBytes = app ? dirSize(app) : 0;
  let macosBin = 0;
  let macosApiBin = 0;
  let resourcesBytes = 0;
  let sherpaBytes = 0;
  let onnxruntimeBytes = 0;
  let designModeBytes = 0;
  let skillsBytes = 0;
  if (app) {
    macosBin = fileSize(join(app, 'Contents', 'MacOS', 'neumar'));
    macosApiBin = fileSize(join(app, 'Contents', 'MacOS', 'neumar-api'));
    resourcesBytes = dirSize(join(app, 'Contents', 'Resources'));
    const upRoot = join(app, 'Contents', 'Resources', '_up_');
    sherpaBytes = dirSize(join(upRoot, 'src-api', 'dist', 'sherpa-onnx'));
    onnxruntimeBytes = dirSize(join(upRoot, 'src-api', 'dist', 'onnxruntime'));
    designModeBytes = dirSize(join(upRoot, 'src-api', 'dist', 'design-mode'));
    skillsBytes = dirSize(join(upRoot, 'skills'));
  }

  return {
    generatedAt: new Date().toISOString(),
    triple,
    bundleRoot,
    app: {
      path: app,
      bytes: appBytes,
      macosBinaryBytes: macosBin,
      macosApiBinaryBytes: macosApiBin,
      resourcesBytes,
      sherpaOnnxBytes: sherpaBytes,
      onnxruntimeBytes,
      designModeBytes,
      skillsBytes,
    },
    artifacts: {
      dmg: dmg
        ? { path: dmg, bytes: fileSize(dmg), format: dmgFormat(dmg) }
        : null,
      exe: exeWin ? { path: exeWin, bytes: fileSize(exeWin) } : null,
      msi: msiWin ? { path: msiWin, bytes: fileSize(msiWin) } : null,
      appImage: appImage ? { path: appImage, bytes: fileSize(appImage) } : null,
      deb: deb ? { path: deb, bytes: fileSize(deb) } : null,
    },
    sidecar: {
      apiBinaryBytes: fileSize(
        join(
          distRoot,
          `neumar-api-${triple}${triple.includes('windows') ? '.exe' : ''}`,
        ),
      ),
    },
    distSubtrees: {
      sherpaOnnxBytes: dirSize(join(distRoot, 'sherpa-onnx')),
      onnxruntimeBytes: dirSize(join(distRoot, 'onnxruntime')),
      designModeBytes: dirSize(join(distRoot, 'design-mode')),
      cliBundleBytes: dirSize(join(distRoot, 'cli-bundle')),
      modelsBytes: dirSize(join(distRoot, 'models')),
    },
  };
}

function fmtBytes(n) {
  if (!n) return '   —';
  const mb = n / 1_000_000;
  if (mb >= 100) return `${mb.toFixed(0)} MB`;
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${(n / 1_000).toFixed(0)} KB`;
}

function printTable(report) {
  const rows = [
    ['DMG (compressed)', report.artifacts.dmg?.bytes],
    ['  format', report.artifacts.dmg?.format ?? '—'],
    ['.app total', report.app.bytes],
    ['  MacOS/neumar', report.app.macosBinaryBytes],
    ['  MacOS/neumar-api', report.app.macosApiBinaryBytes],
    ['  Resources/', report.app.resourcesBytes],
    ['    sherpa-onnx/', report.app.sherpaOnnxBytes],
    ['    onnxruntime/', report.app.onnxruntimeBytes],
    ['    design-mode/', report.app.designModeBytes],
    ['    skills/', report.app.skillsBytes],
    ['Windows .exe', report.artifacts.exe?.bytes],
    ['Windows .msi', report.artifacts.msi?.bytes],
    ['AppImage', report.artifacts.appImage?.bytes],
    ['.deb', report.artifacts.deb?.bytes],
    ['Sidecar (pre-bundle)', report.sidecar.apiBinaryBytes],
  ];
  const namePad = Math.max(...rows.map(([n]) => n.length));
  process.stdout.write(`\n[bundle-size] triple=${report.triple}\n`);
  for (const [name, value] of rows) {
    let right;
    if (typeof value === 'number') right = fmtBytes(value).padStart(8);
    else if (value == null) right = '   —'.padStart(8);
    else right = String(value).padStart(8);
    process.stdout.write(`  ${name.padEnd(namePad)}  ${right}\n`);
  }
  process.stdout.write('\n');
}

const args = parseArgs(process.argv.slice(2));
const triple = args.triple ?? detectHostTriple();
if (!triple) {
  process.stderr.write('Could not detect target triple; pass --triple\n');
  process.exit(1);
}

const report = buildReport({ triple });
const outputPath = args.output ?? join(ROOT, 'bundle-size-report.json');
writeFileSync(outputPath, JSON.stringify(report, null, 2) + '\n');
if (!args.jsonOnly) printTable(report);
process.stdout.write(`[bundle-size] wrote ${outputPath}\n`);
