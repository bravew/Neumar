import { describe, expect, it } from 'vitest';

import {
  compiledVividOverlayDocumentSource,
  instantiateOverlayDocument,
  lintOverlayDocument,
  VIVID_OVERLAY_DOCUMENTS,
  VIVID_OVERLAY_LOTTIE_ASSETS,
} from '../src';

// Registry-wide authoring-contract gate: every built-in document must pass
// the lint and instantiate cleanly. The preset catalog itself lives in the
// app layers (pinned by the src-api parity test); this covers the documents.

describe('vivid overlay catalog documents', () => {
  it('every authored html/text-motion document passes the lint', () => {
    for (const [documentId, source] of Object.entries(
      VIVID_OVERLAY_DOCUMENTS,
    )) {
      const errors = lintOverlayDocument(source).filter(
        (issue) => issue.severity === 'error',
      );
      expect(errors, documentId).toEqual([]);
    }
  });

  it('every authored document compiles and instantiates with empty controls', () => {
    for (const documentId of Object.keys(VIVID_OVERLAY_DOCUMENTS)) {
      const compiled = compiledVividOverlayDocumentSource({
        backend: 'html',
        documentId,
      });
      expect(compiled, documentId).toBeTruthy();
      const instantiated = instantiateOverlayDocument(compiled!, {
        controls: {},
        widthPx: 1920,
        heightPx: 1080,
        fps: 30,
      });
      expect(instantiated, documentId).toContain('__overlayParams');
      expect(instantiated, documentId).toContain('__overlayReady');
    }
  });

  it('every bundled lottie asset is valid JSON with finite duration', () => {
    for (const [name, json] of Object.entries(VIVID_OVERLAY_LOTTIE_ASSETS)) {
      const parsed = JSON.parse(json) as {
        op: number;
        fr: number;
        layers: unknown[];
      };
      expect(parsed.op, name).toBeGreaterThan(0);
      expect(parsed.fr, name).toBeGreaterThan(0);
      expect(parsed.layers.length, name).toBeGreaterThan(0);
    }
  });
});
