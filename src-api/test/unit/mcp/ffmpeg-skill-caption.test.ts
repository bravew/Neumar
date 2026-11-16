/**
 * Managed FFmpeg skill caption layout, timing and markup.
 *
 * These cases drive the real `executeSkillOperation` runner (no mocks) against
 * the vendored `caption.py`, with small synthetic clips and cue files:
 *
 *   - the SRT burn passes libass the legacy SSA `Alignment` values force_style
 *     reads, not the v4+ numpad values a generated Style line uses;
 *   - an SRT timing ffmpeg reads differently from this tool (`00:00:01,5` is
 *     1.5 s here and 1.005 s to ffmpeg) is rewritten before ffmpeg sees it;
 *   - an SRT timing ffmpeg rejects (`00:01,000`, no hours) is rewritten too;
 *   - `--text` does not read the English word "to" as a cue separator, and a
 *     line separator such as U+2028 does not split one cue into two;
 *   - SRT markup (`<i>`, `<font color>`, `{\anN}`) is measured and drawn as
 *     markup on the routes that generate their own ASS, not as literal text;
 *   - karaoke energy timing counts a sound that starts late from the file's
 *     clock instead of from its first sample.
 *
 * The suite is skipped when `detectBinaries()` cannot find ffmpeg/ffprobe.
 * This host's FFmpeg 9.0.2 build has no libass, so the two cases that need a
 * generated ASS install a thin wrapper around the real ffmpeg that substitutes
 * the unavailable `ass=`/`subtitles=` filter with `null`. The caption tool
 * still writes the ASS the wrapper test reads; only the pixel render is
 * skipped. The alignment case runs under `--dry-run` and inspects the command
 * the tool would execute.
 */
import { spawn } from 'node:child_process';
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { clearBinaryCache, detectBinaries } from '@/shared/services/ffmpeg';
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
  clearBinaryCache();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeWorkDir(prefix = 'neumar-ffmpeg-caption-'): string {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), prefix)));
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

async function makeClip(
  workDir: string,
  name: string,
  options: { duration?: number; audioOffset?: number } = {},
): Promise<string> {
  const file = path.join(workDir, name);
  const duration = options.duration ?? 3;
  const args = [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    `color=c=black:s=320x240:r=25:d=${duration}`,
  ];
  if (options.audioOffset !== undefined) {
    args.push(
      '-itsoffset',
      String(options.audioOffset),
      '-f',
      'lavfi',
      '-i',
      `sine=frequency=440:duration=${Math.max(duration - options.audioOffset, 0.1)}`,
      '-map',
      '0:v:0',
      '-map',
      '1:a:0',
      '-c:a',
      'aac',
      '-shortest',
    );
  }
  args.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p', file);
  await ffmpeg(args);
  return file;
}

function writeCueFile(workDir: string, name: string, body: string): string {
  const file = path.join(workDir, name);
  writeFileSync(file, body, 'utf8');
  return file;
}

function runCaption(
  workDir: string,
  args: Record<string, unknown>,
): Promise<SkillOperationResult> {
  return runWithSessionContext({ workDir }, () =>
    executeSkillOperation({ tool: 'caption', args }),
  );
}

function commandsOf(result: SkillOperationResult): string[] {
  const details = result.details as { commands?: unknown } | null;
  if (!details || !Array.isArray(details.commands)) return [];
  return details.commands.filter(
    (entry): entry is string => typeof entry === 'string',
  );
}

interface Packet {
  pts_time?: string;
}

async function subtitlePackets(file: string): Promise<Packet[]> {
  const { code, stdout, stderr } = await runProcess(ffprobeBin(), [
    '-v',
    'error',
    '-select_streams',
    's:0',
    '-show_entries',
    'packet=pts_time',
    '-of',
    'json',
    file,
  ]);
  if (code !== 0) {
    throw new Error(`ffprobe ${file} exited ${code}: ${stderr}`);
  }
  const parsed = JSON.parse(stdout) as { packets?: Packet[] };
  return parsed.packets ?? [];
}

async function subtitleText(file: string): Promise<string> {
  const { code, stdout, stderr } = await runProcess(ffmpegBin(), [
    '-v',
    'error',
    '-i',
    file,
    '-map',
    '0:s:0',
    '-f',
    'srt',
    '-',
  ]);
  if (code !== 0) {
    throw new Error(`ffmpeg subtitle extract exited ${code}: ${stderr}`);
  }
  return stdout;
}

function firstPts(packets: Packet[]): number {
  const value = packets[0]?.pts_time;
  if (value === undefined) throw new Error('subtitle stream has no packets');
  return Number(value);
}

/**
 * Run `fn` with `FFMPEG_PATH` pointing at a wrapper around the real binary.
 *
 * The wrapper replaces the `-vf` value of a caption burn (`ass=...` or
 * `subtitles=...`) with `null` and delegates everything else to the real
 * ffmpeg. It exists because this host's build has no libass; the ASS the
 * caption tool writes before the render is what the caller test asserts.
 */
async function withFfmpegWrapper<T>(fn: () => Promise<T>): Promise<T> {
  const dir = makeWorkDir('neumar-ffmpeg-caption-wrapper-');
  const wrapper = path.join(dir, 'ffmpeg');
  const real = ffmpegBin();
  const script = `#!/usr/bin/env python3
import os, sys
REAL = ${JSON.stringify(real)}
args = sys.argv[1:]
out = []
i = 0
while i < len(args):
    if args[i] in ("-vf", "-filter_complex") and i + 1 < len(args):
        value = args[i + 1]
        if value.startswith("ass=") or value.startswith("subtitles="):
            out.extend([args[i], "null"])
        else:
            out.extend([args[i], value])
        i += 2
    else:
        out.append(args[i])
        i += 1
os.execv(REAL, [REAL] + out)
`;
  writeFileSync(wrapper, script, 'utf8');
  chmodSync(wrapper, 0o755);

  const keys = [
    'NEUMA_FFMPEG_PATH',
    'FFMPEG_PATH',
    'NEUMA_FFPROBE_PATH',
    'FFPROBE_PATH',
  ] as const;
  const saved = new Map<string, string | undefined>(
    keys.map((key) => [key, process.env[key]]),
  );
  process.env.NEUMA_FFMPEG_PATH = wrapper;
  process.env.NEUMA_FFPROBE_PATH = ffprobeBin();
  delete process.env.FFMPEG_PATH;
  delete process.env.FFPROBE_PATH;
  clearBinaryCache();
  clearSkillRuntimeCache();
  try {
    return await fn();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    clearBinaryCache();
    clearSkillRuntimeCache();
  }
}

/** The generated ASS path the caption tool logs before it renders. */
function assPathFromStderr(stderr: string): string {
  const match = /wrote (.+?\.ass) \(/i.exec(stderr);
  if (!match?.[1]) {
    throw new Error(`no generated ASS path in stderr:\n${stderr}`);
  }
  return match[1];
}

function readAss(stderr: string): string {
  const file = assPathFromStderr(stderr);
  try {
    return readFileSync(file, 'utf8');
  } finally {
    rmSync(path.dirname(file), { recursive: true, force: true });
  }
}

function dialogueLines(ass: string): string[] {
  return ass
    .split('\n')
    .filter((line) => line.startsWith('Dialogue:'))
    .map((line) => line.slice(line.indexOf(',,') + 2));
}

mediaDescribe('managed FFmpeg skill caption layout and timing', () => {
  it('maps --position to the legacy SSA alignment force_style reads', async () => {
    const workDir = makeWorkDir();
    const source = await makeClip(workDir, 'base.mp4', { duration: 1 });
    const srt = writeCueFile(
      workDir,
      'cue.srt',
      '1\n00:00:00,000 --> 00:00:01,000\nHello\n\n',
    );
    // libass reads a force_style Alignment in the legacy SSA numbering (1-3
    // bottom, 5-7 top, 9-11 middle), while a v4+ Style line uses the numpad
    // numbering. The two agree only on the bottom row.
    const expected: Record<string, number> = {
      bottom: 2,
      'bottom-left': 1,
      'bottom-right': 3,
      center: 10,
      top: 6,
      'top-left': 5,
      'top-right': 7,
    };
    for (const [position, alignment] of Object.entries(expected)) {
      const result = await runCaption(workDir, {
        input: source,
        srt,
        position,
        dry_run: true,
        size: 24,
        font: 'DejaVu Sans',
      });
      expect(result.status).toBe('completed');
      const command = commandsOf(result).find((entry) =>
        entry.includes('force_style='),
      );
      expect(command, `${position}: no force_style command`).toBeTruthy();
      expect(command).toContain(`Alignment=${alignment}`);
    }
  });

  it('rewrites an SRT timing ffmpeg reads differently from this tool', async () => {
    const workDir = makeWorkDir();
    const source = await makeClip(workDir, 'base.mp4');
    // parse_time() reads `01,5` as 1.5 s; ffmpeg's SRT reader reads it as
    // 1.005 s. The cue lasts exactly --min-duration, so the layout changes
    // nothing and ffmpeg used to receive the caller's file unchanged.
    const srt = writeCueFile(
      workDir,
      'short-ms.srt',
      '1\n00:00:01,5 --> 00:00:02,500\nShort\n\n',
    );
    const result = await runCaption(workDir, {
      input: source,
      srt,
      mode: 'mux',
      output: path.join(workDir, 'short-ms.mkv'),
    });
    expect(result.status).toBe('completed');
    expect(result.artifact?.path).toBeTruthy();
    const packets = await subtitlePackets(result.artifact!.path);
    expect(firstPts(packets)).toBeCloseTo(1.5, 1);
  });

  it('rewrites an SRT timing ffmpeg rejects', async () => {
    const workDir = makeWorkDir();
    const source = await makeClip(workDir, 'base.mp4');
    // ffmpeg's SRT demuxer refuses a time without hours; parse_time() reads
    // `00:01,000` as 1.0 s. The rewritten copy is what ffmpeg gets.
    const srt = writeCueFile(
      workDir,
      'no-hours.srt',
      '1\n00:01,000 --> 00:02,500\nShort\n\n',
    );
    const result = await runCaption(workDir, {
      input: source,
      srt,
      mode: 'mux',
      output: path.join(workDir, 'no-hours.mkv'),
    });
    expect(result.status).toBe('completed');
    expect(result.artifact?.path).toBeTruthy();
    const packets = await subtitlePackets(result.artifact!.path);
    expect(firstPts(packets)).toBeCloseTo(1.0, 1);
  });

  it('does not read the English word "to" as a cue separator', async () => {
    const workDir = makeWorkDir();
    const source = await makeClip(workDir, 'base.mp4');
    const text = writeCueFile(workDir, 'cues.txt', '3 to 5 apples\n');
    const result = await runCaption(workDir, {
      input: source,
      text,
      mode: 'mux',
      output: path.join(workDir, 'to.mkv'),
    });
    expect(result.status).toBe('completed');
    expect(result.artifact?.path).toBeTruthy();
    const packets = await subtitlePackets(result.artifact!.path);
    // With "to" read as a separator this became a 3-5 s cue saying "apples".
    expect(firstPts(packets)).toBeCloseTo(0, 1);
    expect(await subtitleText(result.artifact!.path)).toContain(
      '3 to 5 apples',
    );
  });

  it('keeps a U+2028 line separator inside one cue', async () => {
    const workDir = makeWorkDir();
    const source = await makeClip(workDir, 'base.mp4');
    // Python's str.splitlines() also breaks at U+2028, which made the rest of
    // the line an auto-timed cue of its own.
    const text = writeCueFile(workDir, 'cues.txt', 'Hello World\n');
    const result = await runCaption(workDir, {
      input: source,
      text,
      mode: 'mux',
      output: path.join(workDir, 'u2028.mkv'),
    });
    expect(result.status).toBe('completed');
    expect(result.artifact?.path).toBeTruthy();
    const packets = await subtitlePackets(result.artifact!.path);
    expect(packets).toHaveLength(1);
    const subtitle = await subtitleText(result.artifact!.path);
    expect(subtitle).toContain('Hello');
    expect(subtitle).toContain('World');
    expect(subtitle.split('-->')).toHaveLength(2);
  });

  it('draws SRT markup as markup in a generated ASS', async () => {
    const workDir = makeWorkDir();
    const source = await makeClip(workDir, 'base.mp4');
    const srt = writeCueFile(
      workDir,
      'markup.srt',
      '1\n00:00:00,000 --> 00:00:02,000\n<i>Hello</i> <font color="#ffff00">world</font> {\\an8}\n\n',
    );
    const result = await withFfmpegWrapper(() =>
      runCaption(workDir, {
        input: source,
        srt,
        animate: 'fade',
        write_ass: path.join(workDir, 'markup.ass'),
        output: path.join(workDir, 'markup.mp4'),
        size: 24,
        font: 'DejaVu Sans',
      }),
    );
    expect(result.status).toBe('completed');
    const ass = readAss(result.stderr);
    const dialogues = dialogueLines(ass);
    // The tags were measured as width and sliced at the column edge, so this
    // cue used to be split into two Dialogue events.
    expect(dialogues).toHaveLength(1);
    expect(dialogues[0]).toContain('{\\i1}Hello{\\i0}');
    expect(dialogues[0]).toContain('{\\c&H00FFFF&}world{\\c}');
    expect(dialogues[0]).toContain('{\\an8}');
    expect(dialogues[0]).not.toContain('<i>');
    expect(dialogues[0]).not.toContain('<font');
  });

  it('counts a late-starting sound from the file clock in karaoke timing', async () => {
    const workDir = makeWorkDir();
    // The audio stream starts 0.5 s into the file. Without first_pts=0 the
    // energy analysis starts at the first audio sample, so the first word's
    // share loses the delay and can come out shorter than the second word's.
    const source = await makeClip(workDir, 'delayed.mp4', {
      duration: 2,
      audioOffset: 0.5,
    });
    const srt = writeCueFile(
      workDir,
      'cue.srt',
      '1\n00:00:00,000 --> 00:00:02,000\none two\n\n',
    );
    const result = await withFfmpegWrapper(() =>
      runCaption(workDir, {
        input: source,
        srt,
        karaoke: true,
        karaoke_timing: 'energy',
        write_ass: path.join(workDir, 'karaoke.ass'),
        output: path.join(workDir, 'karaoke.mp4'),
        size: 24,
        font: 'DejaVu Sans',
      }),
    );
    expect(result.status).toBe('completed');
    const ass = readAss(result.stderr);
    const durations = [...ass.matchAll(/\{\\kf(\d+)\}/g)].map((match) =>
      Number(match[1]),
    );
    expect(durations).toHaveLength(2);
    // The first word spans the late start and the first word; the second word
    // is only its own span. Before the fix the 0.5 s delay was dropped and the
    // first word got the smaller share.
    expect(durations[0]).toBeGreaterThan(durations[1] ?? Number.NaN);
  });
});
