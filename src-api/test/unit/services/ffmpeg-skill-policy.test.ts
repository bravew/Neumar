import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { prepareArgs } from '@/shared/services/ffmpeg-skill/argv';
import {
  clearFfmpegContractCache,
  loadFfmpegContract,
} from '@/shared/services/ffmpeg-skill/contract';
import { FfmpegSkillError } from '@/shared/services/ffmpeg-skill/errors';
import {
  authorizeOperation,
  manifestReferences,
  pathArgumentsFor,
} from '@/shared/services/ffmpeg-skill/policy';
import { runWithSessionContext } from '@/shared/services/session-context';

const tempDirs: string[] = [];

function makeDir(prefix: string): string {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), prefix)));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  clearFfmpegContractCache();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

async function tool(name: string) {
  const loaded = await loadFfmpegContract();
  const found = loaded.tools.get(name);
  if (!found) throw new Error(`missing contract tool ${name}`);
  return found;
}

describe('ffmpeg skill argument contract', () => {
  it('loads the closed 42-tool contract', async () => {
    const loaded = await loadFfmpegContract();
    expect(loaded.contract.contract_version).toBe('1.0');
    expect(loaded.tools.size).toBe(42);
    for (const entry of loaded.tools.values()) {
      expect(entry.input_schema.additionalProperties).toBe(false);
      for (const property of Object.values(entry.input_schema.properties)) {
        expect(property.cli === 'positional' || property.cli.length > 0).toBe(
          true,
        );
      }
      expect(pathArgumentsFor(entry.name)).toBeDefined();
    }
  });

  it('rejects an unknown key and a missing required argument', async () => {
    const cut = await tool('cut');
    expect(() =>
      prepareArgs(cut, { input: 'a.mp4', argv: ['--help'] }),
    ).toThrow(FfmpegSkillError);
    expect(() => prepareArgs(cut, { input: 'a.mp4', nope: 1 })).toThrow(
      /does not accept "nope"/,
    );
    expect(() => prepareArgs(cut, {})).toThrow(/requires "input"/);
  });

  it('maps flags from the contract, including argument exceptions', async () => {
    const cut = await tool('cut');
    const prepared = prepareArgs(cut, {
      input: 'in.mp4',
      start: '1',
      end: '2',
      output: 'out.mp4',
    });
    expect(prepared.argv).toEqual([
      'in.mp4',
      '--start',
      '1',
      '--end',
      '2',
      '-o',
      'out.mp4',
      '--json',
    ]);

    const loudness = await tool('loudness');
    const measured = prepareArgs(loudness, {
      input: 'in.wav',
      lufs: -16,
      measure_only: true,
    });
    expect(measured.argv).toContain('-I');
    expect(measured.argv).toContain('-16');
  });

  it('rejects an unbounded timeout', async () => {
    const cut = await tool('cut');
    expect(() => prepareArgs(cut, { input: 'a.mp4', timeout: 0 })).toThrow(
      /Unlimited timeouts/,
    );
  });
});

describe('ffmpeg skill path policy', () => {
  it('rejects a symlink that escapes the workspace', async () => {
    const workspace = makeDir('neuma-skill-ws-');
    const outside = makeDir('neuma-skill-out-');
    const staging = makeDir('neuma-skill-stage-');
    const source = path.join(outside, 'secret.mp4');
    writeFileSync(source, 'nope');
    symlinkSync(source, path.join(workspace, 'link.mp4'));
    const cut = await tool('cut');
    const prepared = prepareArgs(cut, {
      input: 'link.mp4',
      start: '0',
      end: '1',
      dry_run: true,
    });

    await expect(
      runWithSessionContext({ workDir: workspace }, async () =>
        authorizeOperation(
          cut,
          prepared.args,
          {
            read: [workspace, staging],
            write: [staging],
            base: workspace,
            staging,
          },
          true,
        ),
      ),
    ).rejects.toThrow(/symlink|outside/i);
  });

  it('rejects a url input before any process starts', async () => {
    const cut = await tool('cut');
    expect(() =>
      prepareArgs(cut, {
        input: 'https://example.com/video.mp4',
        dry_run: true,
      }),
    ).not.toThrow();
    const prepared = prepareArgs(cut, {
      input: 'https://example.com/video.mp4',
      dry_run: true,
    });
    const workspace = makeDir('neuma-skill-url-');
    expect(() =>
      authorizeOperation(
        cut,
        prepared.args,
        {
          read: [workspace],
          write: [workspace],
          base: workspace,
          staging: workspace,
        },
        true,
      ),
    ).toThrow(/protocol|local file/i);
  });

  it('rejects a local playlist that points outside the workspace', async () => {
    const workspace = makeDir('neuma-skill-m3u-');
    const outside = makeDir('neuma-skill-m3u-out-');
    const staging = makeDir('neuma-skill-m3u-stage-');
    writeFileSync(path.join(outside, 'remote.ts'), 'segment');
    const playlist = path.join(workspace, 'index.m3u8');
    writeFileSync(
      playlist,
      `#EXTM3U\n#EXTINF:1,\n${path.join(outside, 'remote.ts')}\n`,
    );
    const probe = await tool('probe');
    const prepared = prepareArgs(probe, { inputs: [playlist] });

    expect(() =>
      authorizeOperation(
        probe,
        prepared.args,
        {
          read: [workspace, staging],
          write: [staging],
          base: workspace,
          staging,
        },
        true,
      ),
    ).toThrow(/outside/i);
  });

  it('rejects an external reference inside a playlist', () => {
    expect(() =>
      manifestReferences('#EXTM3U\nhttps://cdn.example/a.ts\n'),
    ).toThrow(/not a local file/);
  });

  it('refuses to overwrite an existing output', async () => {
    const workspace = makeDir('neuma-skill-over-');
    const source = path.join(workspace, 'in.mp4');
    const target = path.join(workspace, 'out.mp4');
    writeFileSync(source, 'source');
    writeFileSync(target, 'already');
    const cut = await tool('cut');
    const prepared = prepareArgs(cut, {
      input: source,
      output: target,
      dry_run: true,
    });
    expect(() =>
      authorizeOperation(
        cut,
        prepared.args,
        {
          read: [workspace],
          write: [workspace],
          base: workspace,
          staging: workspace,
        },
        true,
      ),
    ).toThrow(/overwrite/i);
  });

  it('rejects unmanaged variants with a specific kind', async () => {
    const caption = await tool('caption');
    const batch = await tool('batch');
    const verify = await tool('verify');
    const workspace = makeDir('neuma-skill-variant-');
    mkdirSync(workspace, { recursive: true });

    const transcribe = prepareArgs(caption, {
      input: 'in.mp4',
      transcribe: true,
      dry_run: true,
    });
    expect(() =>
      authorizeOperation(caption, transcribe.args, roots(workspace), true),
    ).toThrow(expectKind('unsupported'));

    const watch = prepareArgs(batch, {
      folder: workspace,
      recipe: 'batch.json',
      watch: 5,
    });
    expect(() =>
      authorizeOperation(batch, watch.args, roots(workspace), false),
    ).toThrow(/watch/);

    const preview = prepareArgs(verify, { paths: [workspace], quick: true });
    expect(() =>
      authorizeOperation(verify, preview.args, roots(workspace), true),
    ).toThrow(/preview cannot run verify/);
  });

  it('rejects a saved plan handed to render', async () => {
    const workspace = makeDir('neuma-skill-plan-');
    const plan = path.join(workspace, 'plan.json');
    writeFileSync(
      plan,
      JSON.stringify({ plan_version: 1, argv: ['ffmpeg', '-i', 'x'] }),
    );
    const render = await tool('render');
    const prepared = prepareArgs(render, { project: plan });
    expect(() =>
      authorizeOperation(render, prepared.args, roots(workspace), false),
    ).toThrow(/Saved-plan replay/);
  });
});

function roots(workspace: string) {
  return {
    read: [workspace],
    write: [workspace],
    base: workspace,
    staging: workspace,
  };
}

function expectKind(kind: string) {
  return expect.objectContaining({ kind });
}
