// Exercises the real timebase and output-range code paths against the
// `timebase-range` reference fixture, and prints a result marker the
// `scripts/video-acceptance.mjs` harness parses.
//
// It goes through `compileTimelineToEdl`, which is the seam every engine reads,
// so what this asserts is what Remotion, HyperFrames, and the HTML fallback all
// receive — not a parallel reimplementation of the range math.

import { frameRateToNumber } from '@neumar/video-ir';

import { resolveOutputRange } from '@/shared/video/output-range';
import {
  deriveProjectTimebase,
  resolveTimebase,
} from '@/shared/video/timebase';
import { compileTimelineToEdl } from '@/shared/video/timeline';
import type { VideoProject } from '@/shared/video/types';

function parseArgs() {
  const values: Record<string, string> = {};
  for (const arg of process.argv.slice(2)) {
    const [key, value] = arg.split('=', 2);
    if (key?.startsWith('--') && value) values[key.slice(2)] = value;
  }
  const projectPath = values['project'];
  if (!projectPath)
    throw new Error('--project=<path to fixture json> required');
  return { projectPath };
}

async function main() {
  const { projectPath } = parseArgs();
  const fixture = JSON.parse(
    await (await import('node:fs/promises')).readFile(projectPath, 'utf8'),
  ) as { project: VideoProject };
  const project = fixture.project;
  const timeline = project.timeline;
  if (!timeline) throw new Error('Fixture has no timeline');

  const timebase = resolveTimebase({
    stored: project.settings?.timebase,
    timeline,
    assets: project.assets,
  });
  const derived = deriveProjectTimebase(project.assets);
  const resolvedRange = resolveOutputRange(timeline, timebase.rate);

  const ranged = compileTimelineToEdl(project);
  // The same project with the range removed, to prove an unset range still
  // renders exactly as it did before this contract existed.
  const unranged = compileTimelineToEdl({
    ...project,
    timeline: { ...timeline, outputRange: undefined },
  });

  const frameMs = 1000 / frameRateToNumber(timebase.rate);

  process.stdout.write(
    `VIDEO_ACCEPTANCE_RESULT=${JSON.stringify({
      timebase: {
        rate: timebase.rate,
        source: timebase.source,
        locked: timebase.locked,
        derivedReason: derived.reason,
        derivedRate: derived.rate,
        compatibilityFps: timeline.fps,
      },
      range: resolvedRange && {
        inFrame: resolvedRange.inFrame,
        outFrameExclusive: resolvedRange.outFrameExclusive,
        durationFrames: resolvedRange.durationFrames,
        durationMs: resolvedRange.durationMs,
      },
      ranged: {
        durationMs: ranged.durationMs,
        frameRate: ranged.frameRate,
        outputRange: ranged.outputRange,
        segmentIds: ranged.segments.map((segment) => segment.clipId),
        segments: ranged.segments.map((segment) => ({
          clipId: segment.clipId,
          timelineStartMs: segment.timelineStartMs,
          sourceStartMs: segment.sourceStartMs,
          durationMs: segment.durationMs,
          entranceMs: segment.entranceMs ?? null,
          transitionToNext: segment.transitionToNext ?? null,
        })),
        captionIds: ranged.captions.map((caption) => caption.clipId),
        audioClips: ranged.audioTracks.flatMap((track) =>
          track.clips.map((clip) => ({
            clipId: clip.clipId,
            timelineStartMs: clip.timelineStartMs,
            durationMs: clip.durationMs,
            fadeInMs: clip.fadeInMs ?? null,
            fadeOutMs: clip.fadeOutMs ?? null,
          })),
        ),
      },
      unranged: {
        durationMs: unranged.durationMs,
        outputRange: unranged.outputRange ?? null,
        segmentIds: unranged.segments.map((segment) => segment.clipId),
        captionIds: unranged.captions.map((caption) => caption.clipId),
      },
      frameMs,
    })}\n`,
  );
}

await main();
