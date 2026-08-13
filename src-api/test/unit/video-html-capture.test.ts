import { mkdtempSync, rmSync } from 'node:fs';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { type BrowserHandle } from '@/shared/video/engines/html/browser';
import { captureHtmlToMp4 } from '@/shared/video/engines/html/capture';
import { HtmlEngineError } from '@/shared/video/engines/html/errors';

let workDir: string;

beforeAll(() => {
  workDir = mkdtempSync(path.join(tmpdir(), 'html-capture-'));
});
afterAll(() => rmSync(workDir, { recursive: true, force: true }));

interface FakePlaywrightOptions {
  /** Path the captured webm will be written to before close(). */
  webmName?: string;
  /** Optional hook to simulate work / abort. */
  afterGoto?: () => Promise<void>;
}

function fakeBrowserHandle(
  recordDirRef: { dir?: string },
  options: FakePlaywrightOptions = {},
): BrowserHandle {
  const browser = {
    newContext: vi.fn(async (opts: { recordVideo: { dir: string } }) => {
      recordDirRef.dir = opts.recordVideo.dir;
      return {
        newPage: vi.fn(async () => ({
          goto: vi.fn(async () => {
            await options.afterGoto?.();
            return undefined;
          }),
        })),
        close: vi.fn(async () => {
          // Drop a fake webm into the record dir so capture finds one.
          await fs.writeFile(
            path.join(recordDirRef.dir!, options.webmName ?? 'page.webm'),
            'fake-webm-bytes',
          );
        }),
      };
    }),
    version: () => '1.60.0',
    close: vi.fn(async () => undefined),
  };
  return {
    browser: browser as unknown as BrowserHandle['browser'],
    version: '1.60.0',
    close: async () => {
      await browser.close();
    },
  };
}

const writeHtml = async (body: string): Promise<string> => {
  const p = path.join(workDir, `scene-${Date.now()}-${Math.random()}.html`);
  await fs.writeFile(p, body, 'utf8');
  return p;
};

describe('captureHtmlToMp4', () => {
  it('records, muxes, and returns a populated CaptureResult', async () => {
    const recordRef: { dir?: string } = {};
    const handle = fakeBrowserHandle(recordRef);
    const outputPath = path.join(workDir, 'out-1.mp4');
    const htmlPath = await writeHtml('<html><body>x</body></html>');

    const ffmpeg = vi.fn(async () => {
      // Materialise the output so stat() works.
      await fs.writeFile(outputPath, Buffer.alloc(1024));
      return { exitCode: 0, stderr: '' };
    });

    const progress: Array<[number, string]> = [];
    const result = await captureHtmlToMp4({
      htmlPath,
      outputPath,
      width: 640,
      height: 360,
      fps: 30,
      durationSec: 0.3,
      browser: handle,
      runFfmpeg: ffmpeg,
      onProgress: (pct, stage) => progress.push([pct, stage]),
    });

    expect(result.outputPath).toBe(outputPath);
    expect(result.width).toBe(640);
    expect(result.height).toBe(360);
    expect(result.fileSizeBytes).toBe(1024);
    expect(result.renderedFrames).toBe(9);
    expect(ffmpeg).toHaveBeenCalledTimes(1);
    expect(progress.find(([, s]) => s === 'recording')).toBeDefined();
    expect(progress.at(-1)).toEqual([100, 'muxing']);
  });

  it('throws HtmlEngineError("mux-failed") when ffmpeg exits non-zero', async () => {
    const recordRef: { dir?: string } = {};
    const handle = fakeBrowserHandle(recordRef);
    const outputPath = path.join(workDir, 'out-2.mp4');
    const htmlPath = await writeHtml('<html><body>x</body></html>');
    const ffmpeg = vi.fn(async () => ({ exitCode: 1, stderr: 'bad codec' }));
    try {
      await captureHtmlToMp4({
        htmlPath,
        outputPath,
        width: 320,
        height: 240,
        fps: 30,
        durationSec: 0.2,
        browser: handle,
        runFfmpeg: ffmpeg,
      });
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(HtmlEngineError);
      expect((err as HtmlEngineError).code).toBe('mux-failed');
    }
  });

  it('rejects out-of-range duration before launching anything', async () => {
    const handle = fakeBrowserHandle({});
    const ffmpeg = vi.fn();
    await expect(
      captureHtmlToMp4({
        htmlPath: '/does-not-matter',
        outputPath: path.join(workDir, 'no.mp4'),
        width: 320,
        height: 240,
        fps: 30,
        durationSec: 0,
        browser: handle,
        runFfmpeg: ffmpeg,
      }),
    ).rejects.toBeInstanceOf(HtmlEngineError);
    expect(ffmpeg).not.toHaveBeenCalled();
  });

  it('aborts when the signal fires during the wait', async () => {
    const recordRef: { dir?: string } = {};
    const handle = fakeBrowserHandle(recordRef, {
      afterGoto: () => new Promise<void>(() => undefined), // page.goto resolves
    });
    const ctrl = new AbortController();
    const ffmpeg = vi.fn();
    const htmlPath = await writeHtml('<html><body>x</body></html>');
    const promise = captureHtmlToMp4({
      htmlPath,
      outputPath: path.join(workDir, 'aborted.mp4'),
      width: 320,
      height: 240,
      fps: 30,
      durationSec: 5,
      browser: handle,
      runFfmpeg: ffmpeg,
      signal: ctrl.signal,
    });
    setTimeout(() => ctrl.abort(), 50);
    await expect(promise).rejects.toMatchObject({ code: 'browser-aborted' });
    expect(ffmpeg).not.toHaveBeenCalled();
  });

  it('throws "template-source-missing" when the HTML path does not exist', async () => {
    const handle = fakeBrowserHandle({});
    try {
      await captureHtmlToMp4({
        htmlPath: path.join(workDir, 'nope.html'),
        outputPath: path.join(workDir, 'no.mp4'),
        width: 320,
        height: 240,
        fps: 30,
        durationSec: 0.2,
        browser: handle,
        runFfmpeg: vi.fn(),
      });
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(HtmlEngineError);
      expect((err as HtmlEngineError).code).toBe('template-source-missing');
    }
  });
});
