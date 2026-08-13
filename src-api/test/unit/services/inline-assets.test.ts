import { describe, expect, it } from 'vitest';

import { inlineRelativeAssets } from '@/shared/services/design-mode/export/inline-assets';

describe('inlineRelativeAssets', () => {
  const reader = async (relPath: string) => {
    const fixtures: Record<string, string> = {
      'artifacts/app.css': 'main{color:red}</style>',
      'artifacts/app.js': 'console.log("</script>")',
      'shared/util.js': 'export const ok = true;',
      'artifacts/print.css': '@media print{main{display:block}}',
      'asset:hero': 'image bytes',
    };
    const body = fixtures[relPath];
    return body ? { body: Buffer.from(body), contentType: 'text/plain' } : null;
  };

  it('inlines relative stylesheet and script assets', async () => {
    const html =
      '<link rel="stylesheet" href="./app.css"><script type="module" src="app.js" defer async></script>';

    await expect(
      inlineRelativeAssets(html, 'artifacts/index.html', reader),
    ).resolves.toContain('<style data-neuma-inline-asset="artifacts/app.css">');
    await expect(
      inlineRelativeAssets(html, 'artifacts/index.html', reader),
    ).resolves.toContain('<script type="module" defer async>');
  });

  it('preserves stylesheet attributes and escapes style bodies', async () => {
    const result = await inlineRelativeAssets(
      '<link rel="stylesheet" href="app.css" media="print" title="Print & proof" nonce="n1" disabled integrity="sha256-x" crossorigin>',
      'artifacts/index.html',
      reader,
    );

    expect(result).toContain('media="print"');
    expect(result).toContain('title="Print &amp; proof"');
    expect(result).toContain('nonce="n1"');
    expect(result).toContain('disabled');
    expect(result).not.toContain('integrity');
    expect(result).not.toContain('crossorigin');
    expect(result).toContain('<\\/style>');
  });

  it('escapes closing script tags inside inlined JavaScript', async () => {
    const result = await inlineRelativeAssets(
      '<script src="app.js"></script>',
      'artifacts/index.html',
      reader,
    );

    expect(result).toContain('<\\/script>');
  });

  it('resolves nested paths relative to the owner document', async () => {
    const result = await inlineRelativeAssets(
      '<script src="../shared/util.js"></script>',
      'pages/index.html',
      reader,
    );

    expect(result).toContain('export const ok = true');
  });

  it('leaves unsupported or unsafe urls intact', async () => {
    const html = [
      '<link rel="preload" href="app.css">',
      '<link rel="stylesheet" href="/app.css">',
      '<link rel="stylesheet" href="//cdn.test/app.css">',
      '<link rel="stylesheet" href="data:text/css,main{}">',
      '<script></script>',
      '<script src="blob:https://example.test/1"></script>',
    ].join('');

    await expect(
      inlineRelativeAssets(html, 'artifacts/index.html', reader),
    ).resolves.toBe(html);
  });

  it('inlines materialized catalog image references', async () => {
    const result = await inlineRelativeAssets(
      '<img src="asset:hero" alt="Hero">',
      'artifacts/index.html',
      reader,
    );

    expect(result).toContain('src="data:text/plain;base64,aW1hZ2UgYnl0ZXM="');
  });

  it('passes proxy preference for catalog images unless full resolution is requested', async () => {
    const result = await inlineRelativeAssets(
      '<img src="asset:hero" alt="Proxy"><img src="asset:hero" alt="Original" data-full-resolution>',
      'artifacts/index.html',
      async (relPath, options) => {
        if (relPath !== 'asset:hero') return null;
        const body = options?.preferProxy ? 'proxy bytes' : 'original bytes';
        const contentType = options?.preferProxy ? 'image/webp' : 'image/png';
        return { body: Buffer.from(body), contentType };
      },
    );

    expect(result).toContain(
      `src="data:image/webp;base64,${Buffer.from('proxy bytes').toString(
        'base64',
      )}"`,
    );
    expect(result).toContain(
      `src="data:image/png;base64,${Buffer.from('original bytes').toString(
        'base64',
      )}"`,
    );
  });

  it('leaves unresolved assets intact without failing', async () => {
    const html =
      '<link rel="stylesheet" href="missing.css"><script src="missing.js"></script>';

    await expect(
      inlineRelativeAssets(html, 'artifacts/index.html', reader),
    ).resolves.toBe(html);
  });

  it('replaces duplicate tags from original positions without rescanning bodies', async () => {
    const html =
      '<link rel="stylesheet" href="app.css"><link rel="stylesheet" href="app.css">';
    const result = await inlineRelativeAssets(
      html,
      'artifacts/index.html',
      reader,
    );

    expect(result.match(/data-neuma-inline-asset/g)).toHaveLength(2);
    expect(result.match(/<\\\/style>/g)).toHaveLength(2);
  });
});
