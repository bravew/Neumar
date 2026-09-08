#!/usr/bin/env node

import {
  buildVideoReferenceFixture,
  fixtureDigest,
  stableJson,
  VIDEO_REFERENCE_FIXTURE_VERSION,
  VIDEO_REFERENCE_FIXTURES,
} from './lib/video-reference-fixtures.mjs';

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const DEFAULT_OUTPUT_ROOT = path.join(REPO_ROOT, '.video-acceptance');
const PARITY_HTML_DIR = path.join(
  REPO_ROOT,
  'src-api/test/fixtures/video/performance/parity-html',
);
const SYSTEM_CHROME =
  process.platform === 'darwin'
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    : 'google-chrome';

function parseArgs(argv) {
  const args = {
    fixture: undefined,
    compare: undefined,
    json: false,
    output: undefined,
    report: undefined,
    skipRender: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') args.json = true;
    else if (arg === '--skip-render') args.skipRender = true;
    else if (arg === '--fixture') args.fixture = argv[++index];
    else if (arg.startsWith('--fixture=')) args.fixture = arg.slice(10);
    else if (arg === '--output') args.output = argv[++index];
    else if (arg.startsWith('--output=')) args.output = arg.slice(9);
    else if (arg === '--report') args.report = argv[++index];
    else if (arg.startsWith('--report=')) args.report = arg.slice(9);
    else if (arg === '--compare') args.compare = argv[++index];
    else if (arg.startsWith('--compare=')) args.compare = arg.slice(10);
    else if (arg === '--engines') index += 1;
    else if (arg.startsWith('--engines=')) continue;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!VIDEO_REFERENCE_FIXTURES.includes(args.fixture)) {
    throw new Error(
      `--fixture must be one of: ${VIDEO_REFERENCE_FIXTURES.join(', ')}`,
    );
  }
  return args;
}

function commandVersion(bin, args) {
  try {
    return execFileSync(bin, args, { encoding: 'utf8' }).trim().split('\n')[0];
  } catch (error) {
    return `unavailable: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function packageVersion(packagePath) {
  const parsed = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  return parsed.version;
}

function commandOutput(bin, args) {
  try {
    return execFileSync(bin, args, { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

function macHostDetails() {
  if (process.platform !== 'darwin') return {};
  const displays = commandOutput('system_profiler', ['SPDisplaysDataType']);
  const resolution = displays.match(/^\s*Resolution:\s*(.+)$/m)?.[1];
  const displayScale = displays.match(/^\s*UI Looks like:\s*(.+)$/m)?.[1];
  const power = commandOutput('pmset', ['-g', 'custom']);
  const lowPowerMode = power.match(/^\s*lowpowermode\s+(\d+)/m)?.[1];
  return {
    macos: commandOutput('sw_vers', ['-productVersion']),
    display: resolution ?? 'not detected',
    displayScale: displayScale ?? 'not detected',
    powerMode: lowPowerMode === '1' ? 'low power' : 'standard',
  };
}

function environment() {
  return {
    platform: process.platform,
    architecture: process.arch,
    release: os.release(),
    cpu: os.cpus()[0]?.model ?? 'unknown',
    memoryBytes: os.totalmem(),
    node: process.version,
    pnpm: commandVersion('pnpm', ['--version']),
    ffmpeg: commandVersion('ffmpeg', ['-version']),
    chrome: commandVersion(SYSTEM_CHROME, ['--version']),
    remotion: packageVersion(
      path.join(REPO_ROOT, 'node_modules/remotion/package.json'),
    ),
    hyperframes: packageVersion(
      path.join(REPO_ROOT, 'src-video/node_modules/hyperframes/package.json'),
    ),
    ...macHostDetails(),
  };
}

function assertFixture(name, fixture) {
  const timeline =
    name === 'stale-revision' ? fixture.project.timeline : fixture.timeline;
  const clips = timeline.tracks.flatMap((track) => track.clips);
  const checks = [
    check('timeline-schema', timeline.schema === 'neuma.video.timeline.v1'),
    check('positive-duration', timeline.durationMs > 0),
  ];
  if (name === 'parity') {
    checks.push(
      check('parity-duration-15s', timeline.durationMs === 15_000),
      check(
        'transform-and-crop',
        clips.some((clip) => clip.transforms?.crop),
      ),
      check(
        'effect-keyframes',
        clips.some((clip) => clip.effects?.keyframes?.length),
      ),
      check(
        'caption',
        clips.some((clip) => clip.kind === 'caption'),
      ),
      check(
        'audio-fades',
        clips.some((clip) => clip.fadeInMs && clip.fadeOutMs),
      ),
      check(
        'playback-rate',
        clips.some((clip) => clip.playback?.speed !== 1),
      ),
      check(
        'transition',
        clips.some((clip) => clip.transitionToNext),
      ),
      check(
        'html-overlay',
        clips.some((clip) => clip.params?.renderer === 'html'),
      ),
    );
  } else if (name === 'long-render') {
    checks.push(
      check('duration-at-least-3m', timeline.durationMs >= 180_000),
      check('mixed-media', new Set(clips.map((clip) => clip.kind)).size >= 3),
    );
  } else if (name === 'timeline-1000') {
    checks.push(
      check('twelve-tracks', timeline.tracks.length === 12),
      check('one-thousand-clips', clips.length === 1_000),
    );
  } else if (name === 'offline-media') {
    checks.push(
      check(
        'external-master',
        fixture.assets.some((asset) => asset.origin === 'external'),
      ),
    );
  } else if (name === 'stale-revision') {
    checks.push(
      check('two-clients', fixture.clients.length === 2),
      check(
        'shared-expected-revision',
        new Set(fixture.clients.map((client) => client.expectedProjectRevision))
          .size === 1,
      ),
      check('conflict-contract', fixture.expected.secondWriteStatus === 409),
    );
  }
  return checks;
}

function check(name, passed, detail) {
  return {
    name,
    status: passed ? 'passed' : 'failed',
    ...(detail ? { detail } : {}),
  };
}

function run(command, args, cwd = REPO_ROOT) {
  const startedAt = performance.now();
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed (${result.status})\n${result.stderr || result.stdout}`,
    );
  }
  return {
    wallClockMs: Math.round(performance.now() - startedAt),
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function probeVideo(filePath) {
  const raw = execFileSync(
    'ffprobe',
    [
      '-v',
      'error',
      '-show_entries',
      'stream=codec_type,width,height,avg_frame_rate,nb_frames,channels,channel_layout:format=duration,size',
      '-of',
      'json',
      filePath,
    ],
    { encoding: 'utf8' },
  );
  return JSON.parse(raw);
}

function sampleFrameHashes(filePath, outputDir) {
  fs.mkdirSync(outputDir, { recursive: true });
  return [1.5, 7.5, 13.5].map((timestamp) => {
    const target = path.join(outputDir, `frame-${timestamp.toFixed(1)}.png`);
    execFileSync(
      'ffmpeg',
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-ss',
        String(timestamp),
        '-i',
        filePath,
        '-frames:v',
        '1',
        target,
      ],
      { stdio: 'pipe' },
    );
    return {
      timestampSec: timestamp,
      sha256: createHash('sha256')
        .update(fs.readFileSync(target))
        .digest('hex'),
    };
  });
}

function ssim(left, right) {
  const result = spawnSync(
    'ffmpeg',
    [
      '-hide_banner',
      '-i',
      left,
      '-i',
      right,
      '-lavfi',
      'ssim',
      '-f',
      'null',
      '-',
    ],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
  );
  const match = result.stderr
    .match(/All:([0-9.]+)/g)
    ?.at(-1)
    ?.match(/All:([0-9.]+)/);
  return match ? Number(match[1]) : null;
}

function runParityRender(outputDir) {
  const rendered = run('pnpm', [
    'exec',
    'tsx',
    '--tsconfig',
    'src-api/tsconfig.json',
    'src-api/test/acceptance/video-engine-acceptance.ts',
    `--fixture-dir=${PARITY_HTML_DIR}`,
    `--output-dir=${outputDir}`,
    '--duration-sec=15',
  ]);
  const marker = rendered.stdout
    .split('\n')
    .find((line) => line.startsWith('VIDEO_ACCEPTANCE_RESULT='));
  if (!marker) throw new Error('Video engine runner returned no result marker');
  const engines = JSON.parse(marker.slice('VIDEO_ACCEPTANCE_RESULT='.length));
  const htmlPath = path.join(outputDir, 'html.mp4');
  const hyperframesPath = path.join(outputDir, 'hyperframes.mp4');
  return {
    wallClockMs: rendered.wallClockMs,
    engines: {
      html: engines.html.meta,
      hyperframes: engines.hyperframes.meta,
    },
    studioSelection: engines.studioSelection,
    probes: {
      html: probeVideo(htmlPath),
      hyperframes: probeVideo(hyperframesPath),
    },
    sampledFrames: {
      html: sampleFrameHashes(htmlPath, path.join(outputDir, 'frames', 'html')),
      hyperframes: sampleFrameHashes(
        hyperframesPath,
        path.join(outputDir, 'frames', 'hyperframes'),
      ),
    },
    ssim: ssim(htmlPath, hyperframesPath),
  };
}

function runLongRender(outputDir) {
  const timed = run('/usr/bin/time', [
    '-l',
    'pnpm',
    'exec',
    'tsx',
    '--tsconfig',
    'src-api/tsconfig.json',
    'src-api/test/acceptance/video-remotion-long-acceptance.ts',
    `--output-dir=${outputDir}`,
  ]);
  const marker = timed.stdout
    .split('\n')
    .find((line) => line.startsWith('VIDEO_ACCEPTANCE_RESULT='));
  if (!marker) throw new Error('Long-render runner returned no result marker');
  const result = JSON.parse(marker.slice('VIDEO_ACCEPTANCE_RESULT='.length));
  const rssMatch = timed.stderr.match(/(\d+)\s+maximum resident set size/);
  const outputPath = path.join(outputDir, 'remotion-long.mp4');
  return {
    wallClockMs: result.wallClockMs,
    peakRssBytes: rssMatch ? Number(rssMatch[1]) : null,
    fileSizeBytes: result.fileSizeBytes,
    durationInFrames: result.durationInFrames,
    fps: result.fps,
    visualClipCount: result.visualClipCount,
    audioClipCount: result.audioClipCount,
    mediaKinds: result.mediaKinds,
    useRemotionMedia: result.useRemotionMedia,
    sourceAudioChannels: result.sourceAudioChannels,
    probe: probeVideo(outputPath),
    sampledFrames: sampleFrameHashes(
      outputPath,
      path.join(outputDir, 'frames'),
    ),
  };
}

function comparisonFor(fixture, render, label) {
  if (!label || !render) return undefined;
  const reportName =
    fixture === 'long-render' ? 'long-render.json' : `${fixture}.json`;
  const baselinePath = path.join(
    REPO_ROOT,
    'dev-doc/video-mode/19-09-08-reference-upgrades/evidence',
    label,
    reportName,
  );
  if (!fs.existsSync(baselinePath)) {
    throw new Error(`Comparison report does not exist: ${baselinePath}`);
  }
  const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  if (baseline.fixture !== fixture || !baseline.render) {
    throw new Error(`Comparison report is not a rendered ${fixture} result`);
  }
  if (fixture === 'parity') {
    const baselineHashes = Object.fromEntries(
      Object.entries(baseline.render.sampledFrames).map(([engine, samples]) => [
        engine,
        samples.map((sample) => sample.sha256),
      ]),
    );
    const currentHashes = Object.fromEntries(
      Object.entries(render.sampledFrames).map(([engine, samples]) => [
        engine,
        samples.map((sample) => sample.sha256),
      ]),
    );
    return {
      baseline: label,
      baselineFixtureDigest: baseline.fixtureDigest,
      ssimDelta: render.ssim - baseline.render.ssim,
      sampledFrameHashesMatch: {
        html:
          JSON.stringify(currentHashes.html) ===
          JSON.stringify(baselineHashes.html),
        hyperframes:
          JSON.stringify(currentHashes.hyperframes) ===
          JSON.stringify(baselineHashes.hyperframes),
      },
      renderWallClockDeltaPct: {
        html:
          ((render.engines.html.renderWallClockSec -
            baseline.render.engines.html.renderWallClockSec) /
            baseline.render.engines.html.renderWallClockSec) *
          100,
        hyperframes:
          ((render.engines.hyperframes.renderWallClockSec -
            baseline.render.engines.hyperframes.renderWallClockSec) /
            baseline.render.engines.hyperframes.renderWallClockSec) *
          100,
      },
    };
  }
  const peakRssDeltaPct =
    ((render.peakRssBytes - baseline.render.peakRssBytes) /
      baseline.render.peakRssBytes) *
    100;
  return {
    baseline: label,
    baselineFixtureDigest: baseline.fixtureDigest,
    peakRssDeltaPct,
    peakRssWithinTenPercent: peakRssDeltaPct <= 10,
    wallClockDeltaPct:
      ((render.wallClockMs - baseline.render.wallClockMs) /
        baseline.render.wallClockMs) *
      100,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const fixture = buildVideoReferenceFixture(args.fixture);
  const digest = fixtureDigest(fixture);
  const outputRoot = path.resolve(args.output ?? DEFAULT_OUTPUT_ROOT);
  const outputDir = path.join(outputRoot, args.fixture, digest.slice(0, 12));
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, 'fixture.json'), stableJson(fixture));

  const checks = assertFixture(args.fixture, fixture);
  let render;
  if (args.fixture === 'parity' && !args.skipRender) {
    render = runParityRender(path.join(outputDir, 'render'));
    checks.push(
      check(
        'html-duration',
        Number(render.probes.html.format.duration) >= 14.9,
      ),
      check(
        'hyperframes-duration',
        Number(render.probes.hyperframes.format.duration) >= 14.9,
      ),
      check(
        'sampled-frame-comparison',
        render.ssim !== null,
        `SSIM ${render.ssim}`,
      ),
      check(
        'studio-selection-data-hf-id',
        render.studioSelection.stableTarget === 'parity-card',
      ),
    );
  } else if (args.fixture === 'long-render' && !args.skipRender) {
    render = runLongRender(path.join(outputDir, 'render'));
    checks.push(
      check('remotion-media-enabled', render.useRemotionMedia === true),
      check(
        'actual-mixed-media',
        render.mediaKinds.includes('video') &&
          render.mediaKinds.includes('image') &&
          render.audioClipCount > 0,
      ),
      check('five-one-source', render.sourceAudioChannels === 6),
      check(
        'rendered-audio-stream',
        render.probe.streams.some(
          (stream) => stream.codec_type === 'audio' && stream.channels > 0,
        ),
      ),
      check(
        'rendered-three-minutes',
        Number(render.probe.format.duration) >= 179.9,
      ),
      check('peak-rss-captured', Number.isFinite(render.peakRssBytes)),
    );
  }
  const comparison = comparisonFor(args.fixture, render, args.compare);
  if (comparison?.peakRssWithinTenPercent !== undefined) {
    checks.push(
      check(
        'peak-rss-regression-within-ten-percent',
        comparison.peakRssWithinTenPercent,
        `${comparison.peakRssDeltaPct.toFixed(2)}%`,
      ),
    );
  }

  const report = {
    schemaVersion: VIDEO_REFERENCE_FIXTURE_VERSION,
    kind: 'video-acceptance',
    fixture: args.fixture,
    fixtureDigest: digest,
    generatedAt: new Date().toISOString(),
    command: `node scripts/video-acceptance.mjs ${process.argv.slice(2).join(' ')}`,
    environment: environment(),
    checks,
    status: checks.every((entry) => entry.status === 'passed')
      ? 'passed'
      : 'failed',
    ...(render ? { render } : {}),
    ...(comparison ? { comparison } : {}),
  };
  fs.writeFileSync(path.join(outputDir, 'report.json'), stableJson(report));
  if (args.report) {
    const reportPath = path.resolve(args.report);
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, stableJson(report));
  }
  process.stdout.write(
    args.json ? stableJson(report) : `${report.status}: ${outputDir}\n`,
  );
  if (report.status !== 'passed') process.exitCode = 1;
}

try {
  main();
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
