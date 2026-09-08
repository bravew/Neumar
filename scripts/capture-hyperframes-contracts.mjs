#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const USER_HOME = os.homedir();
const VIDEO_ROOT = path.join(REPO_ROOT, 'src-video');
const sharp = createRequire(path.join(VIDEO_ROOT, 'package.json'))('sharp');
const FIXTURE_DIR = path.join(
  REPO_ROOT,
  'src-api/test/fixtures/video/performance/parity-html',
);
const OVERLAP_FIXTURE_DIR = path.join(
  REPO_ROOT,
  'src-api/test/fixtures/video/performance/overlap-track-order',
);
const HYPERFRAMES = path.join(VIDEO_ROOT, 'node_modules/.bin/hyperframes');
const HELP_COMMANDS = [
  'render',
  'doctor',
  'lint',
  'snapshot',
  'check',
  'compare',
  'grade-compare',
  'preview',
  'upgrade',
];

function parseOutputPath(argv) {
  const value = argv.find((arg) => arg.startsWith('--output='))?.slice(9);
  if (!value) throw new Error('Expected --output=<report.json>');
  return path.resolve(value);
}

function sanitize(value) {
  return value
    .replaceAll(REPO_ROOT, '.')
    .replaceAll(path.dirname(REPO_ROOT), '<workspace-parent>')
    .replaceAll(USER_HOME, '$HOME');
}

function run(args, cwd = REPO_ROOT) {
  const result = spawnSync(HYPERFRAMES, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    timeout: 300_000,
  });
  if (result.error) throw result.error;
  return {
    args: args.map(sanitize),
    status: result.status,
    stdout: sanitize(result.stdout ?? ''),
    stderr: sanitize(result.stderr ?? ''),
  };
}

function trailingJson(stdout) {
  for (let index = stdout.lastIndexOf('{'); index >= 0; index -= 1) {
    if (stdout[index] !== '{') continue;
    try {
      return JSON.parse(stdout.slice(index));
    } catch {
      // Continue searching for the outermost trailing object.
    }
  }
  throw new Error(`HyperFrames returned no trailing JSON: ${stdout}`);
}

function probe(name, args, cwd = REPO_ROOT) {
  const result = run(args, cwd);
  return {
    name,
    args: result.args,
    exitStatus: result.status,
    payload: trailingJson(result.stdout),
    stderr: result.stderr,
  };
}

async function allocatePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not allocate a loopback port'));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

async function main() {
  const reportPath = parseOutputPath(process.argv.slice(2));
  const artifactDir = path.join(
    REPO_ROOT,
    '.video-acceptance/hyperframes-contracts',
  );
  fs.mkdirSync(artifactDir, { recursive: true });

  const help = Object.fromEntries(
    HELP_COMMANDS.map((command) => {
      const result = run([command, '--help']);
      if (result.status !== 0) {
        throw new Error(`${command} --help exited ${result.status}`);
      }
      return [command, result.stdout];
    }),
  );
  const probes = [
    probe('doctor', ['doctor', '--json'], VIDEO_ROOT),
    probe(
      'upgrade-check',
      ['upgrade', '--project', '.', '--check', '--json'],
      VIDEO_ROOT,
    ),
    probe('check', ['check', FIXTURE_DIR, '--json']),
    probe('check-overlap', ['check', OVERLAP_FIXTURE_DIR, '--json']),
    probe('compare', [
      'compare',
      FIXTURE_DIR,
      FIXTURE_DIR,
      '--labels',
      'baseline,candidate',
      '--out',
      path.join(artifactDir, 'compare.png'),
      '--json',
    ]),
  ];

  const referencePath = path.join(artifactDir, 'reference.png');
  const gradePath = path.join(artifactDir, 'grades.json');
  const ffmpeg = spawnSync(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=c=0x224466:size=320x180',
      '-frames:v',
      '1',
      referencePath,
    ],
    { encoding: 'utf8' },
  );
  if (ffmpeg.status !== 0) throw new Error(ffmpeg.stderr);
  fs.writeFileSync(
    gradePath,
    JSON.stringify([
      { label: 'neutral', grading: { brightness: 0, contrast: 1 } },
    ]),
  );
  probes.push(
    probe('grade-compare', [
      'grade-compare',
      '--for',
      referencePath,
      '--project',
      artifactDir,
      '--out',
      path.join(artifactDir, 'grade-compare.png'),
      '--grades',
      gradePath,
      '--json',
    ]),
  );

  const overlapSnapshotDir = path.join(artifactDir, 'overlap-track-order');
  const overlapSnapshot = run([
    'snapshot',
    OVERLAP_FIXTURE_DIR,
    '--at',
    '0.5',
    '--no-end',
    '--output',
    overlapSnapshotDir,
  ]);
  if (overlapSnapshot.status !== 0) {
    throw new Error(`Overlap snapshot failed: ${overlapSnapshot.stderr}`);
  }
  const overlapPng = fs
    .readdirSync(overlapSnapshotDir)
    .find((entry) => entry.endsWith('.png'));
  if (!overlapPng) throw new Error('Overlap snapshot produced no PNG');
  const { data: pixels, info } = await sharp(
    path.join(overlapSnapshotDir, overlapPng),
  )
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const centerOffset =
    (Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) *
    info.channels;
  const centerPixel = [...pixels.subarray(centerOffset, centerOffset + 3)];
  probes.push({
    name: 'track-index-paint-order',
    args: ['snapshot', './overlap-track-order', '--at', '0.5'],
    exitStatus: overlapSnapshot.status,
    payload: {
      centerPixel,
      cssPaintOrderWins:
        centerPixel[2] > 240 && centerPixel[0] < 15 && centerPixel[1] < 15,
    },
    stderr: overlapSnapshot.stderr,
  });

  const port = await allocatePort();
  const previewBase = [
    'preview',
    FIXTURE_DIR,
    '--port',
    String(port),
    '--json',
  ];
  try {
    probes.push(
      probe('preview-start', [
        ...previewBase.slice(0, -1),
        '--background',
        '--no-open',
        '--json',
      ]),
    );
    probes.push(
      probe('preview-context', [
        ...previewBase.slice(0, -1),
        '--context',
        '--context-fields',
        'server',
        '--json',
      ]),
    );
  } finally {
    probes.push(
      probe('preview-stop', [...previewBase.slice(0, -1), '--stop', '--json']),
    );
  }

  const report = {
    schemaVersion: 1,
    hyperframesVersion: run(['--version']).stdout.trim(),
    generatedAt: new Date().toISOString(),
    help,
    probes,
  };
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`captured: ${reportPath}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
  process.exitCode = 1;
});
