/**
 * Managed FFmpeg skill colour conversion.
 *
 * A BT.601 (`smpte170m` / `bt470bg`) source re-encoded through the managed
 * caller used to come out labelled BT.709 over BT.601 pixels: the vendored
 * encoder line tags its output BT.709, and nothing converted the matrix.
 * Measured through FFmpeg 9.0.2 on a pure-red source, pure red decoded as
 * (255, 24, 0) instead of (254, 0, 0). These cases drive the real
 * `executeSkillOperation` runner (no mocks) and compare the decoded pixels of
 * the output with the decoded pixels of the source.
 *
 * The suite is skipped when `detectBinaries()` cannot find ffmpeg/ffprobe, so
 * a host without FFmpeg never fails. The clips are one second long.
 */
import { spawn } from 'node:child_process';
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
    mkdtempSync(path.join(tmpdir(), 'neumar-ffmpeg-color-')),
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
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
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

/** One decoded RGB pixel of the first frame, at the centre of a solid clip. */
async function centrePixel(
  workDir: string,
  file: string,
  width: number,
  height: number,
): Promise<[number, number, number]> {
  const raw = path.join(workDir, `${path.basename(file)}.rgb`);
  await ffmpeg([
    '-y',
    '-i',
    file,
    '-frames:v',
    '1',
    '-f',
    'rawvideo',
    '-pix_fmt',
    'rgb24',
    raw,
  ]);
  const bytes = readFileSync(raw);
  const index = (Math.floor(height / 2) * width + Math.floor(width / 2)) * 3;
  return [
    byteAt(bytes, index),
    byteAt(bytes, index + 1),
    byteAt(bytes, index + 2),
  ];
}

function byteAt(bytes: Buffer, index: number): number {
  const value = bytes[index];
  if (value === undefined) {
    throw new Error(`decoded frame is shorter than ${index + 1} bytes`);
  }
  return value;
}

/**
 * A solid-red clip whose pixels are encoded with `matrix` (and `range`), then
 * tagged with the matching ffprobe names so a player decodes it the way it
 * was encoded.
 */
async function makeSolid(
  workDir: string,
  name: string,
  matrix: 'bt709' | 'smpte170m',
  range: 'tv' | 'pc' = 'tv',
): Promise<string> {
  const file = path.join(workDir, name);
  const fullRange = range === 'pc';
  await ffmpeg([
    '-y',
    '-f',
    'lavfi',
    '-i',
    'color=c=red:s=320x240:r=25:d=1',
    '-vf',
    `scale=out_color_matrix=${matrix}:out_range=${range},format=${fullRange ? 'yuvj420p' : 'yuv420p'}`,
    '-colorspace',
    matrix,
    '-color_primaries',
    matrix,
    '-color_trc',
    matrix,
    '-color_range',
    range,
    '-c:v',
    'libx264',
    '-crf',
    '10',
    '-g',
    '1',
    file,
  ]);
  return file;
}

function closeTo(
  actual: [number, number, number],
  expected: [number, number, number],
  tolerance = 3,
): boolean {
  return actual.every(
    (value, i) => Math.abs(value - (expected[i] ?? Number.NaN)) <= tolerance,
  );
}

mediaDescribe('managed FFmpeg skill colour conversion', () => {
  it('converts a BT.601 source to the BT.709 its re-encode is tagged with', async () => {
    const workDir = makeWorkDir();
    const source = await makeSolid(workDir, 'bt601.mp4', 'smpte170m');
    const sourcePixel = await centrePixel(workDir, source, 320, 240);

    const crop = await runWithSessionContext({ workDir }, () =>
      executeSkillOperation({
        tool: 'crop',
        args: { input: source, x: 0, y: 0, width: 320, height: 240 },
      }),
    );

    expect(crop.status).toBe('completed');
    expect(crop.artifact?.path).toBeTruthy();
    const outputPixel = await centrePixel(
      workDir,
      crop.artifact!.path,
      320,
      240,
    );
    // The source decodes as near-pure red. Before the fix the managed re-encode
    // came back as (255, 24, 0): BT.601 pixels labelled BT.709.
    const [red, green] = sourcePixel;
    expect(red).toBeGreaterThan(240);
    expect(green).toBeLessThan(10);
    expect(closeTo(outputPixel, sourcePixel)).toBe(true);
  });

  it('converts a BT.470BG full-range source through the export preset', async () => {
    const workDir = makeWorkDir();
    const source = await makeSolid(workDir, 'bt470bg.mp4', 'smpte170m', 'pc');
    const sourcePixel = await centrePixel(workDir, source, 320, 240);

    const exported = await runWithSessionContext({ workDir }, () =>
      executeSkillOperation({
        tool: 'export',
        args: { input: source, preset: 'youtube', no_scale: true },
      }),
    );

    expect(exported.status).toBe('completed');
    expect(exported.artifact?.path).toBeTruthy();
    const outputPixel = await centrePixel(
      workDir,
      exported.artifact!.path,
      320,
      240,
    );
    expect(closeTo(outputPixel, sourcePixel)).toBe(true);
  });

  it('leaves a BT.709 source unchanged', async () => {
    const workDir = makeWorkDir();
    const source = await makeSolid(workDir, 'bt709.mp4', 'bt709');
    const sourcePixel = await centrePixel(workDir, source, 320, 240);

    const crop = await runWithSessionContext({ workDir }, () =>
      executeSkillOperation({
        tool: 'crop',
        args: { input: source, x: 0, y: 0, width: 320, height: 240 },
      }),
    );

    expect(crop.status).toBe('completed');
    const outputPixel = await centrePixel(
      workDir,
      crop.artifact!.path,
      320,
      240,
    );
    // A BT.709 source must not be treated as BT.601: the conversion is skipped.
    expect(closeTo(outputPixel, sourcePixel)).toBe(true);
  });
});
