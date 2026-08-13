import { describe, expect, it } from 'vitest';

import {
  type FrameSeedHashInput,
  hashHtmlFrameSeed,
} from '@/shared/video/content-graph/frame-seed-hash';

const baseInput: FrameSeedHashInput = {
  seed: {
    nodeId: 'intro',
    templateId: 'frame-bold',
    engine: 'html',
    variables: { title: 'Hi', count: 3 },
  },
  templateSourcePath: '/tpl/frame-bold/source/index.html',
  templateVersion: '0.1.0',
  engineVersion: 'html-playwright/0.1.0',
  resolution: { width: 1280, height: 720 },
  fps: 30,
  durationSec: 4,
};

describe('hashHtmlFrameSeed', () => {
  it('produces a 16-char lowercase hex', () => {
    const hash = hashHtmlFrameSeed(baseInput);
    expect(hash).toMatch(/^[a-f0-9]{16}$/);
  });

  it('is deterministic across calls', () => {
    expect(hashHtmlFrameSeed(baseInput)).toBe(hashHtmlFrameSeed(baseInput));
  });

  it('canonicalises object-key order in variables', () => {
    const reordered: FrameSeedHashInput = {
      ...baseInput,
      seed: {
        ...baseInput.seed,
        variables: { count: 3, title: 'Hi' }, // same content, different key order
      },
    };
    expect(hashHtmlFrameSeed(reordered)).toBe(hashHtmlFrameSeed(baseInput));
  });

  it('preserves array order in variables (semantically ordered)', () => {
    const a: FrameSeedHashInput = {
      ...baseInput,
      seed: { ...baseInput.seed, variables: { list: [1, 2, 3] } },
    };
    const b: FrameSeedHashInput = {
      ...baseInput,
      seed: { ...baseInput.seed, variables: { list: [3, 2, 1] } },
    };
    expect(hashHtmlFrameSeed(a)).not.toBe(hashHtmlFrameSeed(b));
  });

  it('changes when any keyed input changes', () => {
    const base = hashHtmlFrameSeed(baseInput);
    expect(hashHtmlFrameSeed({ ...baseInput, fps: 60 })).not.toBe(base);
    expect(
      hashHtmlFrameSeed({
        ...baseInput,
        resolution: { width: 1920, height: 1080 },
      }),
    ).not.toBe(base);
    expect(
      hashHtmlFrameSeed({
        ...baseInput,
        seed: { ...baseInput.seed, variables: { title: 'Bye' } },
      }),
    ).not.toBe(base);
    expect(
      hashHtmlFrameSeed({
        ...baseInput,
        engineVersion: 'html-playwright/0.2.0',
      }),
    ).not.toBe(base);
    expect(
      hashHtmlFrameSeed({ ...baseInput, templateVersion: '0.2.0' }),
    ).not.toBe(base);
    expect(
      hashHtmlFrameSeed({
        ...baseInput,
        seed: {
          ...baseInput.seed,
          renderOverride: {
            mode: 'native',
            templateId: 'frame-data-rollup',
            engine: 'remotion',
          },
        },
      }),
    ).not.toBe(base);
  });

  it('treats missing injectionNonce as a stable variant (cache-friendly)', () => {
    const { injectionNonce: _drop, ...without } = baseInput;
    expect(hashHtmlFrameSeed(without)).toBe(hashHtmlFrameSeed(without));
    // With + without nonce produce different hashes (the nonce is meant to
    // tie the inputHash to a specific render run).
    expect(hashHtmlFrameSeed({ ...without, injectionNonce: 'abc' })).not.toBe(
      hashHtmlFrameSeed(without),
    );
  });
});
