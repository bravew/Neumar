import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createFfmpegSkillMcpServer,
  FFMPEG_SKILL_TOOL_NAMES,
  ffmpegSkillTools,
} from '@/shared/mcp/ffmpeg-skill-server';
import { detectBinaries } from '@/shared/services/ffmpeg';
import { clearFfmpegContractCache } from '@/shared/services/ffmpeg-skill/contract';
import { clearSkillRuntimeCache } from '@/shared/services/ffmpeg-skill/runtime';
import { runWithSessionContext } from '@/shared/services/session-context';

const tempDirs: string[] = [];

function makeDir(prefix: string): string {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), prefix)));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  clearFfmpegContractCache();
  clearSkillRuntimeCache();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function textOf(result: {
  content: Array<{ type: string; text?: string }>;
}): string {
  return result.content.map((entry) => entry.text ?? '').join('\n');
}

describe('ffmpeg skill MCP server', () => {
  it('exposes exactly the three managed tools under the hyphenated name', () => {
    const server = createFfmpegSkillMcpServer();
    expect(server.name).toBe('ffmpeg-skill');
    expect(FFMPEG_SKILL_TOOL_NAMES).toEqual([
      'ffmpeg_skill_catalog',
      'ffmpeg_skill_check',
      'ffmpeg_skill_execute',
    ]);
    expect(ffmpegSkillTools.map((entry) => entry.name)).toEqual(
      FFMPEG_SKILL_TOOL_NAMES,
    );
  });

  it('catalog lists tools without embedding their schemas', async () => {
    const catalog = ffmpegSkillTools.find(
      (entry) => entry.name === 'ffmpeg_skill_catalog',
    );
    const result = await catalog!.handler({} as never, {});
    const body = JSON.parse(textOf(result)) as {
      tools: Array<{ name: string; id: string; arguments: string[] }>;
    };
    expect(body.tools).toHaveLength(42);
    const cut = body.tools.find((entry) => entry.name === 'cut');
    expect(cut?.id).toBe('ffmpeg-skill/cut');
    expect(cut?.arguments).toContain('input');
    expect(JSON.stringify(body)).not.toContain('additionalProperties');
  });

  it('check reports installed interpreters or an actionable gap', async () => {
    const check = ffmpegSkillTools.find(
      (entry) => entry.name === 'ffmpeg_skill_check',
    );
    const result = await check!.handler({} as never, {});
    const body = JSON.parse(textOf(result)) as {
      python: { available: boolean; action?: string };
      ready: boolean;
    };
    expect(typeof body.python.available).toBe('boolean');
    if (!body.python.available) {
      expect(body.python.action).toMatch(/Python/);
    }
  });

  it('execute rejects raw argv and does not touch the workspace', async () => {
    const workspace = makeDir('neuma-skill-mcp-');
    writeFileSync(path.join(workspace, 'in.mp4'), 'source');
    const execute = ffmpegSkillTools.find(
      (entry) => entry.name === 'ffmpeg_skill_execute',
    );
    const result = await runWithSessionContext({ workDir: workspace }, () =>
      execute!.handler(
        { tool: 'cut', args: { argv: ['-y', '-i', 'in.mp4'] } } as never,
        {},
      ),
    );
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/raw argv/);
  });

  it.each([
    [
      'a NaN number',
      { tool: 'cut', args: { input: 'in.mp4', start: '0', timeout: NaN } },
      /cut\.timeout must be a finite number/,
    ],
    [
      'an Infinity number',
      {
        tool: 'cut',
        args: { input: 'in.mp4', start: '0', timeout: Infinity },
      },
      /cut\.timeout must be a finite number/,
    ],
    [
      'arguments that are not an object',
      { tool: 'cut', args: ['in.mp4'] },
      /cut arguments must be an object/,
    ],
    [
      'an array holding a non-string',
      {
        tool: 'broll',
        args: { input: 'in.mp4', insert: ['x'], duration: [1] },
      },
      /broll\.duration must be an array of strings/,
    ],
  ])(
    'execute refuses %s before the payload runs',
    async (_label, input, message) => {
      const workspace = makeDir('neuma-skill-mcp-args-');
      writeFileSync(path.join(workspace, 'in.mp4'), 'source');
      const result = await runWithSessionContext({ workDir: workspace }, () =>
        executeTool()(input as never, {}),
      );
      expect(result.isError).toBe(true);
      expect(textOf(result)).toMatch(message);
      expect(readdirSync(workspace)).toEqual(['in.mp4']);
    },
  );
});

function executeTool() {
  const execute = ffmpegSkillTools.find(
    (entry) => entry.name === 'ffmpeg_skill_execute',
  );
  if (!execute) throw new Error('ffmpeg_skill_execute is not registered');
  return execute.handler;
}

const binaries = detectBinaries();
const mediaDescribe =
  binaries?.ffmpegPath && binaries.ffprobePath ? describe : describe.skip;

mediaDescribe('ffmpeg skill MCP server time arguments', () => {
  function makeClip(workspace: string): void {
    const ffmpeg = binaries?.ffmpegPath;
    if (!ffmpeg) throw new Error('ffmpeg not detected');
    const made = spawnSync(ffmpeg, [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=160x120:rate=25:duration=2',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      path.join(workspace, 'in.mp4'),
    ]);
    if (made.status !== 0) throw new Error(String(made.stderr));
  }

  // Before the fix, `start: "nan"` reached ffmpeg (kind: ffmpeg), `duration:
  // "inf"` and `"1e999"` exited 0 with nothing published, `loop` raised a
  // traceback, and an `@nan` rate failed on the interpreter's own message.
  it.each([
    ['a nan start', 'cut', { start: 'nan', duration: '1' }, '--start'],
    ['an inf duration', 'cut', { start: '0', duration: 'inf' }, '--duration'],
    [
      'a 1e999 duration',
      'cut',
      { start: '0', duration: '1e999' },
      '--duration',
    ],
    [
      'an @nan timecode rate',
      'cut',
      { start: '00:00:00:00@nan', duration: '1' },
      '--start',
    ],
    ['a nan loop duration', 'loop', { duration: 'nan' }, '--duration'],
  ])(
    'execute refuses %s as an input error',
    async (_label, tool, args, flag) => {
      const workspace = makeDir('neuma-skill-mcp-time-');
      makeClip(workspace);
      const result = await runWithSessionContext({ workDir: workspace }, () =>
        executeTool()(
          { tool, args: { input: 'in.mp4', ...args } } as never,
          {},
        ),
      );
      expect(result.isError).toBe(true);
      const body = JSON.parse(textOf(result)) as {
        artifactCreated: boolean;
        details: { error?: { kind?: string; message?: string } } | null;
      };
      expect(body.artifactCreated).toBe(false);
      expect(body.details?.error?.kind).toBe('input');
      expect(body.details?.error?.message).toContain(flag);
      expect(body.details?.error?.message).toMatch(/finite/);
      expect(readdirSync(workspace)).toEqual(['in.mp4']);
      expect(existsSync(path.join(workspace, 'output'))).toBe(false);
    },
  );
});
