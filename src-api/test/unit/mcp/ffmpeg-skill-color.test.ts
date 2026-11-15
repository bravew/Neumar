/**
 * Managed FFmpeg skill colour conversion.
 *
 * A BT.601 (`smpte170m` / `bt470bg`) source re-encoded through the managed
 * caller used to come out labelled BT.709 over BT.601 pixels: the vendored
 * encoder line tags its output BT.709, and nothing converted the matrix.
 * Measured through FFmpeg 9.0.2 on a pure-red source, pure red decoded as
 * (255, 24, 0) instead of (254, 0, 0). These cases drive the real
 * `executeSkillOperation` runner (no mocks) and compare the decoded pixels of
 * the output with the decoded pixels of the source. Odd-sized sources are not
 * converted (the `colorspace` filter rejects their geometry before the tool's
 * own filter can correct it), so those cases assert completion and dimensions.
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
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    let stderr = '';
    child.stderr.setEncoding('utf8');
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
 * `scale`'s `out_color_matrix` values (the libavutil AVColorSpace numbers, which
 * FFmpeg 9.0.2's `ffmpeg -h filter=scale` lists as `bt601 5`, `bt470 5`,
 * `bt470bg 5`, `bt709 1`). The filter option is given numerically because
 * FFmpeg 8.0.1, which CI runs, rejects the name `bt470bg` there with
 * `Unable to parse option value "bt470bg"`; 9.0.2 accepts both. The numeric
 * enum is stable across both versions. FFmpeg 8.0.1 could not be run locally.
 */
const MATRIX_VALUE = {
  bt709: 1,
  smpte170m: 5,
  bt470bg: 5,
} as const;

/**
 * A solid-red clip whose pixels are encoded with `matrix` (and `range`), then
 * tagged with the matching ffprobe names so a player decodes it the way it
 * was encoded.
 */
async function makeSolid(
  workDir: string,
  name: string,
  matrix: 'bt709' | 'smpte170m' | 'bt470bg',
  range: 'tv' | 'pc' = 'tv',
): Promise<string> {
  const file = path.join(workDir, name);
  const fullRange = range === 'pc';
  // `bt470bg` names a matrix (and a primaries value) but not a transfer
  // characteristic: FFmpeg 8.0.1's libx264 rejects `-color_trc bt470bg` with
  // "Error setting option color_trc to value bt470bg", while 9.0.2 happens to
  // accept it as an alias for gamma28. The transfer does not affect the matrix
  // conversion under test, so tag a valid one instead.
  const transfer = matrix === 'bt470bg' ? 'bt709' : matrix;
  await ffmpeg([
    '-y',
    '-f',
    'lavfi',
    '-i',
    'color=c=red:s=320x240:r=25:d=1',
    '-vf',
    `scale=out_color_matrix=${MATRIX_VALUE[matrix]}:out_range=${range},format=${fullRange ? 'yuvj420p' : 'yuv420p'}`,
    '-colorspace',
    matrix,
    '-color_primaries',
    matrix,
    '-color_trc',
    transfer,
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

/**
 * An odd-sized clip encoded and tagged `smpte170m` (H.264 yuv444p or VP9
 * yuv420p). The tool's crop produces even output from either; the source frame
 * itself is the odd one the conversion must not see first.
 */
async function makeOddSize(
  workDir: string,
  name: string,
  width: number,
  height: number,
  codec: 'libx264' | 'libvpx-vp9',
  pixFmt: 'yuv444p' | 'yuv420p',
): Promise<string> {
  const file = path.join(workDir, name);
  await ffmpeg([
    '-y',
    '-f',
    'lavfi',
    '-i',
    `color=c=red:s=${width}x${height}:r=25:d=1`,
    '-vf',
    `scale=out_color_matrix=${MATRIX_VALUE.smpte170m}:out_range=tv,format=${pixFmt}`,
    '-colorspace',
    'smpte170m',
    '-color_primaries',
    'smpte170m',
    '-color_trc',
    'smpte170m',
    '-c:v',
    codec,
    '-crf',
    '10',
    '-g',
    '1',
    file,
  ]);
  return file;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** `width`x`height` of the first video stream, read from ffprobe's JSON. */
async function videoSize(
  file: string,
): Promise<{ width: number; height: number }> {
  if (!binaries?.ffprobePath) throw new Error('ffprobe not detected');
  const { code, stdout, stderr } = await runProcess(binaries.ffprobePath, [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=width,height',
    '-of',
    'json',
    file,
  ]);
  if (code !== 0) {
    throw new Error(`ffprobe ${file} exited ${code}: ${stderr}`);
  }
  const parsed: unknown = JSON.parse(stdout);
  const stream =
    isRecord(parsed) && Array.isArray(parsed.streams)
      ? parsed.streams[0]
      : undefined;
  if (
    !isRecord(stream) ||
    typeof stream.width !== 'number' ||
    typeof stream.height !== 'number'
  ) {
    throw new Error(`ffprobe ${file} reported no video size`);
  }
  return { width: stream.width, height: stream.height };
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
    const source = await makeSolid(workDir, 'bt470bg.mp4', 'bt470bg', 'pc');
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

  it('crops a BT.601 4:4:4 source with odd dimensions without converting it', async () => {
    const workDir = makeWorkDir();
    const source = await makeOddSize(
      workDir,
      'bt601-odd-444.mp4',
      321,
      241,
      'libx264',
      'yuv444p',
    );

    const crop = await runWithSessionContext({ workDir }, () =>
      executeSkillOperation({
        tool: 'crop',
        args: { input: source, x: 0, y: 0, width: 320, height: 240 },
      }),
    );

    // Odd-sized sources are not converted: `colorspace` rejects an odd frame
    // with "Invalid odd size (321x241)" before the tool's own filter can make it
    // even, so the base behaviour is kept. The crop itself still completes; the
    // output pixels keep the source matrix under the BT.709 tags (the documented,
    // unfixed case), so this asserts the geometry, not the colour.
    expect(crop.status).toBe('completed');
    expect(crop.artifact?.path).toBeTruthy();
    expect(await videoSize(crop.artifact!.path)).toEqual({
      width: 320,
      height: 240,
    });
  });

  it('crops a BT.601 VP9 source with odd dimensions without converting it', async () => {
    const workDir = makeWorkDir();
    const source = await makeOddSize(
      workDir,
      'bt601-odd-vp9.mp4',
      641,
      359,
      'libvpx-vp9',
      'yuv420p',
    );

    const crop = await runWithSessionContext({ workDir }, () =>
      executeSkillOperation({
        tool: 'crop',
        args: { input: source, x: 0, y: 0, width: 640, height: 358 },
      }),
    );

    // As above: an odd source is not converted, so the command is the base one.
    expect(crop.status).toBe('completed');
    expect(crop.artifact?.path).toBeTruthy();
    expect(await videoSize(crop.artifact!.path)).toEqual({
      width: 640,
      height: 358,
    });
  });

  it('reverses a BT.601 source with odd dimensions without converting it', async () => {
    const workDir = makeWorkDir();
    const source = await makeOddSize(
      workDir,
      'bt601-odd-reverse.mp4',
      321,
      241,
      'libx264',
      'yuv444p',
    );

    const reversed = await runWithSessionContext({ workDir }, () =>
      executeSkillOperation({
        tool: 'reverse',
        args: { input: source },
      }),
    );

    // reverse's `-vf reverse` does not change the frame size, so a conversion
    // appended to it saw the odd source and failed with "Invalid odd size
    // (321x241)" before the even-dimension retry could run. Odd sources are not
    // converted; the retry still scales the picture to even, as it did at base.
    expect(reversed.status).toBe('completed');
    expect(reversed.artifact?.path).toBeTruthy();
    expect(await videoSize(reversed.artifact!.path)).toEqual({
      width: 320,
      height: 240,
    });
  });

  it('joins an odd-size BT.601 first input without converting it', async () => {
    const workDir = makeWorkDir();
    const first = await makeOddSize(
      workDir,
      'bt601-odd-join-a.mp4',
      321,
      241,
      'libx264',
      'yuv444p',
    );
    const second = await makeOddSize(
      workDir,
      'bt601-odd-join-b.mp4',
      321,
      241,
      'libx264',
      'yuv444p',
    );

    const joined = await runWithSessionContext({ workDir }, () =>
      executeSkillOperation({
        tool: 'join',
        args: { inputs: [first, second], transition: 'none' },
      }),
    );

    // join's `-filter_complex` starts from `[0:v]`; a conversion prepended there
    // saw the odd first input before the graph's own scale and failed. Odd
    // sources are not converted, so the graph is the base one and completes.
    expect(joined.status).toBe('completed');
    expect(joined.artifact?.path).toBeTruthy();
    expect(await videoSize(joined.artifact!.path)).toEqual({
      width: 320,
      height: 240,
    });
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
