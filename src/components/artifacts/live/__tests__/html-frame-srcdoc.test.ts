import { describe, expect, it } from 'vitest';

import { wrapHtmlFrameSrcdoc } from '../html-frame-srcdoc';

const FULL_DOC = `<!doctype html>
<html>
  <head><title>Tpl</title></head>
  <body><h1 id="t"></h1><script>document.getElementById('t').textContent=window.__NEUMA_VARS__.title;</script></body>
</html>`;

const NO_HEAD = `<!doctype html>
<html>
  <body><h1>hi</h1></body>
</html>`;

const FRAGMENT = `<h1>hi</h1>`;

describe('wrapHtmlFrameSrcdoc', () => {
  it('injects CSP + __NEUMA_VARS__ + bootstrap into a full document', () => {
    const out = wrapHtmlFrameSrcdoc({
      rawHtml: FULL_DOC,
      nonce: 'abc',
      variables: { title: 'Hello' },
    });
    expect(out).toContain('Content-Security-Policy');
    expect(out).toContain('window.__NEUMA_VARS__={"title":"Hello"}');
    expect(out).toContain('parent.postMessage(m,');
    // The bootstrap must precede `</body>` so it runs after the template body.
    const idx = out.indexOf('postShellReady');
    const close = out.lastIndexOf('</body>');
    expect(idx).toBeGreaterThan(-1);
    expect(close).toBeGreaterThan(idx);
  });

  it('synthesises a <head> when the template omits one', () => {
    const out = wrapHtmlFrameSrcdoc({
      rawHtml: NO_HEAD,
      nonce: 'n',
      variables: {},
    });
    expect(out).toContain('<head>');
    expect(out).toContain('Content-Security-Policy');
    expect(out).toContain('window.__NEUMA_VARS__={}');
  });

  it('wraps a bare HTML fragment in a full document shell', () => {
    const out = wrapHtmlFrameSrcdoc({
      rawHtml: FRAGMENT,
      nonce: 'n',
      variables: {},
    });
    expect(out).toContain('<!doctype html>');
    expect(out).toContain('<body><h1>hi</h1>');
    expect(out).toContain('Content-Security-Policy');
  });

  it('escapes embedded </script> inside variables so script ends are not faked', () => {
    const out = wrapHtmlFrameSrcdoc({
      rawHtml: FULL_DOC,
      nonce: 'n',
      variables: { evil: '</script><script>alert(1)</script>' },
    });
    expect(out).not.toContain('</script><script>alert(1)');
    // The escaped form must still be valid JSON when un-escaped at runtime.
    expect(out).toContain('<\\/script>');
  });

  it('escapes the nonce for safe embedding', () => {
    const out = wrapHtmlFrameSrcdoc({
      rawHtml: FRAGMENT,
      nonce: 'plain-nonce',
      variables: {},
    });
    expect(out).toContain('"plain-nonce"');
  });
});
