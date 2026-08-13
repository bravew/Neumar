import {
  VIVID_OVERLAY_LOTTIE_ASSETS,
  vividOverlayDocument,
} from './overlay-documents.js';
import {
  compileOverlayDocument,
  compileGeneratedOverlayDocument,
} from './overlay-html.js';
import type { VividOverlayBackendId } from './overlay-types.js';
import { LOTTIE_LIGHT_SOURCE } from './vendor/lottie-light.js';

// Generated overlay documents for the gif and lottie backends. Instead of
// bespoke canvas renderers per surface, both backends compile to the SAME
// self-contained HTML documents the html backend uses — the layered preview,
// the Remotion composition, and the alpha overlay pass then render them with
// zero backend-specific code. Documents draw synchronously inside the shim's
// 'neuma-overlay-seek' event, so they stay pure functions of time.

export interface VividOverlaySourceAsset {
  base64: string;
  mimeType?: string;
}

const LOTTIE_DOCUMENT_ID_PREFIX = 'lottie:';

/**
 * Resolve a preset's COMPILED overlay document across every backend:
 * html/text-motion → authored documents (linted compile), lottie → generated
 * document around a first-party animation, gif → generated document around
 * the caller-loaded asset bytes. Callers cache by
 * `${backend}|${documentId}|${assetKey}` and instantiate with controls.
 */
export function compiledVividOverlayDocumentSource(input: {
  backend: VividOverlayBackendId;
  documentId?: string;
  sourceAsset?: VividOverlaySourceAsset;
}): string | null {
  switch (input.backend) {
    case 'html':
    case 'text-motion': {
      if (!input.documentId) return null;
      const source = vividOverlayDocument(input.documentId);
      return source ? compileOverlayDocument(source).html : null;
    }
    case 'lottie': {
      if (input.sourceAsset) {
        try {
          return lottieOverlayDocument({
            animationJson: decodeBase64Utf8(input.sourceAsset.base64),
          });
        } catch {
          return null;
        }
      }
      if (!input.documentId?.startsWith(LOTTIE_DOCUMENT_ID_PREFIX)) {
        return null;
      }
      const animationJson =
        VIVID_OVERLAY_LOTTIE_ASSETS[
          input.documentId.slice(LOTTIE_DOCUMENT_ID_PREFIX.length)
        ];
      return animationJson ? lottieOverlayDocument({ animationJson }) : null;
    }
    case 'gif': {
      return input.sourceAsset ? gifOverlayDocument(input.sourceAsset) : null;
    }
    default:
      return null;
  }
}

/**
 * GIF sticker document. Frames are pre-decoded (WebCodecs ImageDecoder) into
 * ImageBitmaps before the document reports ready, so every seek draws
 * synchronously from an array — deterministic under frame capture. Where
 * ImageDecoder is unavailable (older WebKit) the document degrades to the
 * first frame as a static image. The GIF loops on its intrinsic duration
 * (tMs modulo total delay), CapCut-sticker style.
 */
export function gifOverlayDocument(input: {
  base64: string;
  mimeType?: string;
}): string {
  const mime = input.mimeType ?? 'image/gif';
  const body = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; width: 100%; height: 100%; background: transparent; overflow: hidden; }
  canvas, img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; }
</style>
</head>
<body>
  <canvas></canvas>
  <script>
    (function () {
      var B64 = '${input.base64}';
      var MIME = '${mime}';
      var canvas = document.querySelector('canvas');
      var frames = [];
      var delaysMs = [];
      var totalMs = 0;

      function bytes() {
        var bin = atob(B64);
        var out = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
      }

      function draw(bitmap) {
        var ctx = canvas.getContext('2d');
        if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
        }
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(bitmap, 0, 0);
      }

      function frameIndexAtMs(tMs) {
        if (totalMs <= 0) return 0;
        var local = tMs % totalMs;
        var acc = 0;
        for (var i = 0; i < delaysMs.length; i++) {
          acc += delaysMs[i];
          if (local < acc) return i;
        }
        return delaysMs.length - 1;
      }

      async function decodeAll() {
        if (typeof ImageDecoder === 'undefined') {
          // Static degradation: first frame via <img> (blob: allowed by CSP).
          var blob = new Blob([bytes()], { type: MIME });
          var img = document.createElement('img');
          img.src = URL.createObjectURL(blob);
          await img.decode();
          canvas.replaceWith(img);
          return;
        }
        var decoder = new ImageDecoder({ data: bytes(), type: MIME });
        await decoder.tracks.ready;
        var track = decoder.tracks.selectedTrack;
        var count = Math.min(track.frameCount || 1, 600);
        for (var i = 0; i < count; i++) {
          var result = await decoder.decode({ frameIndex: i });
          var frame = result.image;
          var delay = Math.max(20, Math.round((frame.duration || 100000) / 1000));
          frames.push(await createImageBitmap(frame));
          delaysMs.push(delay);
          totalMs += delay;
          frame.close();
        }
        decoder.close();
        if (frames.length > 0) draw(frames[0]);
      }

      document.addEventListener('neuma-overlay-seek', function (event) {
        if (frames.length === 0) return;
        draw(frames[frameIndexAtMs(event.detail.tMs)]);
      });

      window.__overlayReadyPromise = decodeAll();
      window.__overlayReady = true;
    })();
  </script>
</body>
</html>`;
  return compileGeneratedOverlayDocument(body);
}

/**
 * Lottie document: lottie_light (SVG renderer, vendored — CSP blocks network)
 * driven by goToAndStop on each seek, looping on the animation's intrinsic
 * duration. `goToAndStop(ms, false)` is deterministic per lottie-web docs and
 * the gsap-video-export precedent.
 */
export function lottieOverlayDocument(input: {
  animationJson: string;
}): string {
  const animationJson = safeJsonScriptLiteral(input.animationJson);
  const body = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; width: 100%; height: 100%; background: transparent; overflow: hidden; }
  #lottie { position: absolute; inset: 0; }
  #lottie svg { width: 100%; height: 100%; }
</style>
</head>
<body>
  <div id="lottie"></div>
  <script>${LOTTIE_LIGHT_SOURCE}</script>
  <script>
    (function () {
      var animationData = ${animationJson};
      var anim = window.lottie.loadAnimation({
        container: document.getElementById('lottie'),
        renderer: 'svg',
        loop: false,
        autoplay: false,
        animationData: animationData,
      });
      var totalMs = (anim.getDuration ? anim.getDuration(false) : 1) * 1000;
      anim.goToAndStop(0, false);
      document.addEventListener('neuma-overlay-seek', function (event) {
        var tMs = totalMs > 0 ? event.detail.tMs % totalMs : 0;
        anim.goToAndStop(tMs, false);
      });
      window.__overlayReady = true;
    })();
  </script>
</body>
</html>`;
  return compileGeneratedOverlayDocument(body);
}

function decodeBase64Utf8(base64: string): string {
  const binary = globalThis.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new TextDecoder().decode(bytes);
}

function safeJsonScriptLiteral(json: string): string {
  return JSON.stringify(JSON.parse(json)).replace(/</g, '\\u003c');
}
