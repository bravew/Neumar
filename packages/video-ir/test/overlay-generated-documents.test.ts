import { describe, expect, it } from 'vitest';

import {
  compiledVividOverlayDocumentSource,
  gifOverlayDocument,
  instantiateOverlayDocument,
  lintOverlayDocument,
  lottieOverlayDocument,
  MOTION_ANYTHING_LOTTIE_ASSET_METADATA,
  VIVID_OVERLAY_DOCUMENTS,
  VIVID_OVERLAY_LOTTIE_ASSETS,
} from '../src';

const TINY_GIF_BASE64 =
  'R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==';

describe('generated overlay documents', () => {
  it('gif documents embed the asset, the decoder, and the seek scaffold', () => {
    const doc = gifOverlayDocument({ base64: TINY_GIF_BASE64 });
    expect(doc).toContain(TINY_GIF_BASE64);
    expect(doc).toContain('ImageDecoder');
    expect(doc).toContain('neuma-overlay-seek');
    expect(doc).toContain('__overlayReadyPromise');
    expect(doc).toContain('__neumaOverlaySeek'); // shim injected
    expect(doc).toContain('Content-Security-Policy');
    expect(doc).toContain('<!--neuma-overlay-params-->');
  });

  it('lottie documents inline the vendored runtime and loop intrinsically', () => {
    const doc = lottieOverlayDocument({
      animationJson: VIVID_OVERLAY_LOTTIE_ASSETS['pulse-badge']!,
    });
    expect(doc).toContain('lottie');
    expect(doc).toContain('goToAndStop');
    expect(doc).toContain('pulse-badge');
    expect(doc).toContain('__neumaOverlaySeek');
    expect(doc).toContain('Content-Security-Policy');
  });

  it('generated documents are deterministic strings', () => {
    const a = gifOverlayDocument({ base64: TINY_GIF_BASE64 });
    const b = gifOverlayDocument({ base64: TINY_GIF_BASE64 });
    expect(a).toBe(b);
  });
});

describe('compiledVividOverlayDocumentSource', () => {
  it('routes html and text-motion to authored documents', () => {
    expect(
      compiledVividOverlayDocumentSource({
        backend: 'html',
        documentId: 'marker-highlight',
      }),
    ).toContain('hl-sweep');
    expect(
      compiledVividOverlayDocumentSource({
        backend: 'text-motion',
        documentId: 'title-pop',
      }),
    ).toContain('word-pop');
  });

  it('routes lottie documentIds to first-party animations', () => {
    expect(
      compiledVividOverlayDocumentSource({
        backend: 'lottie',
        documentId: 'lottie:pulse-badge',
      }),
    ).toContain('goToAndStop');
    expect(
      compiledVividOverlayDocumentSource({
        backend: 'lottie',
        documentId: 'lottie:missing',
      }),
    ).toBeNull();
  });

  it('routes extracted motion-anything Lottie recipes to overlay documents', () => {
    expect(Object.keys(MOTION_ANYTHING_LOTTIE_ASSET_METADATA)).toEqual([
      'motion-anything/lottie-favorite',
      'motion-anything/lottie-fab',
      'motion-anything/lottie-pagination',
      'motion-anything/lottie-tab',
    ]);
    for (const [assetId, meta] of Object.entries(
      MOTION_ANYTHING_LOTTIE_ASSET_METADATA,
    )) {
      const doc = compiledVividOverlayDocumentSource({
        backend: 'lottie',
        documentId: `lottie:${assetId}`,
      });
      const animationJson = VIVID_OVERLAY_LOTTIE_ASSETS[assetId]!;
      const animationName = JSON.parse(animationJson).nm;
      expect(animationJson).not.toContain('"u":"images/"');
      expect(doc).toContain('goToAndStop');
      expect(doc).toContain('__neumaOverlaySeek');
      expect(doc).toContain(animationName);
      expect(meta.durationMs).toBeGreaterThan(0);
      expect(meta.license).toMatchObject({
        spdx: 'MIT',
        attributionRequired: true,
      });
    }
  });

  it('routes lottie source assets to caller-provided animation JSON', () => {
    const animationJson = JSON.stringify({
      v: '5.7.4',
      fr: 30,
      ip: 0,
      op: 30,
      w: 128,
      h: 128,
      nm: 'local-clock',
      ddd: 0,
      assets: [],
      layers: [],
    });
    const doc = compiledVividOverlayDocumentSource({
      backend: 'lottie',
      sourceAsset: { base64: btoa(animationJson) },
    });
    expect(doc).toContain('goToAndStop');
    expect(doc).toContain('local-clock');
    expect(doc).toContain('__neumaOverlaySeek');
  });

  it('gif requires the caller-provided asset', () => {
    expect(compiledVividOverlayDocumentSource({ backend: 'gif' })).toBeNull();
    const doc = compiledVividOverlayDocumentSource({
      backend: 'gif',
      sourceAsset: { base64: TINY_GIF_BASE64 },
    });
    expect(doc).toContain(TINY_GIF_BASE64);
    // instantiation works on generated docs (placeholder present)
    expect(instantiateOverlayDocument(doc!, { controls: {} })).toContain(
      'window.__overlayParams',
    );
  });
});

describe('authored documents stay contract-compliant', () => {
  it('all authored documents (incl. title-pop) pass the lint', () => {
    for (const [id, doc] of Object.entries(VIVID_OVERLAY_DOCUMENTS)) {
      expect({ id, issues: lintOverlayDocument(doc) }).toEqual({
        id,
        issues: [],
      });
    }
  });
});
