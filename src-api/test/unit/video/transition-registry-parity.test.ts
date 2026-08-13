import { describe, expect, it } from 'vitest';

import {
  transitionQualityEntry,
  transitionPrefersRemotionFinalRender,
  transitionRendererQuality,
  TRANSITION_QUALITY_MATRIX,
} from '@/shared/video/transition-quality';
import {
  normalizeTransition,
  VIDEO_TRANSITION_REGISTRY as apiRegistry,
} from '@/shared/video/types';

import {
  normalizeVideoTransition,
  VIDEO_TRANSITION_REGISTRY as uiRegistry,
} from '../../../../src/shared/types/video';

describe('video transition registry parity', () => {
  it('keeps frontend and backend transition capabilities in sync', () => {
    expect(registryShape(apiRegistry)).toEqual(registryShape(uiRegistry));
  });

  it('ships the Phase 23.6 transition catalog', () => {
    expect(apiRegistry.map((entry) => entry.kind)).toEqual([
      'cut',
      'fade',
      'slide',
      'wipe',
      'iris',
      'dissolve',
      'soft-wipe',
      'pixelize',
      'polygon-iris',
      'cover',
      'reveal',
      'flip',
      'clock-wipe',
      'cube',
      'zoom-blur',
      'zoom-in-out',
    ]);
  });

  it('pins editor preset metadata for transition previews', () => {
    expect(
      Object.fromEntries(
        apiRegistry.map((entry) => [entry.kind, entry.webglPreview]),
      ),
    ).toEqual({
      cut: 'none',
      fade: 'native',
      slide: 'native',
      wipe: 'native',
      iris: 'native',
      dissolve: 'native',
      'soft-wipe': 'native',
      pixelize: 'native',
      'polygon-iris': 'native',
      cover: 'native',
      reveal: 'native',
      flip: 'native',
      'clock-wipe': 'native',
      cube: 'native',
      'zoom-blur': 'native',
      'zoom-in-out': 'native',
    });
  });

  it('publishes an executable transition quality matrix', () => {
    expect(TRANSITION_QUALITY_MATRIX.map((entry) => entry.kind)).toEqual(
      apiRegistry.map((entry) => entry.kind),
    );

    expect(matrixEntry('dissolve')).toMatchObject({
      ffmpeg: { support: 'native' },
      remotion: { support: 'native' },
      webgl: { support: 'native' },
    });
    expect(matrixEntry('cube')).toMatchObject({
      ffmpeg: { fallbackKind: 'fade', support: 'fallback' },
      remotion: { support: 'custom' },
      webgl: { support: 'native' },
    });
    expect(matrixEntry('clock-wipe')).toMatchObject({
      ffmpeg: { support: 'native' },
      remotion: { support: 'custom' },
      webgl: { support: 'native' },
    });
    expect(matrixEntry('soft-wipe')).toMatchObject({
      ffmpeg: { support: 'native' },
      remotion: { support: 'native' },
      webgl: { support: 'native' },
    });
    expect(matrixEntry('pixelize')).toMatchObject({
      ffmpeg: { support: 'native' },
      remotion: { fallbackKind: 'dissolve', support: 'fallback' },
      webgl: { support: 'native' },
    });
    expect(matrixEntry('polygon-iris')).toMatchObject({
      ffmpeg: {
        fallbackKind: 'iris',
        support: 'fallback',
        unsupportedParams: ['sides'],
      },
      remotion: {
        fallbackKind: 'iris',
        support: 'fallback',
        unsupportedParams: ['sides'],
      },
      webgl: { support: 'native' },
    });
  });

  it('throws a clear error for unknown transition quality kinds', () => {
    expect(() =>
      transitionQualityEntry(
        'future-transition' as (typeof apiRegistry)[number]['kind'],
      ),
    ).toThrow('Unknown transition kind: future-transition');
  });

  it('evaluates renderer quality from normalized params', () => {
    expect(transitionRendererQuality({ kind: 'pixelize' }, 'ffmpeg')).toEqual({
      support: 'native',
    });
    expect(
      transitionRendererQuality(
        { kind: 'pixelize', params: { steps: 12 } },
        'ffmpeg',
      ),
    ).toEqual({
      fallbackKind: 'pixelize',
      support: 'fallback',
      unsupportedParams: ['steps'],
    });
    expect(
      transitionPrefersRemotionFinalRender({
        kind: 'pixelize',
        params: { steps: 12 },
      }),
    ).toBe(false);
    expect(
      transitionRendererQuality(
        { kind: 'soft-wipe', params: { angle: 90, reverse: true } },
        'ffmpeg',
      ),
    ).toEqual({ support: 'native' });
    expect(
      transitionRendererQuality(
        { kind: 'soft-wipe', params: { angle: 45 } },
        'ffmpeg',
      ),
    ).toEqual({
      fallbackKind: 'wipe',
      support: 'fallback',
      unsupportedParams: ['angle'],
    });
    expect(
      transitionPrefersRemotionFinalRender({
        kind: 'soft-wipe',
        params: { angle: 45 },
      }),
    ).toBe(false);
    expect(
      transitionPrefersRemotionFinalRender({
        kind: 'clock-wipe',
        params: { sweep: 'counterclockwise' },
      }),
    ).toBe(true);
    expect(
      transitionRendererQuality(
        { kind: 'polygon-iris', params: { sides: 5 } },
        'ffmpeg',
      ),
    ).toEqual({
      fallbackKind: 'iris',
      support: 'fallback',
      unsupportedParams: ['sides'],
    });
  });

  it('normalizes transition params consistently across frontend and backend', () => {
    const rawTransition = {
      kind: 'clock-wipe',
      params: {
        center: [2, -1],
        edgeColor: [2, -1, 0.5, 2],
        extra: 1,
        sectors: 3.6,
        startAngle: -10,
        sweep: 'sideways',
      },
      timing: {
        durationMs: 640.6,
        easing: 'ease-out',
        holdPct: 2,
      },
    } as const;

    expect(normalizeVideoTransition(rawTransition)).toEqual(
      normalizeTransition(rawTransition),
    );
    expect(normalizeTransition(rawTransition)).toEqual({
      kind: 'clock-wipe',
      durationMs: 641,
      timing: {
        durationMs: 641,
        easing: 'ease-out',
        holdPct: 1,
      },
      params: {
        center: [1, 0],
        edgeColor: [1, 0, 0.5, 1],
        sectors: 4,
        startAngle: 0,
      },
    });
  });

  it('drops invalid param values and preserves legacy transition specs', () => {
    const invalidParams = {
      kind: 'clock-wipe',
      durationMs: 700,
      params: {
        center: [0.25],
        edgeColor: [1, 0, 0],
        sectors: Number.POSITIVE_INFINITY,
        startAngle: '90',
        sweep: 'diagonal',
      },
      timing: {
        easing: 'elastic',
      },
    } as const;

    expect(normalizeVideoTransition(invalidParams)).toEqual(
      normalizeTransition(invalidParams),
    );
    expect(normalizeTransition(invalidParams)).toEqual({
      kind: 'clock-wipe',
      durationMs: 700,
    });
    expect(normalizeTransition({ kind: 'fade', durationMs: 500 })).toEqual({
      kind: 'fade',
      durationMs: 500,
    });
  });
});

function matrixEntry(kind: string) {
  return TRANSITION_QUALITY_MATRIX.find((entry) => entry.kind === kind);
}

function registryShape(
  registry: typeof apiRegistry | typeof uiRegistry,
): Array<Record<string, unknown>> {
  return registry.map((entry) => ({
    kind: entry.kind,
    tier: entry.tier,
    native: [...entry.native],
    fallbackFor: { ...entry.fallbackFor },
    directions: [...entry.directions],
    labelKey: entry.labelKey,
    group: entry.group,
    descriptionKey: entry.descriptionKey,
    defaultDurationMs: entry.defaultDurationMs,
    minDurationMs: entry.minDurationMs,
    maxDurationMs: entry.maxDurationMs,
    webglPreview: entry.webglPreview,
    recommendedUse: entry.recommendedUse,
    paramDefs: entry.paramDefs
      ? entry.paramDefs.map((definition) => ({ ...definition }))
      : undefined,
    timingDefs: entry.timingDefs ? { ...entry.timingDefs } : undefined,
  }));
}
