// Measures the real clip-window query the timeline uses, so the benchmark
// reports the shipped implementation rather than a reimplementation of it.
//
// Prints a single `TIMELINE_WINDOW_BENCH_RESULT=` line that
// `scripts/video-timeline-benchmark.mjs` parses.

import {
  buildClipIntervalIndex,
  queryClipWindow,
} from '@/components/video/timeline/clipWindow';
import type { VideoTimelineClip } from '@/shared/types/video';

interface BenchTrack {
  clips: VideoTimelineClip[];
}

function parseArgs() {
  const values: Record<string, string> = {};
  for (const arg of process.argv.slice(2)) {
    const [key, value] = arg.split('=', 2);
    if (key?.startsWith('--') && value) values[key.slice(2)] = value;
  }
  const fixturePath = values['fixture'];
  if (!fixturePath) throw new Error('--fixture=<path> required');
  return { fixturePath, iterations: Number(values['iterations'] ?? 200) };
}

function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(fraction * sorted.length) - 1),
  );
  return sorted[index]!;
}

async function main() {
  const { fixturePath, iterations } = parseArgs();
  const fs = await import('node:fs/promises');
  const fixture = JSON.parse(await fs.readFile(fixturePath, 'utf8')) as {
    timeline: { durationMs: number; tracks: BenchTrack[] };
  };
  const tracks = fixture.timeline.tracks;
  const durationMs = fixture.timeline.durationMs;

  // Index construction is per-track and memoized on the clip array in the
  // component, so it is measured separately from the per-move query.
  const buildStart = performance.now();
  const indexes = tracks.map((track) => buildClipIntervalIndex(track.clips));
  const buildMs = performance.now() - buildStart;

  // A scroll storm: 200 windows walking the whole timeline, which is the shape
  // of the interaction the budget cares about.
  const windowMs = 10_000;
  const windows = Array.from({ length: iterations }, (_, step) => {
    const startMs = (step / iterations) * Math.max(0, durationMs - windowMs);
    return { startMs, endMs: startMs + windowMs };
  });

  const indexedSamples: number[] = [];
  const linearSamples: number[] = [];
  let mountedTotal = 0;
  let linearTotal = 0;

  for (const window of windows) {
    const indexedStart = performance.now();
    let mounted = 0;
    for (const index of indexes) {
      mounted += queryClipWindow(index, window).length;
    }
    indexedSamples.push(performance.now() - indexedStart);
    mountedTotal += mounted;

    // The Phase 0 baseline measurement, kept so the delta is visible rather
    // than asserted.
    const linearStart = performance.now();
    let linear = 0;
    for (const track of tracks) {
      linear += track.clips.filter(
        (clip) =>
          clip.startMs < window.endMs &&
          clip.startMs + clip.durationMs > window.startMs,
      ).length;
    }
    linearSamples.push(performance.now() - linearStart);
    linearTotal += linear;
  }

  indexedSamples.sort((left, right) => left - right);
  linearSamples.sort((left, right) => left - right);

  const totalClips = tracks.reduce((sum, track) => sum + track.clips.length, 0);

  process.stdout.write(
    `TIMELINE_WINDOW_BENCH_RESULT=${JSON.stringify({
      indexBuildMs: buildMs,
      indexed: {
        p50Ms: percentile(indexedSamples, 0.5),
        p95Ms: percentile(indexedSamples, 0.95),
        maxMs: indexedSamples.at(-1) ?? 0,
      },
      linear: {
        p50Ms: percentile(linearSamples, 0.5),
        p95Ms: percentile(linearSamples, 0.95),
        maxMs: linearSamples.at(-1) ?? 0,
      },
      totalClips,
      meanMountedClips: mountedTotal / windows.length,
      meanLinearVisibleClips: linearTotal / windows.length,
      // Both queries must agree, or the index is not a faithful replacement.
      queriesAgree: mountedTotal === linearTotal,
    })}\n`,
  );
}

await main();
