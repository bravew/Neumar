import { SANDBOX_CSP } from './iframe-sandbox';

// Phase 6 M1 — HTML-frame srcdoc wrapper.
//
// Templates ship a *full* HTML document at `source/index.html`. This helper:
//   1. Injects a meta CSP that matches what IframeSandbox expects.
//   2. Injects `window.__NEUMA_VARS__ = <variables>` BEFORE any template
//      script runs, so the same variable contract used by the materializer
//      works in the live preview.
//   3. Appends a minimal bootstrap that reports `shell:ready` + `resize`
//      events to the parent so IframeSandbox's transport handshake completes
//      without changes. The nonce here is a postMessage authentication token
//      (the parent verifies event.source + nonce before trusting a message);
//      it is NOT a CSP nonce. `SANDBOX_CSP` gates scripts via
//      `script-src 'unsafe-inline'`, not a nonce allow-list.
//
// The injection is string-based on purpose — DOMParser inside the editor
// would (a) drop `<script>` content silently in some hosts and (b) pull in
// the full DOM lib for what is essentially two `<head>` insertions. The
// template HTML is gallery-validated upstream (see
// `src-api/src/shared/video/templates/gallery-loader.ts`), so it is trusted.

const HEAD_OPEN_RE = /<head\b[^>]*>/i;
const HTML_OPEN_RE = /<html\b[^>]*>/i;
const BODY_CLOSE_RE = /<\/body\s*>/i;

function bootstrapScript(nonce: string): string {
  return `<script>(function(){
    var N=${JSON.stringify(nonce)};
    function send(m){m.nonce=N;parent.postMessage(m,'*');}
    function postSize(){
      var h=Math.max(
        document.documentElement.scrollHeight,
        document.body?document.body.scrollHeight:0
      );
      send({type:'resize',height:h});
    }
    function postShellReady(){send({type:'shell:ready',payload:{href:String(location.href||'about:srcdoc')}});}
    window.addEventListener('error',function(e){
      send({type:'event',payload:{kind:'error',message:String(e.message||e)}});
    });
    window.addEventListener('load',function(){
      send({type:'ready'});
      postSize();
      var raf=window.requestAnimationFrame||function(fn){return setTimeout(fn,16);};
      raf(function(){raf(postShellReady);});
      try{
        var ro=new ResizeObserver(function(){postSize();});
        ro.observe(document.documentElement);
        if(document.body)ro.observe(document.body);
      }catch(_){}
    });
  })();</script>`;
}

function varsScript(variables: Record<string, unknown>): string {
  // Escape `</` to prevent early script termination in pathological values
  // (a string like `</script>` embedded in a variable).
  const json = JSON.stringify(variables).replaceAll('</', '<\\/');
  return `<script>window.__NEUMA_VARS__=${json};</script>`;
}

const CSP_META = `<meta http-equiv="Content-Security-Policy" content="${SANDBOX_CSP}">`;

export interface WrapHtmlFrameOptions {
  /** Full HTML document from a template's `source/index.html`. */
  rawHtml: string;
  /** Same nonce passed to IframeSandbox. */
  nonce: string;
  /** Template variables exposed at `window.__NEUMA_VARS__`. */
  variables: Record<string, unknown>;
}

export function wrapHtmlFrameSrcdoc({
  rawHtml,
  nonce,
  variables,
}: WrapHtmlFrameOptions): string {
  const headInjection = CSP_META + varsScript(variables);
  const bodyInjection = bootstrapScript(nonce);

  let out = rawHtml;

  if (HEAD_OPEN_RE.test(out)) {
    out = out.replace(HEAD_OPEN_RE, (m) => `${m}${headInjection}`);
  } else if (HTML_OPEN_RE.test(out)) {
    out = out.replace(HTML_OPEN_RE, (m) => `${m}<head>${headInjection}</head>`);
  } else {
    out = `<!doctype html><html><head>${headInjection}</head><body>${out}</body></html>`;
  }

  if (BODY_CLOSE_RE.test(out)) {
    out = out.replace(BODY_CLOSE_RE, (m) => `${bodyInjection}${m}`);
  } else {
    out = `${out}${bodyInjection}`;
  }

  return out;
}
