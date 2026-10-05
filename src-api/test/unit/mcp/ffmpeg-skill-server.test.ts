import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createFfmpegSkillMcpServer,
  FFMPEG_SKILL_TOOL_NAMES,
  ffmpegSkillTools,
} from '@/shared/mcp/ffmpeg-skill-server';
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
});
