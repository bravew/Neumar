import { describe, expect, it } from 'vitest';

import {
  classifyFile,
  formatJsonFileTextForDisplay,
  sketchScreenIdFromPath,
} from '@/components/design/file-viewer-utils';
import {
  computeSketchPreviewGeometry,
  parseSketchPreviewDocument,
} from '@/components/design/SketchPreview';

describe('design file viewer utilities', () => {
  it('pretty-prints safe JSON file previews', () => {
    expect(formatJsonFileTextForDisplay('artifacts/data.json', '{"b":1,"a":2}'))
      .toBe(`{
  "b": 1,
  "a": 2
}`);
  });

  it('preserves precision-sensitive JSON previews', () => {
    const unsafeInteger = '{"id":9007199254740993}';
    const signedZero = '{"offset":-0}';
    const decimal = '{"amount":0.1234567890123456789}';
    const exponent = '{"amount":1.234567890123456789e2}';

    expect(
      formatJsonFileTextForDisplay('artifacts/data.json', unsafeInteger),
    ).toBe(unsafeInteger);
    expect(
      formatJsonFileTextForDisplay('artifacts/data.json', signedZero),
    ).toBe(signedZero);
    expect(formatJsonFileTextForDisplay('artifacts/data.json', decimal)).toBe(
      decimal,
    );
    expect(formatJsonFileTextForDisplay('artifacts/data.json', exponent)).toBe(
      exponent,
    );
  });

  it('classifies sketch files and derives stable screen ids', () => {
    expect(classifyFile('sketches/hero.json')).toBe('sketch');
    expect(classifyFile('artifacts/wireframe.sketch.json')).toBe('sketch');
    expect(sketchScreenIdFromPath('sketches/hero.json')).toBe('hero');
    expect(sketchScreenIdFromPath('artifacts/index.html')).toBe(
      'artifacts-index-html',
    );
  });

  it('parses Neuma and sketch-json stroke previews defensively', () => {
    const neuma = parseSketchPreviewDocument(
      JSON.stringify({
        document: {
          strokes: [
            {
              tool: 'line',
              color: '#111111',
              width: 4,
              points: [
                { x: 10, y: 20 },
                { x: 100, y: 120 },
              ],
            },
          ],
        },
      }),
    );
    const imported = parseSketchPreviewDocument(
      JSON.stringify({
        items: [
          {
            kind: 'rect',
            color: '#222222',
            size: 3,
            x: 40,
            y: 50,
            w: 200,
            h: 100,
          },
        ],
      }),
    );

    expect(neuma).toEqual([
      expect.objectContaining({ kind: 'line', x1: 10, y1: 20 }),
    ]);
    expect(imported).toEqual([
      expect.objectContaining({ kind: 'rect', x: 40, y: 50 }),
    ]);
    expect(computeSketchPreviewGeometry([...neuma, ...imported]).width).toBe(
      1280,
    );
  });
});
