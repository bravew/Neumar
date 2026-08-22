import { mkdtempSync, rmSync } from 'node:fs';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createHtmlAdapter } from '@/shared/video/engines/html-adapter';
import { HtmlEngineError } from '@/shared/video/engines/html/errors';
import type { EngineRenderInput } from '@/shared/video/engines/types';

let workDir: string;
let templateSourcePath: string;

beforeAll(async () => {
  workDir = mkdtempSync(path.join(tmpdir(), 'html-adapter-impl-'));
  templateSourcePath = path.join(workDir, 'source.html');
  await fs.writeFile(
    templateSourcePath,
    '<html><body><h1>Hello</h1></body></html>',
    'utf8',
  );
});
afterAll(() => rmSync(workDir, { recursive: true, force: true }));

function makeInput(
  overrides: Partial<EngineRenderInput> = {},
): EngineRenderInput {
  return {
    template: {
      id: 'frame-bold-title',
      engineId: 'html',
      sourcePath: templateSourcePath,
    },
    variables: { title: 'Hello' },
    config: {
      format: 'mp4',
      resolution: { width: 640, height: 360 },
      fps: { num: 30, den: 1 },
      duration: 0.5,
      outputPath: path.join(workDir, 'out.mp4'),
    },
    ...overrides,
  };
}

describe('html adapter (real impl)', () => {
  it('reports typed availability when chromium is resolvable or missing', async () => {
    const ok = createHtmlAdapter({
      playwrightLoader: async () => ({ chromium: {} }),
    });
    expect(await ok.probeAvailability()).toMatchObject({ installed: true });

    const missing = createHtmlAdapter({
      playwrightLoader: async () => {
        throw new Error("can't find module 'playwright'");
      },
    });
    expect(await missing.probeAvailability()).toEqual({
      installed: false,
      reason: 'browser-missing',
    });
  });

  it('validate rejects a template ref without sourcePath', () => {
    const adapter = createHtmlAdapter();
    const result = adapter.validate({
      id: 't',
      engineId: 'html',
      sourcePath: '',
    });
    expect(result.ok).toBe(false);
    expect(result.issues[0]?.code).toBe('missing-source-path');
  });

  it('render builds the scene, calls capture, returns populated meta', async () => {
    const capture = vi.fn(
      async (opts: {
        onProgress?: (p: number, s: string) => void;
        outputPath: string;
      }) => {
        opts.onProgress?.(50, 'recording');
        opts.onProgress?.(95, 'muxing');
        return {
          outputPath: opts.outputPath,
          durationSec: 0.5,
          width: 640,
          height: 360,
          fileSizeBytes: 2048,
          renderedFrames: 15,
          wallClockSec: 0.5,
        };
      },
    );

    const progress: Array<[number, string]> = [];
    const adapter = createHtmlAdapter({ capture: capture as never });
    const out = await adapter.render(makeInput(), {
      workDir,
      onProgress: (p, s) => progress.push([p, s]),
    });
    expect(out.outputPath).toMatch(/out\.mp4$/);
    expect(out.meta.engineVersion).toMatch(/playwright/);
    expect(out.meta.inputHash).toMatch(/^[a-f0-9]{16}$/);
    expect(out.meta.renderedFrames).toBe(15);
    expect(out.meta.fps).toBe(30);
    expect(progress.find(([, s]) => s === 'rendering')).toBeDefined();
    expect(progress.find(([, s]) => s === 'muxing')).toBeDefined();
  });

  it('renderToHtml emits a self-contained HTML scene with injection', async () => {
    const adapter = createHtmlAdapter();
    const sceneOut = await adapter.renderToHtml!(makeInput(), { workDir });
    const body = await fs.readFile(sceneOut.htmlPath, 'utf8');
    expect(body).toMatch(/__NEUMA_VARS__/);
    expect(body).toMatch(/__NEUMA_DURATION__/);
    expect(sceneOut.durationSec).toBe(0.5);
  });

  it('renderToHtml refuses an already-aborted signal', async () => {
    const adapter = createHtmlAdapter();
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(
      adapter.renderToHtml!(makeInput(), { workDir, signal: ctrl.signal }),
    ).rejects.toBeInstanceOf(HtmlEngineError);
  });

  it('falls back to a 5s duration when config.duration is "auto"', async () => {
    const capture = vi.fn(async () => ({
      outputPath: path.join(workDir, 'auto.mp4'),
      durationSec: 5,
      width: 640,
      height: 360,
      fileSizeBytes: 100,
      renderedFrames: 150,
      wallClockSec: 5,
    }));
    const adapter = createHtmlAdapter({ capture: capture as never });
    const out = await adapter.render(
      makeInput({
        config: {
          format: 'mp4',
          resolution: { width: 640, height: 360 },
          fps: { num: 30, den: 1 },
          duration: 'auto',
          outputPath: path.join(workDir, 'auto.mp4'),
        },
      }),
      { workDir },
    );
    expect(out.meta.renderedFrames).toBe(150);
    expect(capture).toHaveBeenCalledWith(
      expect.objectContaining({ durationSec: 5 }),
    );
  });
});
