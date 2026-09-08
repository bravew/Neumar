#!/usr/bin/env node
// Packaged-sidecar probe for the Video Mode render engines (reference-upgrade
// plan, Phase 1 item 10).
//
// The desktop app ships the API as a pkg binary, not as workspace source. The
// HyperFrames CLI is *not* bundled into it: `resolveHyperframesCommand()` looks
// at NEUMA_HYPERFRAMES_BIN, then the workspace `.bin`, then PATH. So a packaged
// build can legitimately run on a machine with no CLI and no browser, and the
// contract this script proves is that it reports a typed unavailable reason
// (`not-found` / `browser-missing`) instead of crashing.
//
// Usage:
//   node scripts/video-sidecar-probe.mjs --target=darwin-arm64 --json
//   node scripts/video-sidecar-probe.mjs --target=linux-x64 --report=out.json
//
// A target that does not match the host still bundles and audits its footprint;
// the runtime probes are recorded as `skipped` with the CI command that runs
// them, because a linux binary cannot execute here.

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const SCHEMA_VERSION = 1;

const TARGETS = {
  'darwin-arm64': {
    platform: 'darwin',
    arch: 'arm64',
    binary: 'neumar-api-aarch64-apple-darwin',
    buildScript: 'build:binary:mac-arm',
  },
  'linux-x64': {
    platform: 'linux',
    arch: 'x64',
    binary: 'neumar-api-x86_64-unknown-linux-gnu',
    buildScript: 'build:binary:linux',
  },
};

function parseArgs(argv) {
  const args = {
    target: undefined,
    json: false,
    report: undefined,
    skipBuild: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') args.json = true;
    else if (arg === '--skip-build') args.skipBuild = true;
    else if (arg === '--target') args.target = argv[++index];
    else if (arg.startsWith('--target=')) args.target = arg.slice(9);
    else if (arg === '--report') args.report = argv[++index];
    else if (arg.startsWith('--report=')) args.report = arg.slice(9);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!TARGETS[args.target]) {
    throw new Error(
      `--target must be one of: ${Object.keys(TARGETS).join(', ')}`,
    );
  }
  return args;
}

function check(name, ok, detail) {
  return {
    name,
    status: ok ? 'passed' : 'failed',
    ...(detail ? { detail } : {}),
  };
}

function skipped(name, detail) {
  return { name, status: 'skipped', detail };
}

function run(bin, args, options = {}) {
  const result = spawnSync(bin, args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
    ...options,
  });
  if (result.error) throw result.error;
  return result;
}

function directorySize(dir) {
  if (!fs.existsSync(dir)) return 0;
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += directorySize(full);
    else if (entry.isFile()) total += fs.statSync(full).size;
  }
  return total;
}

// The heavy transitive dependencies HyperFrames 0.8.31 introduces. They belong
// to `src-video`'s devDependencies; none of them may reach the API sidecar.
const FORBIDDEN_IN_BUNDLE = [
  'puppeteer-core',
  '@puppeteer/browsers',
  'hyperframes/dist',
];

function auditBundle(target) {
  const distDir = path.join(REPO_ROOT, 'src-api', 'dist');
  const bundlePath = path.join(distDir, 'bundle.cjs');
  const checks = [];
  const bundleExists = fs.existsSync(bundlePath);
  checks.push(check('bundle-written', bundleExists));
  if (!bundleExists) return { checks, footprint: null };

  const bundle = fs.readFileSync(bundlePath, 'utf8');
  for (const marker of FORBIDDEN_IN_BUNDLE) {
    checks.push(
      check(
        `bundle-excludes-${marker.replace(/[^a-z0-9]+/gi, '-')}`,
        !bundle.includes(`require("${marker}`) &&
          !bundle.includes(`from"${marker}`),
      ),
    );
  }
  // The CLI must stay an external, runtime-resolved command.
  checks.push(
    check(
      'hyperframes-resolved-at-runtime',
      bundle.includes('NEUMA_HYPERFRAMES_BIN'),
      'sidecar resolves the CLI from env, workspace bin, or PATH',
    ),
  );

  const footprint = {
    bundleBytes: fs.statSync(bundlePath).size,
    nativeBytes: {
      sharp: directorySize(path.join(distDir, 'sharp')),
      onnxruntime: directorySize(path.join(distDir, 'onnxruntime')),
      sherpaOnnx: directorySize(path.join(distDir, 'sherpa-onnx')),
    },
    binaryBytes: (() => {
      const binaryPath = path.join(distDir, target.binary);
      return fs.existsSync(binaryPath) ? fs.statSync(binaryPath).size : null;
    })(),
  };
  return { checks, footprint };
}

async function waitForHealth(port, signal) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (signal.aborted)
      throw new Error('Sidecar exited before becoming healthy');
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('Sidecar did not become healthy within 90s');
}

// Boot the packaged binary with a controlled environment and ask it for the
// engine list the setup surface renders.
async function probeEngines({ binaryPath, port, env, workDir }) {
  const controller = new AbortController();
  const child = spawn(binaryPath, [], {
    cwd: workDir,
    env: { ...env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });
  child.on('exit', () => controller.abort());
  try {
    await waitForHealth(port, controller.signal);
    const response = await fetch(`http://127.0.0.1:${port}/video/engines`);
    const body = await response.json();
    return { httpStatus: response.status, body };
  } catch (error) {
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\n${stderr.slice(-2000)}`,
    );
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (child.exitCode === null) child.kill('SIGKILL');
  }
}

function engineEntry(body, id) {
  return body?.engines?.find(
    (engine) => engine.engineId === id || engine.id === id,
  );
}

// A stub CLI that answers `--version` with a current version but reports Chrome
// missing from `doctor --json`, which is exactly the shape of a machine with the
// CLI installed and no browser.
function writeBrowserlessStub(dir) {
  const binDir = path.join(dir, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  const stub = path.join(binDir, 'hyperframes');
  fs.writeFileSync(
    stub,
    `#!/bin/sh
if [ "$1" = "--version" ]; then echo "0.8.31"; exit 0; fi
if [ "$1" = "doctor" ]; then
  echo '{"checks":[{"name":"Chrome","ok":false,"detail":"Not found"}],"_meta":{"version":"0.8.31"}}'
  exit 0
fi
exit 1
`,
    { mode: 0o755 },
  );
  return binDir;
}

// The packaged binary loads sharp, onnxruntime, and sherpa natives from
// `$RESOURCES_DIR/_up_/src-api/dist/...` — the layout Tauri produces when it
// copies the sidecar's resources. Reproduce it so the probe exercises the same
// loader path the shipped app does.
function stageResourcesDir(workDir) {
  const resourcesDir = path.join(workDir, 'resources');
  const staged = path.join(resourcesDir, '_up_', 'src-api');
  fs.mkdirSync(staged, { recursive: true });
  fs.symlinkSync(
    path.join(REPO_ROOT, 'src-api', 'dist'),
    path.join(staged, 'dist'),
  );
  return resourcesDir;
}

async function runRuntimeProbes(target, workDir) {
  const binaryPath = path.join(REPO_ROOT, 'src-api', 'dist', target.binary);
  const checks = [];
  const observations = {};
  if (!fs.existsSync(binaryPath)) {
    checks.push(check('packaged-binary-present', false, binaryPath));
    return { checks, observations };
  }
  checks.push(check('packaged-binary-present', true));

  // Minimal PATH so the workspace CLI is not discovered by accident.
  const baseEnv = {
    HOME: workDir,
    PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
    NEUMA_WORK_DIR: workDir,
    RESOURCES_DIR: stageResourcesDir(workDir),
  };

  const missing = await probeEngines({
    binaryPath,
    port: 39_121,
    env: {
      ...baseEnv,
      NEUMA_HYPERFRAMES_BIN: path.join(workDir, 'absent-cli'),
    },
    workDir,
  });
  observations.cliMissing = engineEntry(missing.body, 'hyperframes');
  checks.push(check('cli-missing-http-ok', missing.httpStatus === 200));
  checks.push(
    check(
      'cli-missing-typed-reason',
      observations.cliMissing?.installed === false &&
        observations.cliMissing?.unavailableReason === 'not-found',
      observations.cliMissing?.unavailableReason,
    ),
  );

  const stubBin = writeBrowserlessStub(workDir);
  const browserless = await probeEngines({
    binaryPath,
    port: 39_122,
    env: {
      ...baseEnv,
      NEUMA_HYPERFRAMES_BIN: path.join(stubBin, 'hyperframes'),
    },
    workDir,
  });
  observations.browserMissing = engineEntry(browserless.body, 'hyperframes');
  checks.push(check('browser-missing-http-ok', browserless.httpStatus === 200));
  checks.push(
    check(
      'browser-missing-typed-reason',
      observations.browserMissing?.installed === false &&
        observations.browserMissing?.unavailableReason === 'browser-missing',
      observations.browserMissing?.unavailableReason,
    ),
  );

  // Remotion is bundled into the sidecar, so it must stay available even with
  // no external CLI and no browser on PATH.
  observations.remotion = engineEntry(missing.body, 'remotion');
  checks.push(
    check(
      'remotion-available-without-external-cli',
      observations.remotion?.installed === true,
      observations.remotion?.detectedVersion,
    ),
  );

  return { checks, observations };
}

function environmentInfo() {
  const capture = (bin, args) => {
    const result = spawnSync(bin, args, { encoding: 'utf8' });
    return result.status === 0 ? result.stdout.trim().split('\n')[0] : null;
  };
  return {
    platform: process.platform,
    architecture: process.arch,
    release: os.release(),
    cpu:
      capture('sysctl', ['-n', 'machdep.cpu.brand_string']) ??
      os.cpus()[0]?.model,
    memoryBytes: os.totalmem(),
    node: process.version,
    pnpm: capture('pnpm', ['--version']),
  };
}

function stableJson(value) {
  return `${JSON.stringify(value, Object.keys(flatten(value)).sort(), 2)}\n`;
}

function flatten(value, seen = {}) {
  if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      seen[key] = true;
      flatten(nested, seen);
    }
  }
  return seen;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const target = TARGETS[args.target];
  const isHostTarget =
    target.platform === process.platform && target.arch === process.arch;

  const checks = [];
  if (!args.skipBuild) {
    const built = run('pnpm', ['--filter', 'neumar-api', target.buildScript], {
      env: { ...process.env, PKG_NODE_RANGE: '22' },
      stdio: 'inherit',
    });
    checks.push(check('packaged-build', built.status === 0));
  } else {
    checks.push(
      skipped('packaged-build', '--skip-build: reused existing dist/'),
    );
  }

  const bundleAudit = auditBundle(target);
  checks.push(...bundleAudit.checks);

  let observations = {};
  const workDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'video-sidecar-probe-'),
  );
  try {
    if (isHostTarget) {
      const runtime = await runRuntimeProbes(target, workDir);
      checks.push(...runtime.checks);
      observations = runtime.observations;
    } else {
      checks.push(
        skipped(
          'runtime-engine-probe',
          `Cross-target build: run \`node scripts/video-sidecar-probe.mjs --target=${args.target} --json\` on a ${target.platform}/${target.arch} runner to execute the runtime probes.`,
        ),
      );
    }
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }

  const report = {
    schemaVersion: SCHEMA_VERSION,
    kind: 'video-sidecar-probe',
    target: args.target,
    hostExecuted: isHostTarget,
    generatedAt: new Date().toISOString(),
    command: `node scripts/video-sidecar-probe.mjs --target=${args.target} --json`,
    environment: environmentInfo(),
    footprint: bundleAudit.footprint,
    observations,
    checks,
    status: checks.some((entry) => entry.status === 'failed')
      ? 'failed'
      : 'passed',
  };

  if (args.report) {
    fs.mkdirSync(path.dirname(args.report), { recursive: true });
    fs.writeFileSync(args.report, stableJson(report));
  }
  if (args.json) process.stdout.write(stableJson(report));
  else {
    for (const entry of checks) {
      process.stdout.write(
        `${entry.status.padEnd(7)} ${entry.name}${entry.detail ? ` — ${entry.detail}` : ''}\n`,
      );
    }
  }
  process.exitCode = report.status === 'passed' ? 0 : 1;
}

await main();
