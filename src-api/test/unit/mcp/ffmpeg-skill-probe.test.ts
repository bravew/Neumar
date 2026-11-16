/**
 * Managed FFmpeg skill probe fidelity.
 *
 * The probe document used to describe the first picture and the first sound
 * stream without saying which stream that was, and the measuring helpers let
 * FFmpeg choose for themselves. On a file with two pictures or two sounds,
 * FFmpeg's default selection is the largest picture and the track with the
 * most channels, so `probe` described stream 0 while `scenes` and `silence`
 * measured stream 1: a cut or a silence span that belongs to another stream.
 * `probe` also returned `null` for a value ffprobe could not read without
 * naming it as unmeasured, and a writing tool that dropped a source stream
 * still reported `verified: true` with no record of what was left out.
 *
 * These cases drive the real `executeSkillOperation` runner (no mocks) with
 * small synthetic clips. They assert the reported stream identity, the
 * explicitly unmeasured fields, that the measuring tools read the stream the
 * probe describes, and that a cut records the source stream it dropped. The
 * suite is skipped when `detectBinaries()` cannot find ffmpeg/ffprobe.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { detectBinaries } from '@/shared/services/ffmpeg';
import { clearFfmpegContractCache } from '@/shared/services/ffmpeg-skill/contract';
import {
  executeSkillOperation,
  type SkillOperationResult,
} from '@/shared/services/ffmpeg-skill/runner';
import { clearSkillRuntimeCache } from '@/shared/services/ffmpeg-skill/runtime';
import { runWithSessionContext } from '@/shared/services/session-context';

const binaries = detectBinaries();
const mediaDescribe =
  binaries && binaries.ffmpegPath && binaries.ffprobePath
    ? describe
    : describe.skip;

const tempDirs: string[] = [];

afterEach(() => {
  clearFfmpegContractCache();
  clearSkillRuntimeCache();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeWorkDir(): string {
  const dir = realpathSync(
    mkdtempSync(path.join(tmpdir(), 'neumar-ffmpeg-probe-')),
  );
  tempDirs.push(dir);
  return dir;
}

function ffmpegBin(): string {
  if (!binaries?.ffmpegPath) throw new Error('ffmpeg not detected');
  return binaries.ffmpegPath;
}

function runProcess(
  command: string,
  args: string[],
): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stderr }));
  });
}

async function ffmpeg(args: string[]): Promise<void> {
  const { code, stderr } = await runProcess(ffmpegBin(), args);
  if (code !== 0) {
    throw new Error(`ffmpeg ${args.join(' ')} exited ${code}: ${stderr}`);
  }
}

async function execute(
  workDir: string,
  input: { tool: string; args: Record<string, unknown> },
): Promise<SkillOperationResult> {
  return runWithSessionContext({ workDir }, () => executeSkillOperation(input));
}

interface ProbeDetails {
  duration?: number | null;
  unmeasured?: string[];
  stream_counts?: { video: number; audio: number };
  video?: { stream_index?: number };
  audio?: { stream_index?: number };
}

interface SceneDetails {
  scene_count?: number;
}

interface SilenceDetails {
  silences?: Array<[number, number]>;
}

interface CarryDetails {
  source_carry?: { dropped?: string[] };
}

function detailsOf<T>(result: SkillOperationResult): T {
  expect(result.status).toBe('completed');
  expect(result.details).toBeTypeOf('object');
  return result.details as T;
}

/**
 * Stream 0 is a 160x120 solid blue picture with no cuts; stream 1 is a
 * 640x480 picture that changes colour three times. FFmpeg's default selection
 * takes the larger picture, so a tool that measures the default reports cuts
 * the probed stream does not have.
 */
async function makeTwoPictureClip(workDir: string): Promise<string> {
  const small = path.join(workDir, 'small.mp4');
  const big = path.join(workDir, 'big.mp4');
  const combined = path.join(workDir, 'two-pictures.mp4');
  await ffmpeg([
    '-y',
    '-f',
    'lavfi',
    '-i',
    'color=c=blue:s=160x120:r=25:d=2',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-an',
    small,
  ]);
  await ffmpeg([
    '-y',
    '-f',
    'lavfi',
    '-i',
    'color=c=red:s=640x480:r=25:d=0.5',
    '-f',
    'lavfi',
    '-i',
    'color=c=green:s=640x480:r=25:d=0.5',
    '-f',
    'lavfi',
    '-i',
    'color=c=blue:s=640x480:r=25:d=0.5',
    '-f',
    'lavfi',
    '-i',
    'color=c=white:s=640x480:r=25:d=0.5',
    '-filter_complex',
    '[0:v][1:v][2:v][3:v]concat=n=4:v=1:a=0[v]',
    '-map',
    '[v]',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-an',
    big,
  ]);
  await ffmpeg([
    '-y',
    '-i',
    big,
    '-i',
    small,
    '-map',
    '1:v',
    '-map',
    '0:v',
    '-c',
    'copy',
    combined,
  ]);
  return combined;
}

/**
 * Stream 0 is a silent mono track at 44.1 kHz; stream 1 is a 440 Hz stereo
 * track at 48 kHz. FFmpeg's default selection takes the track with the most
 * channels, so a tool that measures the default reads the loud stereo track
 * while `probe` describes the silent first one.
 */
async function makeTwoSoundClip(workDir: string): Promise<string> {
  const silent = path.join(workDir, 'silent-mono.mp4');
  const loud = path.join(workDir, 'loud-stereo.mp4');
  const combined = path.join(workDir, 'two-sounds.mp4');
  await ffmpeg([
    '-y',
    '-f',
    'lavfi',
    '-i',
    'color=c=gray:s=320x240:r=25:d=2',
    '-f',
    'lavfi',
    '-i',
    'anullsrc=r=44100:cl=mono',
    '-t',
    '2',
    '-map',
    '0:v',
    '-map',
    '1:a',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-ac',
    '1',
    '-ar',
    '44100',
    silent,
  ]);
  await ffmpeg([
    '-y',
    '-f',
    'lavfi',
    '-i',
    'color=c=gray:s=320x240:r=25:d=2',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:sample_rate=48000:duration=2',
    '-map',
    '0:v',
    '-map',
    '1:a',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-ac',
    '2',
    '-ar',
    '48000',
    loud,
  ]);
  await ffmpeg([
    '-y',
    '-i',
    silent,
    '-i',
    loud,
    '-map',
    '0:v',
    '-map',
    '0:a',
    '-map',
    '1:a',
    '-c',
    'copy',
    combined,
  ]);
  return combined;
}

/** A raw H.264 elementary stream: ffprobe cannot read a duration or a bitrate. */
async function makeUnmeasuredClip(workDir: string): Promise<string> {
  const raw = path.join(workDir, 'raw.h264');
  await ffmpeg([
    '-y',
    '-f',
    'lavfi',
    '-i',
    'color=c=blue:s=160x120:r=25:d=2',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-an',
    '-f',
    'h264',
    raw,
  ]);
  return raw;
}

/** A small still used as an overlay layer, never as the source clip. */
async function makeLogo(workDir: string): Promise<string> {
  const logo = path.join(workDir, 'logo.png');
  await ffmpeg([
    '-y',
    '-f',
    'lavfi',
    '-i',
    'color=c=white:s=32x32:d=1',
    '-frames:v',
    '1',
    logo,
  ]);
  return logo;
}

/**
 * A two-second MP3 whose only picture stream is cover art: ffprobe reports a
 * video stream with `attached_pic`, so the file has no real video stream even
 * though it carries a picture.
 */
async function makeCoverArtAudio(workDir: string): Promise<string> {
  const cover = path.join(workDir, 'cover.png');
  const tone = path.join(workDir, 'tone.mp3');
  const combined = path.join(workDir, 'cover-art.mp3');
  await ffmpeg([
    '-y',
    '-f',
    'lavfi',
    '-i',
    'color=c=red:s=64x64:d=1',
    '-frames:v',
    '1',
    cover,
  ]);
  await ffmpeg([
    '-y',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:sample_rate=44100:duration=2',
    '-c:a',
    'libmp3lame',
    tone,
  ]);
  await ffmpeg([
    '-y',
    '-i',
    tone,
    '-i',
    cover,
    '-map',
    '0:a',
    '-map',
    '1:v',
    '-c:a',
    'copy',
    '-c:v',
    'png',
    '-disposition:v',
    'attached_pic',
    '-id3v2_version',
    '3',
    '-metadata:s:v',
    'title=Album cover',
    '-metadata:s:v',
    'comment=Cover (front)',
    combined,
  ]);
  return combined;
}

/** A real video clip that also carries a cover picture as an attached_pic. */
async function makeCoverArtVideo(workDir: string): Promise<string> {
  const cover = path.join(workDir, 'video-cover.png');
  const combined = path.join(workDir, 'cover-video.mp4');
  await ffmpeg([
    '-y',
    '-f',
    'lavfi',
    '-i',
    'color=c=red:s=64x64:d=1',
    '-frames:v',
    '1',
    cover,
  ]);
  await ffmpeg([
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=s=160x120:r=25:d=2',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=2',
    '-i',
    cover,
    '-map',
    '0:v',
    '-map',
    '1:a',
    '-map',
    '2:v',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-c:v:1',
    'png',
    '-disposition:v:1',
    'attached_pic',
    '-shortest',
    combined,
  ]);
  return combined;
}

mediaDescribe('ffmpeg skill probe result fidelity', () => {
  it('probe names the picture stream it described', async () => {
    const workDir = makeWorkDir();
    const source = await makeTwoPictureClip(workDir);
    const details = detailsOf<ProbeDetails>(
      await execute(workDir, { tool: 'probe', args: { inputs: [source] } }),
    );
    expect(details.video?.stream_index).toBe(0);
    expect(details.stream_counts).toEqual({ video: 2, audio: 0 });
  });

  it('probe names the sound stream it described', async () => {
    const workDir = makeWorkDir();
    const source = await makeTwoSoundClip(workDir);
    const details = detailsOf<ProbeDetails>(
      await execute(workDir, { tool: 'probe', args: { inputs: [source] } }),
    );
    expect(details.audio?.stream_index).toBe(1);
    expect(details.stream_counts).toEqual({ video: 1, audio: 2 });
  });

  it('probe names the values it could not measure', async () => {
    const workDir = makeWorkDir();
    const source = await makeUnmeasuredClip(workDir);
    const details = detailsOf<ProbeDetails>(
      await execute(workDir, { tool: 'probe', args: { inputs: [source] } }),
    );
    expect(details.duration).toBeNull();
    expect(details.unmeasured).toEqual(
      expect.arrayContaining([
        'duration',
        'bitrate',
        'video.nb_frames',
        'video.bitrate',
      ]),
    );
  });

  it('scenes measures the picture probe describes, not FFmpeg default selection', async () => {
    const workDir = makeWorkDir();
    const source = await makeTwoPictureClip(workDir);
    const details = detailsOf<SceneDetails>(
      await execute(workDir, { tool: 'scenes', args: { input: source } }),
    );
    // The probed stream is one solid colour: the only scene is the whole clip.
    expect(details.scene_count).toBe(1);
  });

  it('silence measures the sound track probe describes, not FFmpeg default selection', async () => {
    const workDir = makeWorkDir();
    const source = await makeTwoSoundClip(workDir);
    const details = detailsOf<SilenceDetails>(
      await execute(workDir, {
        tool: 'silence',
        args: { input: source, list: true },
      }),
    );
    // The probed track is silent for the whole clip; the default selection is
    // the loud stereo track and reports no silence.
    expect(details.silences).toHaveLength(1);
    expect(details.silences?.[0]?.[0]).toBeCloseTo(0, 1);
    expect(details.silences?.[0]?.[1]).toBeCloseTo(2, 1);
  });

  it('a cut records the source picture it left out', async () => {
    const workDir = makeWorkDir();
    const source = await makeTwoPictureClip(workDir);
    const details = detailsOf<CarryDetails>(
      await execute(workDir, {
        tool: 'cut',
        args: { input: source, start: '0', end: '1' },
      }),
    );
    // The tools write one picture; this source carries two, and the result
    // says which kind of source item is missing instead of only `verified`.
    expect(details.source_carry?.dropped).toContain('video_streams');
  });

  it('an audio-only output does not report a cover-art source picture as dropped', async () => {
    const workDir = makeWorkDir();
    const source = await makeCoverArtAudio(workDir);
    const details = detailsOf<CarryDetails>(
      await execute(workDir, {
        tool: 'cut',
        args: {
          input: source,
          start: '0',
          end: '1',
          output: path.join(workDir, 'audio-only.wav'),
        },
      }),
    );
    // The source's only picture is an attached_pic cover, and a WAV cannot
    // carry one. Dropping it is the documented audio-extract behaviour, not a
    // source item the output lost, so it must not appear in `dropped`.
    expect(details.source_carry?.dropped ?? []).not.toContain('cover_art');
  });

  it('a video output that loses cover art still reports it', async () => {
    const workDir = makeWorkDir();
    const source = await makeCoverArtVideo(workDir);
    const details = detailsOf<CarryDetails>(
      await execute(workDir, {
        tool: 'cut',
        args: {
          input: source,
          start: '0',
          end: '1',
          output: path.join(workDir, 'video-only.mp4'),
          accurate: true,
        },
      }),
    );
    // This output keeps a real picture, so the cover it did not carry is a
    // genuine loss and stays in the report.
    expect(details.source_carry?.dropped).toContain('cover_art');
  });

  it('a still image composited onto a clip does not hide the clip comparison', async () => {
    const workDir = makeWorkDir();
    const source = await makeTwoPictureClip(workDir);
    const logo = await makeLogo(workDir);
    const details = detailsOf<CarryDetails>(
      await execute(workDir, {
        tool: 'overlay',
        args: { input: source, image: logo, position: 'top-left' },
      }),
    );
    // The logo is a layer, not a second picture source: the clip's own dropped
    // second picture is still compared and named.
    expect(details.source_carry?.dropped).toContain('video_streams');
  });
});
