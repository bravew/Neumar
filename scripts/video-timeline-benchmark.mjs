#!/usr/bin/env node

import {
  buildVideoReferenceFixture,
  fixtureDigest,
  stableJson,
  VIDEO_REFERENCE_FIXTURE_VERSION,
} from './lib/video-reference-fixtures.mjs';

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

function commandOutput(bin, args) {
  try {
    return execFileSync(bin, args, { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

function parsePositiveInteger(raw, label) {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}

function parseArgs(argv) {
  const args = {
    clips: 1_000,
    tracks: 12,
    json: false,
    iterations: 4_000,
    report: undefined,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') args.json = true;
    else if (arg === '--production') args.production = true;
    else if (arg === '--clips')
      args.clips = parsePositiveInteger(argv[++index], '--clips');
    else if (arg.startsWith('--clips='))
      args.clips = parsePositiveInteger(arg.slice(8), '--clips');
    else if (arg === '--tracks')
      args.tracks = parsePositiveInteger(argv[++index], '--tracks');
    else if (arg.startsWith('--tracks='))
      args.tracks = parsePositiveInteger(arg.slice(9), '--tracks');
    else if (arg === '--iterations')
      args.iterations = parsePositiveInteger(argv[++index], '--iterations');
    else if (arg.startsWith('--iterations='))
      args.iterations = parsePositiveInteger(arg.slice(13), '--iterations');
    else if (arg === '--report') args.report = argv[++index];
    else if (arg.startsWith('--report=')) args.report = arg.slice(9);
    else if (arg === '--compare' || arg === '--fixture') index += 1;
    else if (arg.startsWith('--compare=') || arg.startsWith('--fixture='))
      continue;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function percentile(sorted, fraction) {
  return (
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ??
    0
  );
}

function macHostDetails() {
  if (process.platform !== 'darwin') return {};
  const displays = commandOutput('system_profiler', ['SPDisplaysDataType']);
  const power = commandOutput('pmset', ['-g', 'custom']);
  const lowPowerMode = power.match(/^\s*lowpowermode\s+(\d+)/m)?.[1];
  return {
    macos: commandOutput('sw_vers', ['-productVersion']) || 'not detected',
    display: displays.match(/^\s*Resolution:\s*(.+)$/m)?.[1] ?? 'not detected',
    displayScale:
      displays.match(/^\s*UI Looks like:\s*(.+)$/m)?.[1] ?? 'not detected',
    powerMode: lowPowerMode === '1' ? 'low power' : 'standard',
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const fixture = buildVideoReferenceFixture('timeline-1000', {
    clipCount: args.clips,
    trackCount: args.tracks,
  });
  const windows = Array.from({ length: args.iterations }, (_, index) => {
    const startMs =
      (index * 137) % Math.max(1, fixture.timeline.durationMs - 10_000);
    return { startMs, endMs: startMs + 10_000 };
  });
  const samples = [];
  let visibleClipTotal = 0;
  for (const window of windows) {
    const startedAt = performance.now();
    for (const track of fixture.timeline.tracks) {
      visibleClipTotal += track.clips.filter(
        (clip) =>
          clip.startMs < window.endMs &&
          clip.startMs + clip.durationMs > window.startMs,
      ).length;
    }
    samples.push(performance.now() - startedAt);
  }
  samples.sort((left, right) => left - right);
  const report = {
    schemaVersion: VIDEO_REFERENCE_FIXTURE_VERSION,
    kind: 'video-timeline-benchmark',
    measurementKind: 'model-linear-window-query',
    fixture: 'video-timeline-1000-v1',
    fixtureDigest: fixtureDigest(fixture),
    generatedAt: new Date().toISOString(),
    command: `node scripts/video-timeline-benchmark.mjs ${process.argv.slice(2).join(' ')}`,
    environment: {
      platform: process.platform,
      architecture: process.arch,
      release: os.release(),
      cpu: os.cpus()[0]?.model ?? 'unknown',
      memoryBytes: os.totalmem(),
      node: process.version,
      ...macHostDetails(),
    },
    input: {
      clips: args.clips,
      tracks: args.tracks,
      iterations: args.iterations,
    },
    result: {
      p50Ms: percentile(samples, 0.5),
      p95Ms: percentile(samples, 0.95),
      maxMs: samples.at(-1) ?? 0,
      meanVisibleClips: visibleClipTotal / args.iterations,
      mountedDomClips: null,
    },
    limitations: [
      'This Phase 0 baseline measures the current linear clip-window query only.',
      'Phase 3 must add the production browser interaction and mounted-DOM measurements.',
    ],
    status: 'passed',
  };
  const outputDir = path.resolve('.video-acceptance/timeline-1000');
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, 'report.json'), stableJson(report));
  if (args.report) {
    const reportPath = path.resolve(args.report);
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, stableJson(report));
  }
  process.stdout.write(
    args.json ? stableJson(report) : `passed: ${outputDir}\n`,
  );
}

try {
  main();
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
