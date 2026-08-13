import { resolveTransitionParams } from '@neumar/video-ir';

import type {
  VideoTransitionDirection,
  VideoTransitionKind,
  VideoTransitionSpec,
} from '@/shared/types/video';
import {
  normalizeVideoTransition,
  videoTransitionRegistryEntry,
} from '@/shared/types/video';

import type { TransitionShaderSpec } from './WebGLTransitionRenderer';

/*
 * Shader fragments are adapted from gl-transitions
 * https://github.com/gl-transitions/gl-transitions
 * License: MIT, copyright 2017-present gl-transitions contributors.
 * Individual author/license headers are preserved in each fragment.
 */

const FADE_FRAGMENT = `
// Author: gre
// License: MIT

vec4 transition(vec2 uv) {
  return mix(
    getFromColor(uv),
    getToColor(uv),
    progress
  );
}
`;

const DISSOLVE_FRAGMENT = `
// Author: hjm1fb
// License: MIT

uniform float uLineWidth;
uniform vec3 uSpreadClr;
uniform vec3 uHotClr;
uniform float uPow;
uniform float uIntensity;

vec2 hash(vec2 p)
{
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
}

float noise(in vec2 p) {
  const float K1 = 0.366025404;
  const float K2 = 0.211324865;

  vec2 i = floor(p + (p.x + p.y) * K1);
  vec2 a = p - i + (i.x + i.y) * K2;
  float m = step(a.y, a.x);
  vec2 o = vec2(m, 1.0 - m);
  vec2 b = a - o + K2;
  vec2 c = a - 1.0 + 2.0 * K2;
  vec3 h = max(0.5 - vec3(dot(a, a), dot(b, b), dot(c, c)), 0.0);
  vec3 n = h * h * h * h * vec3(dot(a, hash(i + 0.0)), dot(b, hash(i + o)), dot(c, hash(i + 1.0)));
  return dot(n, vec3(70.0));
}

vec4 transition(vec2 uv) {
  vec4 from = getFromColor(uv);
  vec4 to = getToColor(uv);
  vec4 outColor;
  float burn;
  burn = 0.5 + 0.5 * (0.299 * from.r + 0.587 * from.g + 0.114 * from.b);

  float show = burn - progress;
  if (show < 0.001) {
    outColor = to;
  } else {
    float factor = 1.0 - smoothstep(0.0, uLineWidth, show);
    vec3 burnColor = mix(uSpreadClr, uHotClr, factor);
    burnColor = pow(burnColor, vec3(uPow)) * uIntensity;
    vec3 finalRGB = mix(from.rgb, burnColor, factor * step(0.0001, progress));
    outColor = vec4(finalRGB * from.a, from.a);
  }
  return outColor;
}
`;

const WIPE_LEFT_FRAGMENT = `
// Author: Jake Nelson
// License: MIT

vec4 transition(vec2 uv) {
  vec2 p = uv.xy / vec2(1.0).xy;
  vec4 a = getFromColor(p);
  vec4 b = getToColor(p);
  return mix(a, b, step(1.0 - p.x, progress));
}
`;

const WIPE_RIGHT_FRAGMENT = `
// Author: Jake Nelson
// License: MIT

vec4 transition(vec2 uv) {
  vec2 p = uv.xy / vec2(1.0).xy;
  vec4 a = getFromColor(p);
  vec4 b = getToColor(p);
  return mix(a, b, step(p.x, progress));
}
`;

const WIPE_UP_FRAGMENT = `
// Author: Jake Nelson
// License: MIT

vec4 transition(vec2 uv) {
  vec2 p = uv.xy / vec2(1.0).xy;
  vec4 a = getFromColor(p);
  vec4 b = getToColor(p);
  return mix(a, b, step(p.y, progress));
}
`;

const WIPE_DOWN_FRAGMENT = `
// Author: Jake Nelson
// License: MIT

vec4 transition(vec2 uv) {
  vec2 p = uv.xy / vec2(1.0).xy;
  vec4 a = getFromColor(p);
  vec4 b = getToColor(p);
  return mix(a, b, step(1.0 - p.y, progress));
}
`;

const SLIDES_FRAGMENT = `
// Author: Mark Craig
// License: MIT

uniform int type;
uniform bool In;

#define rad2 rad / 2.0

vec4 transition(vec2 uv)
{
  vec2 uv0 = uv;
  float rad = In ? progress : 1.0 - progress;
  float xc1, yc1;
  if (type == 0) { xc1 = .5 - rad2; yc1 = 0.0; }
  else if (type == 1) { xc1 = 1.0 - rad; yc1 = .5 - rad2; }
  else if (type == 2) { xc1 = .5 - rad2; yc1 = 1.0 - rad; }
  else if (type == 3) { xc1 = 0.0; yc1 = .5 - rad2; }
  else if (type == 4) { xc1 = 1.0 - rad; yc1 = 0.0; }
  else if (type == 5) { xc1 = 1.0 - rad; yc1 = 1.0 - rad; }
  else if (type == 6) { xc1 = 0.0; yc1 = 1.0 - rad; }
  else if (type == 7) { xc1 = 0.0; yc1 = 0.0; }
  else if (type == 8) { xc1 = .5 - rad2; yc1 = .5 - rad2; }
  uv.y = 1.0 - uv.y;
  vec2 uv2;
  if ((uv.x >= xc1) && (uv.x <= xc1 + rad) && (uv.y >= yc1) && (uv.y <= yc1 + rad))
  {
    uv2 = vec2((uv.x - xc1) / rad, 1.0 - (uv.y - yc1) / rad);
    return In ? getToColor(uv2) : getFromColor(uv2);
  }
  return In ? getFromColor(uv0) : getToColor(uv0);
}
`;

const ANGULAR_FRAGMENT = `
// Author: Neuma
// License: MIT

#define PI 3.141592653589793
#define TWO_PI 6.283185307179586

uniform float startingAngle;
uniform int sectors;
uniform float feather;
uniform vec2 center;
uniform vec4 edgeColor;
uniform int sweepDirection;

vec4 transition(vec2 uv) {
  if (progress <= 0.0) return getFromColor(uv);
  if (progress >= 1.0) return getToColor(uv);

  float offset = startingAngle / 360.0;
  float angle = (atan(uv.y - center.y, uv.x - center.x) + PI) / TWO_PI;
  float normalizedAngle = fract(angle + offset);
  if (sweepDirection < 0) {
    normalizedAngle = 1.0 - normalizedAngle;
  }

  float sectorCount = max(float(sectors), 1.0);
  float edge = sectors <= 1
    ? progress
    : floor(progress * sectorCount + 0.0001) / sectorCount;
  float f = max(feather, 1.0 / min(resolution.x, resolution.y));
  float mask = 1.0 - smoothstep(edge - f, edge + f, normalizedAngle);
  float band = 1.0 - smoothstep(0.0, f * 2.0, abs(normalizedAngle - edge));
  vec4 color = mix(getFromColor(uv), getToColor(uv), mask);
  return mix(color, edgeColor, band * edgeColor.a * step(0.001, feather));
}
`;

const SOFT_WIPE_FRAGMENT = `
// Author: Neuma
// License: MIT

uniform float angle;
uniform float softness;
uniform bool reverse;

vec4 transition(vec2 uv) {
  if (progress <= 0.0) return getFromColor(uv);
  if (progress >= 1.0) return getToColor(uv);

  float radians = angle * 3.141592653589793 / 180.0;
  vec2 dir = vec2(cos(radians), sin(radians));
  float span = max(abs(dir.x) + abs(dir.y), 0.0001);
  float axis = dot(uv - vec2(0.5), dir) / span + 0.5;
  axis = reverse ? 1.0 - axis : axis;
  float f = max(softness, 1.0 / min(resolution.x, resolution.y));
  float edge = mix(-f, 1.0 + f, progress);
  float toMask = softness <= 0.0
    ? step(axis, edge)
    : 1.0 - smoothstep(edge - f, edge + f, axis);
  return mix(getFromColor(uv), getToColor(uv), toMask);
}
`;

const PIXELIZE_FRAGMENT = `
// Author: Neuma
// License: MIT

uniform vec2 squaresMin;
uniform int steps;

vec4 transition(vec2 uv) {
  if (progress <= 0.0) return getFromColor(uv);
  if (progress >= 1.0) return getToColor(uv);

  float pixelAmount = sin(progress * 3.141592653589793);
  vec2 grid = max(mix(resolution, squaresMin, pixelAmount), vec2(1.0));
  vec2 pixelUv = (floor(uv * grid) + 0.5) / grid;
  float stepCount = float(max(steps, 0));
  float mixProgress = steps <= 0
    ? progress
    : floor(progress * stepCount + 0.5) / max(stepCount, 1.0);
  return mix(getFromColor(pixelUv), getToColor(pixelUv), mixProgress);
}
`;

const POLYGON_IRIS_FRAGMENT = `
// Author: Neuma
// License: MIT

uniform int sides;
uniform float rotation;
uniform vec2 center;
uniform float feather;

float polygonRadius(vec2 p, int n, float rot) {
  float a = atan(p.y, p.x) + rot;
  float sector = 6.283185307179586 / float(n);
  return cos(floor(0.5 + a / sector) * sector - a) * length(p);
}

vec4 transition(vec2 uv) {
  if (progress <= 0.0) return getFromColor(uv);
  if (progress >= 1.0) return getToColor(uv);

  vec2 p = uv - center;
  p.x *= ratio;
  float r = polygonRadius(
    p,
    max(sides, 3),
    rotation * 3.141592653589793 / 180.0
  );
  float maxRadius = length(vec2(max(ratio, 1.0), 1.0));
  float f = max(feather, 1.0 / min(resolution.x, resolution.y));
  float edge = mix(-f, maxRadius + f, progress);
  float toMask = 1.0 - smoothstep(edge - f, edge + f, r);
  return mix(getFromColor(uv), getToColor(uv), toMask);
}
`;

const CROSS_ZOOM_FRAGMENT = `
// License: MIT
// Author: rectalogic
// Ported by gre from https://gist.github.com/rectalogic/b86b90161503a0023231

uniform float strength;

const float PI = 3.141592653589793;

float Linear_ease(in float begin, in float change, in float duration, in float time) {
  return change * time / duration + begin;
}

float Exponential_easeInOut(in float begin, in float change, in float duration, in float time) {
  if (time == 0.0)
    return begin;
  else if (time == duration)
    return begin + change;
  time = time / (duration / 2.0);
  if (time < 1.0)
    return change / 2.0 * pow(2.0, 10.0 * (time - 1.0)) + begin;
  return change / 2.0 * (-pow(2.0, -10.0 * (time - 1.0)) + 2.0) + begin;
}

float Sinusoidal_easeInOut(in float begin, in float change, in float duration, in float time) {
  return -change / 2.0 * (cos(PI * time / duration) - 1.0) + begin;
}

float rand(vec2 co) {
  return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453);
}

vec4 crossFade(in vec2 uv, in float dissolve) {
  return mix(getFromColor(uv), getToColor(uv), dissolve);
}

vec4 transition(vec2 uv) {
  vec2 texCoord = uv.xy / vec2(1.0).xy;
  vec2 center = vec2(Linear_ease(0.25, 0.5, 1.0, progress), 0.5);
  float dissolve = Exponential_easeInOut(0.0, 1.0, 1.0, progress);
  float zoomStrength = Sinusoidal_easeInOut(0.0, strength, 0.5, progress);

  vec4 color = vec4(0.0);
  float total = 0.0;
  vec2 toCenter = center - texCoord;
  float offset = rand(uv);

  for (float t = 0.0; t <= 40.0; t++) {
    float percent = (t + offset) / 40.0;
    float weight = 4.0 * (percent - percent * percent);
    color += crossFade(texCoord + toCenter * percent * zoomStrength, dissolve) * weight;
    total += weight;
  }
  return color / total;
}
`;

const ZOOM_IN_OUT_FRAGMENT = `
// Author: OllyOllyOlly
// License: MIT

vec2 zoom(vec2 uv, float amount) {
  return 0.5 + ((uv - 0.5) * (1.0 - amount));
}

vec4 transition(vec2 uv) {
  float zoomFrom = smoothstep(0.0, 1.0, progress * 2.0);
  float zoomTo = smoothstep(0.0, 1.0, (1.0 - progress) * 2.0);
  float crossfade = smoothstep(0.4, 0.6, progress);
  return mix(
    getFromColor(zoom(uv, zoomFrom)),
    getToColor(zoom(uv, zoomTo)),
    crossfade
  );
}
`;

const IRIS_FRAGMENT = `
// Author: Neuma
// License: MIT

vec4 transition(vec2 uv) {
  vec2 centered = uv - vec2(0.5);
  centered.x *= ratio;
  float maxRadius = length(vec2(ratio, 1.0) * 0.5) + 0.03;
  float radius = smoothstep(0.0, 1.0, progress) * maxRadius;
  float edge = max(0.008, 2.0 / min(resolution.x, resolution.y));
  float mask = 1.0 - smoothstep(radius, radius + edge, length(centered));
  return mix(getFromColor(uv), getToColor(uv), mask);
}
`;

const DIRECTIONAL_COVER_REVEAL_FRAGMENT = `
// Author: Neuma
// License: MIT

uniform int direction;
uniform int mode;

vec2 directionOffset(int dir, float amount) {
  if (dir == 0) return vec2(0.0, -amount);
  if (dir == 1) return vec2(amount, 0.0);
  if (dir == 2) return vec2(0.0, amount);
  return vec2(-amount, 0.0);
}

bool inBounds(vec2 uv) {
  return uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0;
}

vec4 transition(vec2 uv) {
  float eased = smoothstep(0.0, 1.0, progress);
  if (mode == 0) {
    vec2 toUv = uv - directionOffset(direction, 1.0 - eased);
    return inBounds(toUv) ? getToColor(toUv) : getFromColor(uv);
  }
  vec2 fromUv = uv - directionOffset(direction, eased);
  return inBounds(fromUv) ? getFromColor(fromUv) : getToColor(uv);
}
`;

const FLIP_FRAGMENT = `
// Author: Neuma
// License: MIT

uniform int direction;

const float PI = 3.141592653589793;

bool inBounds(vec2 uv) {
  return uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0;
}

vec4 transition(vec2 uv) {
  bool verticalAxis = direction == 1 || direction == 3;
  float angle = progress * PI;
  float scale = max(0.04, abs(cos(angle)));
  vec2 sampleUv = uv;
  if (verticalAxis) {
    sampleUv.x = 0.5 + (uv.x - 0.5) / scale;
  } else {
    sampleUv.y = 0.5 + (uv.y - 0.5) / scale;
  }
  if (!inBounds(sampleUv)) return vec4(0.02, 0.025, 0.035, 1.0);
  vec4 color = progress < 0.5 ? getFromColor(sampleUv) : getToColor(sampleUv);
  float shade = 0.55 + 0.45 * scale;
  return vec4(color.rgb * shade, color.a);
}
`;

const CUBE_FRAGMENT = `
// Author: Neuma
// License: MIT

uniform int direction;

vec2 directionOffset(int dir, float amount) {
  if (dir == 0) return vec2(0.0, -amount);
  if (dir == 1) return vec2(amount, 0.0);
  if (dir == 2) return vec2(0.0, amount);
  return vec2(-amount, 0.0);
}

bool inBounds(vec2 uv) {
  return uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0;
}

vec4 shaded(vec4 color, float shade) {
  return vec4(color.rgb * shade, color.a);
}

vec4 transition(vec2 uv) {
  float eased = smoothstep(0.0, 1.0, progress);
  vec2 fromUv = uv + directionOffset(direction, eased);
  vec2 toUv = uv - directionOffset(direction, 1.0 - eased);
  if (inBounds(toUv)) return shaded(getToColor(toUv), 0.78 + 0.22 * eased);
  if (inBounds(fromUv)) return shaded(getFromColor(fromUv), 1.0 - 0.22 * eased);
  return mix(getFromColor(uv), getToColor(uv), eased);
}
`;

const FADE_SPEC: TransitionShaderSpec = {
  glslFragment: FADE_FRAGMENT,
  id: 'fade',
  uniformTypes: {},
};

const DISSOLVE_SPEC: TransitionShaderSpec = {
  glslFragment: DISSOLVE_FRAGMENT,
  id: 'dissolve',
  uniformTypes: {
    uHotClr: 'vec3',
    uIntensity: 'float',
    uLineWidth: 'float',
    uPow: 'float',
    uSpreadClr: 'vec3',
  },
  uniforms: {
    uHotClr: [0.9, 0.9, 0.2],
    uIntensity: 1,
    uLineWidth: 0.1,
    uPow: 5,
    uSpreadClr: [1, 0, 0],
  },
};

const CLOCK_WIPE_SPEC: TransitionShaderSpec = {
  glslFragment: ANGULAR_FRAGMENT,
  id: 'clock-wipe',
  license: {
    author: 'Neuma',
    license: 'MIT',
    modifications:
      'Adds center, sector, feather, edge color, and sweep-direction params to the existing Neuma clock wipe.',
    sourceName: 'Neuma clock wipe',
    sourceUrl:
      'dev-doc/video-mode/07-02-transitions/03-parametric-webgl-transition-plan.md',
  },
  uniformTypes: {
    center: 'vec2',
    edgeColor: 'vec4',
    feather: 'float',
    sectors: 'int',
    startingAngle: 'float',
    sweepDirection: 'int',
  },
  uniforms: {
    center: [0.5, 0.5],
    edgeColor: [1, 1, 1, 1],
    feather: 0.015,
    sectors: 1,
    startingAngle: 90,
    sweepDirection: 1,
  },
};

const SOFT_WIPE_SPEC: TransitionShaderSpec = {
  glslFragment: SOFT_WIPE_FRAGMENT,
  id: 'soft-wipe',
  license: {
    author: 'Gaetan Renaudeau',
    license: 'MIT',
    modifications:
      'Reworked direction into angle/reverse controls, added softness, and preserved endpoint guards.',
    sourceName: 'GL Transitions Directional.glsl',
    sourceUrl:
      'https://raw.githubusercontent.com/gl-transitions/gl-transitions/master/transitions/Directional.glsl',
  },
  uniformTypes: {
    angle: 'float',
    reverse: 'bool',
    softness: 'float',
  },
  uniforms: {
    angle: 0,
    reverse: false,
    softness: 0.08,
  },
};

const PIXELIZE_SPEC: TransitionShaderSpec = {
  glslFragment: PIXELIZE_FRAGMENT,
  id: 'pixelize',
  license: {
    author: 'gre',
    license: 'MIT',
    modifications:
      'Adapted ivec2 squaresMin to vec2 for the current WebGL uniform surface and added endpoint guards.',
    sourceName: 'GL Transitions pixelize.glsl',
    sourceUrl:
      'https://raw.githubusercontent.com/gl-transitions/gl-transitions/master/transitions/pixelize.glsl',
  },
  uniformTypes: {
    squaresMin: 'vec2',
    steps: 'int',
  },
  uniforms: {
    squaresMin: [20, 20],
    steps: 50,
  },
};

const POLYGON_IRIS_SPEC: TransitionShaderSpec = {
  glslFragment: POLYGON_IRIS_FRAGMENT,
  id: 'polygon-iris',
  license: {
    author: 'Neuma',
    license: 'MIT',
    modifications:
      'Custom polygon-radius iris shader with center, sides, rotation, and feather params.',
    sourceName: 'Neuma polygon iris shader',
    sourceUrl:
      'dev-doc/video-mode/07-02-transitions/03-parametric-webgl-transition-plan.md',
  },
  uniformTypes: {
    center: 'vec2',
    feather: 'float',
    rotation: 'float',
    sides: 'int',
  },
  uniforms: {
    center: [0.5, 0.5],
    feather: 0.015,
    rotation: 0,
    sides: 6,
  },
};

const ZOOM_BLUR_SPEC: TransitionShaderSpec = {
  glslFragment: CROSS_ZOOM_FRAGMENT,
  id: 'zoom-blur',
  uniformTypes: { strength: 'float' },
  uniforms: { strength: 0.4 },
};

const ZOOM_IN_OUT_SPEC: TransitionShaderSpec = {
  glslFragment: ZOOM_IN_OUT_FRAGMENT,
  id: 'zoom-in-out',
  uniformTypes: {},
};

const IRIS_SPEC: TransitionShaderSpec = {
  glslFragment: IRIS_FRAGMENT,
  id: 'iris',
  uniformTypes: {},
};

export function getTransitionShaderSpec(
  transition: Pick<
    VideoTransitionSpec,
    'direction' | 'kind' | 'params' | 'timing'
  >,
): TransitionShaderSpec | null {
  const normalized = normalizeVideoTransition(transition);
  switch (normalized.kind) {
    case 'cut':
      return null;
    case 'clock-wipe':
      return clockWipeSpec(normalized);
    case 'dissolve':
      return DISSOLVE_SPEC;
    case 'fade':
      return FADE_SPEC;
    case 'iris':
      return IRIS_SPEC;
    case 'soft-wipe':
      return softWipeSpec(normalized);
    case 'pixelize':
      return pixelizeSpec(normalized);
    case 'polygon-iris':
      return polygonIrisSpec(normalized);
    case 'slide':
      return slideSpec(normalized.direction);
    case 'wipe':
      return wipeSpec(normalized.direction);
    case 'zoom-blur':
      return ZOOM_BLUR_SPEC;
    case 'zoom-in-out':
      return ZOOM_IN_OUT_SPEC;
    case 'cover':
      return directionalSpec('cover', normalized.direction, 0);
    case 'cube':
      return cubeSpec(normalized.direction);
    case 'flip':
      return flipSpec(normalized.direction);
    case 'reveal':
      return directionalSpec('reveal', normalized.direction, 1);
  }
}

export function transitionCatalogCoverage(
  kind: VideoTransitionKind,
): TransitionShaderSpec | null {
  return getTransitionShaderSpec({ kind });
}

function clockWipeSpec(
  transition: Pick<VideoTransitionSpec, 'kind' | 'params'>,
): TransitionShaderSpec {
  const params = resolveTransitionParams(
    videoTransitionRegistryEntry('clock-wipe'),
    transition.params,
  ).values;
  const startAngle = numberParam(params.startAngle, 90);
  const sectors = numberParam(params.sectors, 1);
  const feather = numberParam(params.feather, 0.015);
  const center = vec2Param(params.center, [0.5, 0.5]);
  const edgeColor = vec4Param(params.edgeColor, [1, 1, 1, 1]);
  const sweepDirection = params.sweep === 'counterclockwise' ? 1 : -1;

  return {
    ...CLOCK_WIPE_SPEC,
    uniforms: {
      ...CLOCK_WIPE_SPEC.uniforms,
      center,
      edgeColor,
      feather,
      sectors,
      startingAngle: startAngle,
      sweepDirection,
    },
  };
}

function softWipeSpec(
  transition: Pick<VideoTransitionSpec, 'kind' | 'params'>,
): TransitionShaderSpec {
  const params = resolveTransitionParams(
    videoTransitionRegistryEntry('soft-wipe'),
    transition.params,
  ).values;
  return {
    ...SOFT_WIPE_SPEC,
    uniforms: {
      angle: numberParam(params.angle, 0),
      reverse: params.reverse === true,
      softness: numberParam(params.softness, 0.08),
    },
  };
}

function pixelizeSpec(
  transition: Pick<VideoTransitionSpec, 'kind' | 'params'>,
): TransitionShaderSpec {
  const params = resolveTransitionParams(
    videoTransitionRegistryEntry('pixelize'),
    transition.params,
  ).values;
  return {
    ...PIXELIZE_SPEC,
    uniforms: {
      squaresMin: vec2Param(params.squaresMin, [20, 20]),
      steps: numberParam(params.steps, 50),
    },
  };
}

function polygonIrisSpec(
  transition: Pick<VideoTransitionSpec, 'kind' | 'params'>,
): TransitionShaderSpec {
  const params = resolveTransitionParams(
    videoTransitionRegistryEntry('polygon-iris'),
    transition.params,
  ).values;
  return {
    ...POLYGON_IRIS_SPEC,
    uniforms: {
      center: vec2Param(params.center, [0.5, 0.5]),
      feather: numberParam(params.feather, 0.015),
      rotation: numberParam(params.rotation, 0),
      sides: numberParam(params.sides, 6),
    },
  };
}

function numberParam(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function vec2Param(
  value: unknown,
  fallback: readonly [number, number],
): readonly [number, number] {
  return isNumericTuple(value, 2) ? [value[0], value[1]] : fallback;
}

function vec4Param(
  value: unknown,
  fallback: readonly [number, number, number, number],
): readonly [number, number, number, number] {
  return isNumericTuple(value, 4)
    ? [value[0], value[1], value[2], value[3]]
    : fallback;
}

function isNumericTuple(value: unknown, length: 2): value is [number, number];
function isNumericTuple(
  value: unknown,
  length: 4,
): value is [number, number, number, number];
function isNumericTuple(
  value: unknown,
  length: 2 | 4,
): value is [number, number] | [number, number, number, number] {
  return (
    Array.isArray(value) &&
    value.length === length &&
    value.every((item) => typeof item === 'number' && Number.isFinite(item))
  );
}

function wipeSpec(
  direction: VideoTransitionDirection | undefined,
): TransitionShaderSpec {
  switch (direction ?? 'from-left') {
    case 'from-bottom':
      return {
        glslFragment: WIPE_UP_FRAGMENT,
        id: 'wipe-from-bottom',
        uniformTypes: {},
      };
    case 'from-right':
      return {
        glslFragment: WIPE_LEFT_FRAGMENT,
        id: 'wipe-from-right',
        uniformTypes: {},
      };
    case 'from-top':
      return {
        glslFragment: WIPE_DOWN_FRAGMENT,
        id: 'wipe-from-top',
        uniformTypes: {},
      };
    case 'from-left':
      return {
        glslFragment: WIPE_RIGHT_FRAGMENT,
        id: 'wipe-from-left',
        uniformTypes: {},
      };
  }
}

function slideSpec(
  direction: VideoTransitionDirection | undefined,
): TransitionShaderSpec {
  return {
    glslFragment: SLIDES_FRAGMENT,
    id: `slide-${direction ?? 'from-right'}`,
    uniformTypes: {
      In: 'bool',
      type: 'int',
    },
    uniforms: {
      In: true,
      type: slideType(direction ?? 'from-right'),
    },
  };
}

function slideType(direction: VideoTransitionDirection): number {
  switch (direction) {
    case 'from-bottom':
      return 2;
    case 'from-left':
      return 3;
    case 'from-right':
      return 1;
    case 'from-top':
      return 0;
  }
}

function directionalSpec(
  kind: 'cover' | 'reveal',
  direction: VideoTransitionDirection | undefined,
  mode: 0 | 1,
): TransitionShaderSpec {
  const resolvedDirection = direction ?? 'from-left';
  return {
    glslFragment: DIRECTIONAL_COVER_REVEAL_FRAGMENT,
    id: `${kind}-${resolvedDirection}`,
    uniformTypes: { direction: 'int', mode: 'int' },
    uniforms: {
      direction: directionType(resolvedDirection),
      mode,
    },
  };
}

function flipSpec(
  direction: VideoTransitionDirection | undefined,
): TransitionShaderSpec {
  const resolvedDirection = direction ?? 'from-right';
  return {
    glslFragment: FLIP_FRAGMENT,
    id: `flip-${resolvedDirection}`,
    uniformTypes: { direction: 'int' },
    uniforms: { direction: directionType(resolvedDirection) },
  };
}

function cubeSpec(
  direction: VideoTransitionDirection | undefined,
): TransitionShaderSpec {
  const resolvedDirection = direction ?? 'from-right';
  return {
    glslFragment: CUBE_FRAGMENT,
    id: `cube-${resolvedDirection}`,
    uniformTypes: { direction: 'int' },
    uniforms: { direction: directionType(resolvedDirection) },
  };
}

function directionType(direction: VideoTransitionDirection): number {
  switch (direction) {
    case 'from-top':
      return 0;
    case 'from-right':
      return 1;
    case 'from-bottom':
      return 2;
    case 'from-left':
      return 3;
  }
}
