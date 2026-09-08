import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import { renderProjectWithRemotion } from '@/shared/video/remotion-renderer';
import type { TimelineTrack, VideoProject } from '@/shared/video/types';

const ArgsSchema = z.object({ outputDir: z.string().min(1) });
const PROJECT_ID = 'video-long-render-v1';
const DURATION_MS = 180_000;
const CLIP_DURATION_MS = 15_000;

function parseArgs() {
  const values: Record<string, string> = {};
  for (const arg of process.argv.slice(2)) {
    const [key, value] = arg.split('=', 2);
    if (key?.startsWith('--') && value) values[key.slice(2)] = value;
  }
  return ArgsSchema.parse({ outputDir: values['output-dir'] });
}

async function main() {
  const { outputDir: rawOutputDir } = parseArgs();
  const outputDir = path.resolve(rawOutputDir);
  const videoRelativePath = `videos/${PROJECT_ID}/assets/source.mp4`;
  const imageRelativePath = `videos/${PROJECT_ID}/assets/source.png`;
  const audioRelativePath = `videos/${PROJECT_ID}/assets/source.m4a`;
  const videoPath = path.join(outputDir, videoRelativePath);
  const imagePath = path.join(outputDir, imageRelativePath);
  const audioPath = path.join(outputDir, audioRelativePath);
  const renderPath = path.join(outputDir, 'remotion-long.mp4');
  await fs.mkdir(path.dirname(videoPath), { recursive: true });
  await fs.mkdir(path.dirname(renderPath), { recursive: true });
  await Promise.all([
    ensureVideoSource(videoPath),
    ensureImageSource(imagePath),
    ensureAudioSource(audioPath),
  ]);

  const track: TimelineTrack = {
    id: 'long-video-track',
    kind: 'video',
    name: 'Video 1',
    muted: false,
    locked: false,
    order: 0,
    clips: Array.from({ length: 12 }, (_, index) => {
      const isImage = index % 3 === 2;
      return {
        id: `long-visual-${String(index).padStart(2, '0')}`,
        kind: isImage ? ('image' as const) : ('video' as const),
        sourceRef: {
          kind: 'asset' as const,
          assetId: isImage ? 'long-image' : 'long-video',
        },
        startMs: index * CLIP_DURATION_MS,
        durationMs: CLIP_DURATION_MS,
        trimStartMs: isImage ? 0 : index % 2 === 0 ? 0 : CLIP_DURATION_MS,
        trimEndMs: isImage
          ? CLIP_DURATION_MS
          : index % 2 === 0
            ? CLIP_DURATION_MS
            : DURATION_MS / 6,
        sourceDurationMs: isImage ? CLIP_DURATION_MS : DURATION_MS / 6,
        playback: {
          speed: 1,
          reverse: false,
          pitchCorrection: true,
        },
        ...(index === 0
          ? {
              effects: {
                schema: 'neuma.video.clip-effects.v1' as const,
                effects: [
                  {
                    id: '0199255e-88fa-7000-8000-000000000002',
                    version: 1 as const,
                    kind: 'brightness' as const,
                    params: { amount: 0.05 },
                  },
                ],
              },
            }
          : {}),
      };
    }),
  };
  const audioTrack: TimelineTrack = {
    id: 'long-audio-track',
    kind: 'audio-music',
    name: 'Audio 1',
    muted: false,
    locked: false,
    order: 1,
    clips: [
      {
        id: 'long-audio-00',
        kind: 'audio',
        sourceRef: { kind: 'asset', assetId: 'long-audio' },
        startMs: 0,
        durationMs: DURATION_MS,
        trimStartMs: 0,
        trimEndMs: DURATION_MS,
        sourceDurationMs: DURATION_MS,
        fadeInMs: 500,
        fadeOutMs: 500,
      },
    ],
  };
  const project = {
    schemaVersion: 2,
    revision: 1,
    id: PROJECT_ID,
    name: 'Three minute mixed-media acceptance',
    template: 'explainer',
    prompt: 'Deterministic long render fixture',
    assets: [
      {
        id: 'long-video',
        kind: 'video',
        source: 'user',
        path: videoRelativePath,
        metadata: {
          durationMs: DURATION_MS / 6,
          width: 1280,
          height: 720,
          frameRate: 30,
          audioTrackCount: 1,
          channels: 6,
        },
      },
      {
        id: 'long-image',
        kind: 'image',
        source: 'user',
        path: imageRelativePath,
        metadata: { width: 1280, height: 720 },
      },
      {
        id: 'long-audio',
        kind: 'audio',
        source: 'user',
        path: audioRelativePath,
        metadata: { durationMs: DURATION_MS, audioTrackCount: 1, channels: 2 },
      },
    ],
    timeline: {
      schema: 'neuma.video.timeline.v1',
      durationMs: DURATION_MS,
      fps: 30,
      frameRate: { num: 30, den: 1 },
      tracks: [track, audioTrack],
    },
    render: { status: 'idle', updatedAt: '2026-09-08T00:00:00.000Z' },
    budget: { capUsd: 5, spentUsd: 0 },
    outputs: [],
    createdAt: '2026-09-08T00:00:00.000Z',
    updatedAt: '2026-09-08T00:00:00.000Z',
  } satisfies VideoProject;

  const startedAt = performance.now();
  const input = await renderProjectWithRemotion({
    project,
    outputPath: renderPath,
    aspectRatio: '16:9',
    mode: 'speed',
    includeCaptions: true,
    root: outputDir,
  });
  const stat = await fs.stat(renderPath);
  process.stdout.write(
    `VIDEO_ACCEPTANCE_RESULT=${JSON.stringify({
      outputPath: renderPath,
      wallClockMs: Math.round(performance.now() - startedAt),
      fileSizeBytes: stat.size,
      durationInFrames: input.durationInFrames,
      fps: input.fps,
      visualClipCount: input.visualClips.length,
      audioClipCount: input.audioClips.length,
      mediaKinds: [...new Set(input.visualClips.map((clip) => clip.mediaKind))],
      useRemotionMedia: input.useRemotionMedia,
      sourceAudioChannels: probeAudioChannels(videoPath),
    })}\n`,
  );
}

function probeAudioChannels(sourcePath: string): number {
  const output = execFileSync(
    'ffprobe',
    [
      '-v',
      'error',
      '-select_streams',
      'a:0',
      '-show_entries',
      'stream=channels',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      sourcePath,
    ],
    { encoding: 'utf8' },
  ).trim();
  const channels = Number(output);
  if (!Number.isInteger(channels) || channels <= 0) {
    throw new Error(`Could not probe source audio channels: ${output}`);
  }
  return channels;
}

async function ensureVideoSource(sourcePath: string) {
  const stat = await fs.stat(sourcePath).catch(() => null);
  if (stat?.isFile() && stat.size > 0) return;
  execFileSync(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=1280x720:rate=30',
      '-f',
      'lavfi',
      '-i',
      'anullsrc=channel_layout=5.1:sample_rate=48000',
      '-t',
      String(DURATION_MS / 6 / 1_000),
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-ac',
      '6',
      sourcePath,
    ],
    { stdio: 'pipe' },
  );
}

async function ensureImageSource(sourcePath: string) {
  const stat = await fs.stat(sourcePath).catch(() => null);
  if (stat?.isFile() && stat.size > 0) return;
  execFileSync(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=c=0x224466:size=1280x720',
      '-frames:v',
      '1',
      sourcePath,
    ],
    { stdio: 'pipe' },
  );
}

async function ensureAudioSource(sourcePath: string) {
  const stat = await fs.stat(sourcePath).catch(() => null);
  if (stat?.isFile() && stat.size > 0) return;
  execFileSync(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'anullsrc=channel_layout=stereo:sample_rate=48000',
      '-t',
      String(DURATION_MS / 1_000),
      '-c:a',
      'aac',
      sourcePath,
    ],
    { stdio: 'pipe' },
  );
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
