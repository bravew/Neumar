/**
 * Sandbox security model:
 *   - `sandbox="allow-scripts allow-downloads"` ONLY — never
 *     `allow-same-origin`. The null origin is what blocks
 *     parent.document/cookie/storage access. `allow-downloads` permits
 *     user-initiated downloads inside the sandbox without enabling
 *     same-origin reads.
 *   - Defense-in-depth meta CSP at the top of every srcdoc.
 *   - Per-frame nonce; parent verifies BOTH `event.source` and the nonce
 *     before trusting any postMessage. Origin alone is `"null"` for every
 *     such iframe and is therefore not a usable check.
 *
 * `ArtifactPreview.tsx` uses a different (`allow-same-origin`) sandbox
 * for user-opened static files — keep these boundaries separate.
 */

import { randomUUID } from '@/shared/utils/uuid';

export const SANDBOX_ATTR = 'allow-scripts allow-downloads' as const;

// This CSP is delivered via a `<meta http-equiv>` inside the sandboxed srcdoc.
// `frame-ancestors` is intentionally omitted: browsers ignore it when set via a
// `<meta>` element (it only takes effect as an HTTP header) and including it
// just emits a console warning. Framing of these null-origin sandboxed iframes
// is already controlled by the `sandbox` attribute, not by CSP.
export const SANDBOX_CSP =
  "default-src 'none'; " +
  "script-src 'unsafe-inline'; " +
  "style-src 'unsafe-inline'; " +
  'img-src data: blob: https:; ' +
  'font-src data: https:; ' +
  'media-src data: blob: https:; ' +
  "connect-src 'none'; " +
  "form-action 'none'; " +
  "base-uri 'none';";

export type FrameMessage =
  | { nonce: string; type: 'ready' }
  | {
      nonce: string;
      type: 'shell:ready';
      payload?: { href?: string; sandbox?: string };
    }
  | { nonce: string; type: 'resize'; height: number }
  | { nonce: string; type: 'event'; payload: unknown }
  | { nonce: string; type: 'request'; payload: unknown };

export type SelectBridgeMode = 'off' | 'inspect' | 'target' | 'comment';

export interface NeumaTargetPayload {
  kind: 'neuma-target';
  id: string;
  selector?: string;
  role?: string;
  label?: string;
  screen?: string;
  tagName: string;
  text?: string;
  pin?: { x: number; y: number };
  styles?: Partial<Record<InspectStyleProp, string>>;
}

export interface AcceptedMessage {
  type: 'ready' | 'shell:ready' | 'resize' | 'event' | 'request';
  height?: number;
  payload?: unknown;
}

export const INSPECT_STYLE_PROPS = [
  'color',
  'backgroundColor',
  'fontSize',
  'fontWeight',
  'textAlign',
  'padding',
  'margin',
  'borderRadius',
  'border',
  'width',
  'minHeight',
] as const;

export type InspectStyleProp = (typeof INSPECT_STYLE_PROPS)[number];

export interface InspectStylePatch {
  id: string;
  prop: InspectStyleProp;
  value: string;
}

/**
 * Walks from a clicked node to the nearest annotated ancestor. The iframe
 * bootstrap mirrors this behavior so comments never pin to the document body
 * when an unannotated child sits inside a `data-neuma-id` region.
 */
export function findNearestAnnotatedTarget(start: Element | null) {
  return start?.closest?.('[data-neuma-id]') ?? null;
}

const AUTO_TARGET_PREFIX = 'neuma-auto-path-';

const AUTO_TARGET_SELECTOR = [
  'section',
  'article',
  'header',
  'footer',
  'nav',
  'main',
  'aside',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'button',
  'a',
  '[id]',
  'body > div[class]',
  'body > div[id]',
  'section > div[class]',
  'section > div[id]',
  'article > div[class]',
  'article > div[id]',
  'main > div[class]',
  'main > div[id]',
  'header > div[class]',
  'header > div[id]',
  'footer > div[class]',
  'footer > div[id]',
  'nav > div[class]',
  'nav > div[id]',
  'aside > div[class]',
  'aside > div[id]',
  '[id] > div[class]',
  '[id] > div[id]',
].join(', ');

const AUTO_TARGET_SKIP_TAGS = new Set([
  'script',
  'style',
  'template',
  'noscript',
  'iframe',
  'object',
  'embed',
]);

function sourcePathForElement(el: Element) {
  const parts: number[] = [];
  let node: Element | null = el;
  while (node && node !== node.ownerDocument.body) {
    const parent: Element | null = node.parentElement;
    if (!parent) break;
    parts.unshift(Array.prototype.indexOf.call(parent.children, node));
    node = parent;
  }
  return parts.join('-');
}

function safeAutoId(path: string, fallbackIndex: number) {
  const suffix = path || String(fallbackIndex);
  return `${AUTO_TARGET_PREFIX}${suffix.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
}

function autoTargetLabel(el: Element) {
  const label =
    el.getAttribute('aria-label') ||
    el.getAttribute('id') ||
    el.textContent?.replace(/\s+/g, ' ').trim().slice(0, 80);
  return label || null;
}

export function annotateMissingNeumaIds(fragment: string): string {
  if (typeof DOMParser === 'undefined') return fragment;
  try {
    const parsed = new DOMParser().parseFromString(
      `<body>${fragment}</body>`,
      'text/html',
    );
    const existingIds = new Set(
      [...parsed.body.querySelectorAll('[data-neuma-id]')]
        .map((node) => node.getAttribute('data-neuma-id'))
        .filter((value): value is string => Boolean(value)),
    );
    let fallbackIndex = 0;
    parsed.body.querySelectorAll(AUTO_TARGET_SELECTOR).forEach((el) => {
      if (el.hasAttribute('data-neuma-id')) return;
      const tagName = el.tagName.toLowerCase();
      if (AUTO_TARGET_SKIP_TAGS.has(tagName)) return;
      let id = safeAutoId(sourcePathForElement(el), fallbackIndex++);
      while (existingIds.has(id)) {
        id = safeAutoId('', fallbackIndex++);
      }
      existingIds.add(id);
      el.setAttribute('data-neuma-id', id);
      const label = autoTargetLabel(el);
      if (label && !el.hasAttribute('data-neuma-label')) {
        el.setAttribute('data-neuma-label', label);
      }
    });
    return parsed.body.innerHTML;
  } catch {
    return fragment;
  }
}

/**
 * `event.origin` is intentionally unchecked: a sandboxed-without-
 * allow-same-origin frame always reports origin `"null"`, so origin
 * alone is meaningless. Source identity + nonce are the boundary.
 */
export function acceptMessage(
  event: MessageEvent,
  expectedSource: Window | null,
  expectedNonce: string,
): AcceptedMessage | null {
  if (!expectedSource || event.source !== expectedSource) return null;
  const data = event.data;
  if (typeof data !== 'object' || data === null) return null;
  const m = data as Partial<FrameMessage>;
  if (m.nonce !== expectedNonce) return null;
  if (
    m.type !== 'ready' &&
    m.type !== 'shell:ready' &&
    m.type !== 'resize' &&
    m.type !== 'event' &&
    m.type !== 'request'
  ) {
    return null;
  }
  if (m.type === 'resize') {
    const h = (m as { height?: unknown }).height;
    if (typeof h !== 'number' || !Number.isFinite(h) || h < 0) return null;
    return { type: 'resize', height: h };
  }
  if (m.type === 'ready') return { type: 'ready' };
  if (m.type === 'shell:ready') {
    return { type: 'shell:ready', payload: m.payload };
  }
  return { type: m.type, payload: (m as { payload?: unknown }).payload };
}

function bootstrapScript(nonce: string, mode: SelectBridgeMode): string {
  // `targetOrigin: '*'` is the only valid choice from inside a sandboxed
  // null-origin frame: the parent's origin is opaque to it, and passing
  // the literal `"null"` fails the spec's origin-equality check. Inbound
  // messages on the parent are still authenticated by source + nonce.
  return `<script>(function(){
    var N=${JSON.stringify(nonce)};
    var MODE=${JSON.stringify(mode)};
    var PROPS=${JSON.stringify(INSPECT_STYLE_PROPS)};
    var selected=null;
    function suppressPreviewFocus(){
      try{window.focus=function(){};}catch(_){}
      try{
        var htmlFocus=HTMLElement&&HTMLElement.prototype&&HTMLElement.prototype.focus;
        if(htmlFocus){
          Object.defineProperty(HTMLElement.prototype,'focus',{
            configurable:true,
            value:function(){}
          });
        }
      }catch(_){}
      try{
        var svgFocus=SVGElement&&SVGElement.prototype&&SVGElement.prototype.focus;
        if(svgFocus){
          Object.defineProperty(SVGElement.prototype,'focus',{
            configurable:true,
            value:function(){}
          });
        }
      }catch(_){}
    }
    suppressPreviewFocus();
    function send(m){m.nonce=N;parent.postMessage(m,'*');}
    function postSize(){
      var h=Math.max(
        document.documentElement.scrollHeight,
        document.body?document.body.scrollHeight:0
      );
      send({type:'resize',height:h});
    }
    function postShellReady(){
      send({type:'shell:ready',payload:{
        href:String(location.href||'about:srcdoc'),
        sandbox:${JSON.stringify(SANDBOX_ATTR)}
      }});
    }
    window.addEventListener('error',function(e){
      send({type:'event',payload:{kind:'error',message:String(e.message||e)}});
    });
    function collectStyles(el){
      var cs=getComputedStyle(el);
      var out={};
      PROPS.forEach(function(prop){out[prop]=cs[prop]||'';});
      return out;
    }
    function targetPayload(el){
      return {
        kind:'neuma-target',
        id:el.getAttribute('data-neuma-id')||'',
        role:el.getAttribute('data-neuma-role')||undefined,
        label:el.getAttribute('data-neuma-label')||undefined,
        screen:el.getAttribute('data-neuma-screen')||undefined,
        tagName:el.tagName,
        text:(el.textContent||'').slice(0,160),
        styles:collectStyles(el)
      };
    }
    function postTargetList(){
      var nodes=document.querySelectorAll('[data-neuma-id]');
      var targets=[];
      for(var i=0;i<nodes.length;i++){
        targets.push(targetPayload(nodes[i]));
      }
      send({type:'event',payload:{kind:'neuma-target-list',targets:targets}});
    }
    function findTarget(start){
      return start&&start.closest?start.closest('[data-neuma-id]'):null;
    }
    function isInteractive(el){
      return Boolean(el&&el.closest&&el.closest('a,button,input,textarea,select,label,[contenteditable="true"]'));
    }
    function clearSelected(){
      if(selected)selected.removeAttribute('data-neuma-inspect-selected');
      selected=null;
    }
    function selectTarget(el){
      clearSelected();
      selected=el;
      selected.setAttribute('data-neuma-inspect-selected','true');
      send({type:'event',payload:targetPayload(el)});
    }
    document.addEventListener('click',function(e){
      if(MODE==='off')return;
      var t=findTarget(e.target);
      if(!t&&MODE==='comment'&&!isInteractive(e.target)){
        var x=Math.round(e.clientX+window.scrollX);
        var y=Math.round(e.clientY+window.scrollY);
        send({type:'event',payload:{
          kind:'neuma-target',
          id:'data-neuma-pin-'+x+'-'+y,
          selector:'[data-neuma-pin="data-neuma-pin-'+x+'-'+y+'"]',
          role:'pin',
          label:'pin',
          tagName:'PIN',
          text:'Pin · at '+x+', '+y,
          pin:{x:x,y:y}
        }});
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if(!t)return;
      selectTarget(t);
      if(MODE==='inspect'||MODE==='comment'){
        e.preventDefault();
        e.stopPropagation();
      }
    },true);
    window.addEventListener('message',function(e){
      var data=e.data||{};
      if(data.type==='neuma-preview-snapshot'&&data.requestId){
        var requestId=String(data.requestId);
        var width=Math.max(1,Math.round(window.innerWidth||document.documentElement.clientWidth||document.body.clientWidth||1));
        var height=Math.max(1,Math.round(window.innerHeight||document.documentElement.clientHeight||document.body.clientHeight||1));
        try{
          var html=new XMLSerializer().serializeToString(document.documentElement);
          var svg='<svg xmlns="http://www.w3.org/2000/svg" width="'+width+'" height="'+height+'"><foreignObject width="100%" height="100%">'+html+'</foreignObject></svg>';
          var img=new Image();
          img.onload=function(){
            try{
              var canvas=document.createElement('canvas');
              canvas.width=width;
              canvas.height=height;
              var ctx=canvas.getContext('2d');
              if(!ctx)throw new Error('Canvas is unavailable.');
              ctx.drawImage(img,0,0,width,height);
              send({type:'event',payload:{kind:'neuma-preview-snapshot',requestId:requestId,dataUrl:canvas.toDataURL('image/png'),width:width,height:height}});
            }catch(err){
              send({type:'event',payload:{kind:'neuma-preview-snapshot',requestId:requestId,dataUrl:'',width:width,height:height,error:String(err&&err.message||err)}});
            }
          };
          img.onerror=function(){
            send({type:'event',payload:{kind:'neuma-preview-snapshot',requestId:requestId,dataUrl:'',width:width,height:height,error:'Snapshot render failed.'}});
          };
          img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);
        }catch(err){
          send({type:'event',payload:{kind:'neuma-preview-snapshot',requestId:requestId,dataUrl:'',width:width,height:height,error:String(err&&err.message||err)}});
        }
        return;
      }
      if(data.nonce!==N||data.type!=='neuma-inspect-style')return;
      var patch=data.patch||{};
      if(!patch.id||PROPS.indexOf(patch.prop)===-1)return;
      var el=null;
      var nodes=document.querySelectorAll('[data-neuma-id]');
      for(var i=0;i<nodes.length;i++){
        if(nodes[i].getAttribute('data-neuma-id')===String(patch.id)){
          el=nodes[i];
          break;
        }
      }
      if(!el)return;
      el.style[patch.prop]=String(patch.value||'');
      selectTarget(el);
      postSize();
    });
    window.addEventListener('load',function(){
      send({type:'ready'});
      postTargetList();
      postSize();
      var raf=window.requestAnimationFrame||function(fn){return setTimeout(fn,16);};
      raf(function(){raf(function(){
        postShellReady();
        // Nudge artifacts that size canvases/charts from layout: many call their
        // draw once at parse time when clientWidth is still 0, then redraw on
        // resize. Now that layout has settled, fire a resize so they paint.
        try{window.dispatchEvent(new Event('resize'));}catch(_){}
      });});
      try{
        var ro=new ResizeObserver(function(){postSize();});
        ro.observe(document.documentElement);
        if(document.body)ro.observe(document.body);
      }catch(_){}
    });
  })();</script>`;
}

function inspectBridgeCss(mode: SelectBridgeMode): string {
  if (mode === 'off') return '';
  return (
    '[data-neuma-id]{outline-offset:2px;}' +
    '[data-neuma-id]:hover{outline:2px solid rgba(59,130,246,.7);cursor:crosshair;}' +
    '[data-neuma-inspect-selected="true"]{outline:2px solid rgb(37,99,235)!important;}'
  );
}

export function wrapHtmlSrcdoc(
  body: string,
  nonce: string,
  mode: SelectBridgeMode = 'off',
  options: {
    paletteBridge?: string;
    initialPalette?: object;
  } = {},
): string {
  const paletteScript = options.paletteBridge
    ? `<script>${options.paletteBridge.replaceAll(
        '__NEUMA_PALETTE_NONCE__',
        nonce.replace(/\\/g, '\\\\').replace(/"/g, '\\"'),
      )}</script>`
    : '';
  const initialPaletteScript = options.initialPalette
    ? `<script>window.postMessage(Object.assign({nonce:${JSON.stringify(
        nonce,
      )}},${JSON.stringify(options.initialPalette)}),'*');</script>`
    : '';
  const annotatedBody = annotateMissingNeumaIds(body);
  return (
    '<!doctype html><html><head>' +
    `<meta http-equiv="Content-Security-Policy" content="${SANDBOX_CSP}">` +
    '<meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    paletteScript +
    '<style>html,body{margin:0;padding:8px;font-family:system-ui,sans-serif;color-scheme:light dark;}body{background:transparent;}</style>' +
    `<style>${inspectBridgeCss(mode)}</style>` +
    '</head><body>' +
    bootstrapScript(nonce, mode) +
    annotatedBody +
    initialPaletteScript +
    '</body></html>'
  );
}

/**
 * Build an iframe srcdoc from a FULL HTML document (artifact already has its own
 * `<html>/<head>/<body>`). Instead of nesting it inside a wrapper body — which
 * leaves the artifact's scripts in a malformed nested document where they don't
 * execute — inject the CSP, bridge styles, and bootstrap into the artifact's own
 * head/body, keeping it a single well-formed document that renders and runs
 * exactly like a standalone file. Used for trusted local artifacts (DesignMode
 * prototypes) where styles + canvas charts must render.
 */
export function wrapFullDocumentSrcdoc(
  fullHtml: string,
  nonce: string,
  mode: SelectBridgeMode = 'off',
  options: {
    paletteBridge?: string;
    initialPalette?: object;
  } = {},
): string {
  const paletteScript = options.paletteBridge
    ? `<script>${options.paletteBridge.replaceAll(
        '__NEUMA_PALETTE_NONCE__',
        nonce.replace(/\\/g, '\\\\').replace(/"/g, '\\"'),
      )}</script>`
    : '';
  const initialPaletteScript = options.initialPalette
    ? `<script>window.postMessage(Object.assign({nonce:${JSON.stringify(
        nonce,
      )}},${JSON.stringify(options.initialPalette)}),'*');</script>`
    : '';
  const bridgeCss = inspectBridgeCss(mode);
  const headInject =
    `<meta http-equiv="Content-Security-Policy" content="${SANDBOX_CSP}">` +
    paletteScript +
    (bridgeCss ? `<style>${bridgeCss}</style>` : '');
  // Bootstrap goes last in <body> so its load/resize hooks fire after the
  // artifact has registered its own listeners.
  const bodyInject = bootstrapScript(nonce, mode) + initialPaletteScript;

  // NOTE: do NOT run annotateMissingNeumaIds here — it reparses as a body
  // fragment (`parsed.body.innerHTML`) and would mangle a full document's
  // <head> (dropping styles, displacing the CSP meta). Full-document inspect
  // targeting is out of scope; Preview just needs the document intact.
  let out = fullHtml;
  if (/<head[^>]*>/i.test(out)) {
    out = out.replace(/<head[^>]*>/i, (m) => m + headInject);
  } else if (/<html[^>]*>/i.test(out)) {
    out = out.replace(/<html[^>]*>/i, (m) => `${m}<head>${headInject}</head>`);
  } else {
    out = `${headInject}${out}`;
  }
  if (/<\/body>/i.test(out)) {
    out = out.replace(/<\/body>/i, `${bodyInject}</body>`);
  } else {
    out = `${out}${bodyInject}`;
  }
  return out;
}

export function wrapSvgSrcdoc(svg: string, nonce: string): string {
  return wrapHtmlSrcdoc(
    `<div style="display:flex;align-items:center;justify-content:center;width:100%;">${svg}</div>`,
    nonce,
  );
}

export function generateNonce(): string {
  return randomUUID();
}
