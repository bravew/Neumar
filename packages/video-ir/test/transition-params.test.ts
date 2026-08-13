import { describe, expect, it } from 'vitest';

import {
  compactResolvedTransitionParams,
  resolveTransitionParams,
  type TransitionParamDef,
} from '../src/transition-params.js';

const PARAM_DEFS = [
  {
    key: 'softness',
    type: 'number',
    defaultValue: 0.1,
    min: 0,
    max: 1,
    step: 0.01,
    labelKey: 'transitions.softness',
  },
  {
    key: 'steps',
    type: 'number',
    valueKind: 'int',
    defaultValue: 4,
    min: 1,
    max: 12,
    step: 1,
    labelKey: 'transitions.steps',
  },
  {
    key: 'reverse',
    type: 'boolean',
    defaultValue: false,
    labelKey: 'transitions.reverse',
  },
  {
    key: 'mode',
    type: 'enum',
    defaultValue: 'clockwise',
    options: ['clockwise', 'counterclockwise'],
    labelKey: 'transitions.mode',
  },
  {
    key: 'center',
    type: 'vec2',
    defaultValue: [0.5, 0.5],
    min: 0,
    max: 1,
    labelKey: 'transitions.center',
  },
  {
    key: 'edgeColor',
    type: 'color',
    defaultValue: [1, 1, 1, 1],
    labelKey: 'transitions.edgeColor',
  },
] as const satisfies readonly TransitionParamDef[];

describe('transition param resolution', () => {
  it('starts from defaults and applies valid user values', () => {
    const resolved = resolveTransitionParams(
      { paramDefs: PARAM_DEFS },
      {
        center: [0.2, 0.8],
        edgeColor: [0.1, 0.2, 0.3, 0.4],
        mode: 'counterclockwise',
        reverse: true,
        softness: 0.35,
        steps: 7,
      },
    );

    expect(resolved).toEqual({
      values: {
        center: [0.2, 0.8],
        edgeColor: [0.1, 0.2, 0.3, 0.4],
        mode: 'counterclockwise',
        reverse: true,
        softness: 0.35,
        steps: 7,
      },
      unsupportedKeys: [],
      clampedKeys: [],
    });
  });

  it('drops unknown keys and resolves invalid values to defaults', () => {
    const resolved = resolveTransitionParams(
      { paramDefs: PARAM_DEFS },
      {
        center: { x: 0.1, y: 0.2 },
        extra: 1,
        mode: 'diagonal',
        reverse: 'yes',
        softness: Number.NaN,
      },
    );

    expect(resolved.values).toEqual({
      center: [0.5, 0.5],
      edgeColor: [1, 1, 1, 1],
      mode: 'clockwise',
      reverse: false,
      softness: 0.1,
      steps: 4,
    });
    expect(resolved.unsupportedKeys).toEqual(['extra']);
    expect(resolved.clampedKeys).toEqual([]);
  });

  it('clamps finite numeric, vector, and color values', () => {
    const resolved = resolveTransitionParams(
      { paramDefs: PARAM_DEFS },
      {
        center: [1.5, -0.5],
        edgeColor: [2, -1, 0.5, 4],
        softness: 2,
        steps: 3.6,
      },
    );

    expect(resolved.values).toMatchObject({
      center: [1, 0],
      edgeColor: [1, 0, 0.5, 1],
      softness: 1,
      steps: 4,
    });
    expect(resolved.clampedKeys).toEqual([
      'center',
      'edgeColor',
      'softness',
      'steps',
    ]);
  });

  it('compacts defaults out of normalized specs', () => {
    const resolved = resolveTransitionParams(
      { paramDefs: PARAM_DEFS },
      {
        center: [0.5, 0.5],
        reverse: true,
        steps: 4,
      },
    );

    expect(
      compactResolvedTransitionParams(
        { paramDefs: PARAM_DEFS },
        resolved.values,
      ),
    ).toEqual({
      reverse: true,
    });
  });
});
