import { mkdtempSync, rmSync } from 'node:fs';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { HtmlEngineError } from '@/shared/video/engines/html/errors';
import { buildHtmlScene } from '@/shared/video/engines/html/render-to-html';

let workDir: string;
let templateDir: string;

beforeAll(async () => {
  workDir = mkdtempSync(path.join(tmpdir(), 'render-to-html-'));
  templateDir = path.join(workDir, 'tpl');
  await fs.mkdir(templateDir, { recursive: true });
});
afterAll(() => rmSync(workDir, { recursive: true, force: true }));

const writeTemplate = async (
  body: string,
  extras: Record<string, string> = {},
) => {
  await fs.writeFile(path.join(templateDir, 'index.html'), body, 'utf8');
  for (const [name, content] of Object.entries(extras)) {
    await fs.writeFile(path.join(templateDir, name), content, 'utf8');
  }
  return path.join(templateDir, 'index.html');
};

describe('buildHtmlScene', () => {
  it('injects __NEUMA_VARS__ + __NEUMA_DURATION__ before </body>', async () => {
    const src = await writeTemplate('<html><body><h1>Hi</h1></body></html>');
    const outDir = path.join(workDir, 'out-1');
    const result = await buildHtmlScene({
      templateSourcePath: src,
      variables: { title: 'Hi' },
      durationSec: 4,
      outDir,
    });
    const html = await fs.readFile(result.htmlPath, 'utf8');
    expect(html).toMatch(/__NEUMA_VARS__/);
    expect(html).toMatch(/__NEUMA_DURATION__/);
    expect(html).toMatch(/"title":"Hi"/);
    expect(html).toMatch(/<\/body>/);
    // injection lives before </body>.
    expect(html.indexOf('__NEUMA_DURATION__')).toBeLessThan(
      html.indexOf('</body>'),
    );
    expect(result.injectionNonce).toMatch(/^[a-f0-9]{32}$/);
  });

  it('copies sibling assets next to the scene HTML for file:// resolution', async () => {
    const src = await writeTemplate(
      '<html><body><img src="logo.svg" /></body></html>',
      { 'logo.svg': '<svg/>' },
    );
    const outDir = path.join(workDir, 'out-2');
    const result = await buildHtmlScene({
      templateSourcePath: src,
      durationSec: 2,
      outDir,
    });
    expect(result.referencedAssets).toContain('logo.svg');
    const copied = await fs.readFile(path.join(outDir, 'logo.svg'), 'utf8');
    expect(copied).toBe('<svg/>');
  });

  it('appends injection when </body> is missing', async () => {
    const src = await writeTemplate('<html><h1>Bare</h1></html>');
    const outDir = path.join(workDir, 'out-3');
    const result = await buildHtmlScene({
      templateSourcePath: src,
      durationSec: 2,
      outDir,
    });
    const html = await fs.readFile(result.htmlPath, 'utf8');
    expect(html).toMatch(/__NEUMA_VARS__/);
  });

  it('throws typed errors for bad inputs', async () => {
    const outDir = path.join(workDir, 'out-4');
    await expect(
      buildHtmlScene({
        templateSourcePath: path.join(workDir, 'nope.html'),
        durationSec: 4,
        outDir,
      }),
    ).rejects.toBeInstanceOf(HtmlEngineError);

    const src = await writeTemplate('<html><body></body></html>');
    await expect(
      buildHtmlScene({
        templateSourcePath: src,
        durationSec: 0,
        outDir,
      }),
    ).rejects.toBeInstanceOf(HtmlEngineError);
  });

  it('escapes </script> inside variable JSON so the injection cannot be closed early', async () => {
    const src = await writeTemplate('<html><body></body></html>');
    const outDir = path.join(workDir, 'out-5');
    const result = await buildHtmlScene({
      templateSourcePath: src,
      variables: { evil: '</script><script>alert(1)</script>' },
      durationSec: 2,
      outDir,
    });
    const html = await fs.readFile(result.htmlPath, 'utf8');
    // The escaped marker survives; the literal closer does not.
    expect(html).toContain('<\\/script');
    expect(html).not.toMatch(/<\/script>\s*<script>\s*alert/);
  });
});
