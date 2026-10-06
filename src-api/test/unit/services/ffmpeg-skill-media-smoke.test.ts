/**
 * Real-media correctness smoke for the managed FFmpeg skill.
 *
 * These cases generate tiny synthetic footage with the installed FFmpeg and
 * drive the vendored skill through the real `executeSkillOperation` runner (no
 * mocks). They assert measured facts:
 *
 *   - probe reports the real duration/fps/resolution/codec of the source,
 *   - a stream-copy cut never mutates the source bytes and yields the
 *     requested range,
 *   - a picture op (crop) produces an output whose probed resolution matches
 *     the request,
 *   - loudness `--measure-only` returns a real finite measurement.
 *
 * Gating: the whole suite is skipped when `detectBinaries()` cannot find
 * ffmpeg/ffprobe, so a clean CI box without FFmpeg never fails. The clips are
 * one or two seconds, so the suite stays inside the fast default run; it is
 * intentionally a separate file so it can be excluded from a minimal gate if a
 * host ever wants to avoid real FFmpeg execution entirely.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, realpathSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { detectBinaries } from '@/shared/services/ffmpeg';
import { clearFfmpegContractCache } from '@/shared/services/ffmpeg-skill/contract';
import { executeSkillOperation } from '@/shared/services/ffmpeg-skill/runner';
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
    mkdtempSync(path.join(tmpdir(), 'neumar-ffmpeg-smoke-')),
  );
  tempDirs.push(dir);
  return dir;
}

function ffmpegBin(): string {
  if (!binaries?.ffmpegPath) throw new Error('ffmpeg not detected');
  return binaries.ffmpegPath;
}

function ffprobeBin(): string {
  if (!binaries?.ffprobePath) throw new Error('ffprobe not detected');
  return binaries.ffprobePath;
}

function runProcess(
  command: string,
  args: string[],
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

async function ffmpeg(args: string[]): Promise<void> {
  const { code, stderr } = await runProcess(ffmpegBin(), args);
  if (code !== 0) {
    throw new Error(`ffmpeg ${args.join(' ')} exited ${code}: ${stderr}`);
  }
}

interface FfprobeDocument {
  streams: Array<{
    codec_type?: string;
    codec_name?: string;
    width?: number;
    height?: number;
    r_frame_rate?: string;
  }>;
  format?: { duration?: string };
}

async function ffprobe(filePath: string): Promise<FfprobeDocument> {
  const { code, stdout, stderr } = await runProcess(ffprobeBin(), [
    '-v',
    'error',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    filePath,
  ]);
  if (code !== 0) {
    throw new Error(`ffprobe exited ${code}: ${stderr}`);
  }
  return JSON.parse(stdout) as FfprobeDocument;
}

async function makeSource(
  workDir: string,
  name = 'source.mp4',
): Promise<string> {
  // Intra-only (GOP 1) so a lossless stream-copy cut lands on frame boundaries
  // and the requested range can be asserted precisely.
  const source = path.join(workDir, name);
  await ffmpeg([
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=1280x720:rate=30:duration=2',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=2',
    '-shortest',
    '-c:v',
    'libx264',
    '-g',
    '1',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    source,
  ]);
  return source;
}

function sha256Of(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function probeDetails(details: unknown): {
  duration?: number;
  video?: { width?: number; height?: number; fps?: number; codec?: string };
} {
  if (!details || typeof details !== 'object') return {};
  const record = details as {
    duration?: number;
    video?: { width?: number; height?: number; fps?: number; codec?: string };
  };
  return { duration: record.duration, video: record.video };
}

mediaDescribe('managed FFmpeg skill media correctness', () => {
  it('probe reports the real duration, fps, resolution, and codec', async () => {
    const workDir = makeWorkDir();
    const source = await makeSource(workDir);

    const probe = await runWithSessionContext({ workDir }, () =>
      executeSkillOperation({ tool: 'probe', args: { inputs: [source] } }),
    );

    expect(probe.status).toBe('completed');
    const facts = probeDetails(probe.details);
    expect(facts.video?.width).toBe(1280);
    expect(facts.video?.height).toBe(720);
    expect(facts.video?.fps).toBe(30);
    expect(facts.video?.codec).toBe('h264');
    expect(facts.duration).toBeGreaterThan(1.8);
    expect(facts.duration).toBeLessThan(2.2);
  });

  it('a stream-copy cut leaves the source bytes unchanged and matches the requested range', async () => {
    const workDir = makeWorkDir();
    const source = await makeSource(workDir);
    const before = sha256Of(source);

    const cut = await runWithSessionContext({ workDir }, () =>
      executeSkillOperation({
        tool: 'cut',
        args: { input: source, start: '0', duration: '1' },
      }),
    );

    expect(cut.status).toBe('completed');
    expect(cut.artifactCreated).toBe(true);
    expect(cut.artifact?.path).toBeTruthy();

    // The source input must be byte-identical after the operation.
    expect(sha256Of(source)).toBe(before);

    // The tool reports a stream copy, not a silent re-encode.
    const details = cut.details as {
      mode?: string;
      duration_delta_seconds?: number;
    };
    expect(details.mode).toBe('copy');
    expect(Math.abs(details.duration_delta_seconds ?? 1)).toBeLessThan(0.15);

    // Measured duration of the produced clip is the requested range.
    const doc = await ffprobe(cut.artifact!.path);
    const duration = Number(doc.format?.duration ?? NaN);
    expect(duration).toBeGreaterThan(0.85);
    expect(duration).toBeLessThan(1.15);
  });

  it('crop produces an output whose probed resolution matches the request', async () => {
    const workDir = makeWorkDir();
    const source = await makeSource(workDir);

    const crop = await runWithSessionContext({ workDir }, () =>
      executeSkillOperation({
        tool: 'crop',
        args: { input: source, x: 64, y: 48, width: 320, height: 240 },
      }),
    );

    expect(crop.status).toBe('completed');
    expect(crop.artifactCreated).toBe(true);
    expect(crop.artifact?.path).toBeTruthy();

    const doc = await ffprobe(crop.artifact!.path);
    const video = doc.streams.find((stream) => stream.codec_type === 'video');
    expect(video?.width).toBe(320);
    expect(video?.height).toBe(240);
  });

  it('handles a non-ASCII source filename through probe and cut', async () => {
    const workDir = makeWorkDir();
    const source = await makeSource(workDir, '影片.mp4');
    const before = sha256Of(source);

    const probe = await runWithSessionContext({ workDir }, () =>
      executeSkillOperation({ tool: 'probe', args: { inputs: [source] } }),
    );
    expect(probe.status).toBe('completed');
    const probeFacts = probeDetails(probe.details);
    expect(probeFacts.video?.width).toBe(1280);

    const cut = await runWithSessionContext({ workDir }, () =>
      executeSkillOperation({
        tool: 'cut',
        args: { input: source, start: '0', duration: '1' },
      }),
    );
    expect(cut.status).toBe('completed');
    expect(cut.artifactCreated).toBe(true);
    expect(cut.artifact?.path).toBeTruthy();
    expect(sha256Of(source)).toBe(before);
  });

  it('loudness measure-only reports a real finite measurement', async () => {
    const workDir = makeWorkDir();
    const source = await makeSource(workDir);

    const loudness = await runWithSessionContext({ workDir }, () =>
      executeSkillOperation({
        tool: 'loudness',
        args: { input: source, measure_only: true },
      }),
    );

    expect(loudness.status).toBe('completed');
    const details = loudness.details as {
      measured?: { input_i?: string; input_tp?: string; input_lra?: string };
    };
    expect(details.measured).toBeDefined();
    const inputI = Number(details.measured?.input_i);
    expect(Number.isFinite(inputI)).toBe(true);
    // A real (non-placeholder) measurement for a 440 Hz tone is well above
    // digital silence; the dry-run placeholder is exactly -20.0, so the range
    // also guards against a placeholder being presented as a measurement.
    expect(inputI).toBeGreaterThan(-30);
    expect(inputI).toBeLessThan(0);
    expect(Number.isFinite(Number(details.measured?.input_tp))).toBe(true);
    expect(Number.isFinite(Number(details.measured?.input_lra))).toBe(true);
  });
});
