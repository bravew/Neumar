import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getTransitionShaderSpec,
  transitionCatalogCoverage,
} from '@/components/video/preview/webcodecs/transitionCatalog';
import {
  validateTransitionShaderSpec,
  WebGLTransitionRenderer,
} from '@/components/video/preview/webcodecs/WebGLTransitionRenderer';
import { VIDEO_TRANSITION_KINDS } from '@/shared/types/video';

interface MockCanvasContext {
  arc: ReturnType<typeof vi.fn>;
  beginPath: ReturnType<typeof vi.fn>;
  clip: ReturnType<typeof vi.fn>;
  closePath: ReturnType<typeof vi.fn>;
  clearRect: ReturnType<typeof vi.fn>;
  drawImage: ReturnType<typeof vi.fn>;
  globalAlpha: number;
  moveTo: ReturnType<typeof vi.fn>;
  restore: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
}

describe('WebGL transition renderer', () => {
  let getContextSpy: ReturnType<typeof vi.spyOn>;
  let contexts: MockCanvasContext[];

  beforeEach(() => {
    contexts = [];
    getContextSpy = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockImplementation((type: string) => {
        if (type === 'webgl' || type === 'experimental-webgl') return null;
        if (type !== '2d') return null;
        const context: MockCanvasContext = {
          arc: vi.fn(),
          beginPath: vi.fn(),
          clip: vi.fn(),
          closePath: vi.fn(),
          clearRect: vi.fn(),
          drawImage: vi.fn(),
          globalAlpha: 1,
          moveTo: vi.fn(),
          restore: vi.fn(),
          save: vi.fn(),
        };
        contexts.push(context);
        return context as unknown as RenderingContext;
      });
  });

  afterEach(() => {
    getContextSpy.mockRestore();
  });

  it('has a shader catalog entry for every transition kind', () => {
    for (const kind of VIDEO_TRANSITION_KINDS) {
      const spec = transitionCatalogCoverage(kind);
      if (kind === 'cut') {
        expect(spec).toBeNull();
        continue;
      }
      expect(spec, kind).not.toBeNull();
      expect(validateTransitionShaderSpec(spec!)).toEqual({
        ok: true,
      });
    }
  });

  it('selects directional wipe and slide uniforms', () => {
    expect(
      getTransitionShaderSpec({ direction: 'from-right', kind: 'wipe' })?.id,
    ).toBe('wipe-from-right');
    expect(
      getTransitionShaderSpec({ direction: 'from-left', kind: 'slide' })
        ?.uniforms,
    ).toMatchObject({ In: true, type: 3 });
  });

  it('resolves transition params into uniforms and drops unknown params', () => {
    const spec = getTransitionShaderSpec({
      kind: 'clock-wipe',
      params: {
        center: [0.2, 0.8],
        edgeColor: [0.1, 0.2, 0.3, 0.4],
        extra: 1,
        sectors: 4,
        startAngle: 180,
        sweep: 'counterclockwise',
      },
    });

    expect(spec).not.toBeNull();
    expect(spec!.uniformTypes).toEqual({
      center: 'vec2',
      edgeColor: 'vec4',
      feather: 'float',
      sectors: 'int',
      startingAngle: 'float',
      sweepDirection: 'int',
    });
    expect(spec!.uniforms).toMatchObject({
      center: [0.2, 0.8],
      edgeColor: [0.1, 0.2, 0.3, 0.4],
      sectors: 4,
      startingAngle: 180,
      sweepDirection: 1,
    });
    expect(spec!.uniforms).not.toHaveProperty('extra');
  });

  it('maps new parametric transition params into uniforms', () => {
    expect(
      getTransitionShaderSpec({
        kind: 'soft-wipe',
        params: { angle: 45, reverse: true, softness: 0.12 },
      })?.uniforms,
    ).toEqual({
      angle: 45,
      reverse: true,
      softness: 0.12,
    });
    expect(
      getTransitionShaderSpec({
        kind: 'pixelize',
        params: { squaresMin: [12, 18], steps: 7 },
      })?.uniforms,
    ).toEqual({
      squaresMin: [12, 18],
      steps: 7,
    });
    expect(
      getTransitionShaderSpec({
        kind: 'polygon-iris',
        params: {
          center: [0.25, 0.75],
          feather: 0.04,
          rotation: 30,
          sides: 5,
        },
      })?.uniforms,
    ).toEqual({
      center: [0.25, 0.75],
      feather: 0.04,
      rotation: 30,
      sides: 5,
    });
  });

  it('uses distinct shaders for quality-critical preview presets', () => {
    expect(getTransitionShaderSpec({ kind: 'clock-wipe' })?.id).toBe(
      'clock-wipe',
    );
    expect(getTransitionShaderSpec({ kind: 'iris' })?.id).toBe('iris');
    expect(
      getTransitionShaderSpec({ direction: 'from-top', kind: 'cover' })?.id,
    ).toBe('cover-from-top');
    expect(
      getTransitionShaderSpec({ direction: 'from-bottom', kind: 'reveal' })?.id,
    ).toBe('reveal-from-bottom');
    expect(getTransitionShaderSpec({ kind: 'soft-wipe' })?.id).toBe(
      'soft-wipe',
    );
    expect(getTransitionShaderSpec({ kind: 'pixelize' })?.id).toBe('pixelize');
    expect(getTransitionShaderSpec({ kind: 'polygon-iris' })?.id).toBe(
      'polygon-iris',
    );
    expect(
      getTransitionShaderSpec({ direction: 'from-left', kind: 'flip' })?.id,
    ).toBe('flip-from-left');
    expect(
      getTransitionShaderSpec({ direction: 'from-right', kind: 'cube' })?.id,
    ).toBe('cube-from-right');
  });

  it('carries provenance metadata for parametric shaders', () => {
    for (const kind of [
      'clock-wipe',
      'soft-wipe',
      'pixelize',
      'polygon-iris',
    ] as const) {
      expect(getTransitionShaderSpec({ kind })?.license).toMatchObject({
        author: expect.any(String),
        license: 'MIT',
        modifications: expect.any(String),
        sourceName: expect.any(String),
        sourceUrl: expect.any(String),
      });
    }
  });

  it('returns a canvas through the Canvas2D fallback when WebGL is unavailable', () => {
    const renderer = new WebGLTransitionRenderer();
    const spec = getTransitionShaderSpec({ kind: 'fade' });
    const from = document.createElement('canvas');
    const to = document.createElement('canvas');

    const output = renderer.renderTransition({
      from,
      height: 8,
      progress: 0.25,
      spec: spec!,
      to,
      width: 10,
    });

    expect(output.width).toBe(10);
    expect(output.height).toBe(8);
    expect(contexts).toHaveLength(1);
    expect(contexts[0]?.clearRect).toHaveBeenCalledWith(0, 0, 10, 8);
    expect(contexts[0]?.drawImage).toHaveBeenCalledTimes(2);
    expect(contexts[0]?.globalAlpha).toBe(1);
  });

  it('draws a clock-wipe canvas fallback when WebGL is unavailable', () => {
    const renderer = new WebGLTransitionRenderer();
    const spec = getTransitionShaderSpec({ kind: 'clock-wipe' });
    const from = document.createElement('canvas');
    const to = document.createElement('canvas');

    renderer.renderTransition({
      from,
      height: 8,
      progress: 0.5,
      spec: spec!,
      to,
      width: 10,
    });

    expect(contexts[0]?.save).toHaveBeenCalledOnce();
    expect(contexts[0]?.arc).toHaveBeenCalled();
    expect(contexts[0]?.clip).toHaveBeenCalledOnce();
    expect(contexts[0]?.drawImage).toHaveBeenCalledTimes(2);
    expect(contexts[0]?.globalAlpha).toBe(1);
  });

  it('honors clock-wipe fallback endpoints when WebGL is unavailable', () => {
    const renderer = new WebGLTransitionRenderer();
    const spec = getTransitionShaderSpec({ kind: 'clock-wipe' });
    const from = document.createElement('canvas');
    const to = document.createElement('canvas');

    renderer.renderTransition({
      from,
      height: 8,
      progress: 0,
      spec: spec!,
      to,
      width: 10,
    });
    renderer.renderTransition({
      from,
      height: 8,
      progress: 1,
      spec: spec!,
      to,
      width: 10,
    });

    expect(contexts[0]?.drawImage).toHaveBeenCalledOnce();
    expect(contexts[0]?.arc).not.toHaveBeenCalled();
    expect(contexts[1]?.drawImage).toHaveBeenCalledTimes(2);
    expect(contexts[1]?.arc).not.toHaveBeenCalled();
  });

  it('sets updated uniforms without recompiling the shader program', () => {
    const gl = createMockWebGLContext();
    getContextSpy.mockImplementation((type: string) => {
      if (type === 'webgl' || type === 'experimental-webgl') {
        return gl as unknown as RenderingContext;
      }
      return null;
    });
    const renderer = new WebGLTransitionRenderer();
    const from = document.createElement('canvas');
    const to = document.createElement('canvas');
    const firstSpec = getTransitionShaderSpec({
      kind: 'clock-wipe',
      params: { startAngle: 45 },
    });
    const secondSpec = getTransitionShaderSpec({
      kind: 'clock-wipe',
      params: { startAngle: 270 },
    });

    renderer.renderTransition({
      from,
      height: 8,
      progress: 0.25,
      spec: firstSpec!,
      to,
      width: 10,
    });
    renderer.renderTransition({
      from,
      height: 8,
      progress: 0.75,
      spec: secondSpec!,
      to,
      width: 10,
    });

    expect(gl.createProgram).toHaveBeenCalledTimes(1);
    expect(gl.uniform1f).toHaveBeenCalledWith('startingAngle', 45);
    expect(gl.uniform1f).toHaveBeenCalledWith('startingAngle', 270);
  });

  it('does not flip canvas textures during WebGL upload', () => {
    const gl = createMockWebGLContext();
    getContextSpy.mockImplementation((type: string) => {
      if (type === 'webgl' || type === 'experimental-webgl') {
        return gl as unknown as RenderingContext;
      }
      return null;
    });
    const renderer = new WebGLTransitionRenderer();
    const from = document.createElement('canvas');
    const to = document.createElement('canvas');
    const spec = getTransitionShaderSpec({ kind: 'fade' });

    renderer.renderTransition({
      from,
      height: 8,
      progress: 1,
      spec: spec!,
      to,
      width: 10,
    });

    expect(gl.pixelStorei).toHaveBeenCalledWith(gl.UNPACK_FLIP_Y_WEBGL, false);
  });

  it('rejects shader specs with unsupported or unset uniforms', () => {
    expect(
      validateTransitionShaderSpec({
        glslFragment: `
uniform sampler2D luma;
vec4 transition(vec2 uv) {
  return texture2D(luma, uv);
}
`,
        id: 'bad-sampler',
        uniformTypes: {},
      }),
    ).toMatchObject({
      ok: false,
      error: 'Unsupported uniform type sampler2D for luma',
    });

    expect(
      validateTransitionShaderSpec({
        glslFragment: `
uniform float amount;
vec4 transition(vec2 uv) {
  return vec4(vec3(amount), 1.0);
}
`,
        id: 'missing-default',
        uniformTypes: { amount: 'float' },
      }),
    ).toMatchObject({
      ok: false,
      error: 'Missing default uniform value for amount',
    });
  });
});

function createMockWebGLContext() {
  const gl = {
    ARRAY_BUFFER: 0x8892,
    CLAMP_TO_EDGE: 0x812f,
    COLOR_BUFFER_BIT: 0x4000,
    COMPILE_STATUS: 0x8b81,
    FLOAT: 0x1406,
    FRAGMENT_SHADER: 0x8b30,
    LINEAR: 0x2601,
    LINK_STATUS: 0x8b82,
    RGBA: 0x1908,
    STATIC_DRAW: 0x88e4,
    TEXTURE0: 0x84c0,
    TEXTURE1: 0x84c1,
    TEXTURE_2D: 0x0de1,
    TEXTURE_MAG_FILTER: 0x2800,
    TEXTURE_MIN_FILTER: 0x2801,
    TEXTURE_WRAP_S: 0x2802,
    TEXTURE_WRAP_T: 0x2803,
    TRIANGLE_STRIP: 0x0005,
    UNPACK_FLIP_Y_WEBGL: 0x9240,
    UNSIGNED_BYTE: 0x1401,
    VERTEX_SHADER: 0x8b31,
    activeTexture: vi.fn(),
    attachShader: vi.fn(),
    bindBuffer: vi.fn(),
    bindTexture: vi.fn(),
    bufferData: vi.fn(),
    clear: vi.fn(),
    clearColor: vi.fn(),
    compileShader: vi.fn(),
    createBuffer: vi.fn(() => ({})),
    createProgram: vi.fn(() => ({})),
    createShader: vi.fn(() => ({})),
    createTexture: vi.fn(() => ({})),
    deleteBuffer: vi.fn(),
    deleteProgram: vi.fn(),
    deleteShader: vi.fn(),
    deleteTexture: vi.fn(),
    drawArrays: vi.fn(),
    enableVertexAttribArray: vi.fn(),
    getAttribLocation: vi.fn(() => 0),
    getExtension: vi.fn(() => null),
    getProgramInfoLog: vi.fn(() => null),
    getProgramParameter: vi.fn(() => true),
    getShaderInfoLog: vi.fn(() => null),
    getShaderParameter: vi.fn(() => true),
    getUniformLocation: vi.fn(
      (_program: WebGLProgram, name: string) =>
        name as unknown as WebGLUniformLocation,
    ),
    linkProgram: vi.fn(),
    pixelStorei: vi.fn(),
    shaderSource: vi.fn(),
    texImage2D: vi.fn(),
    texParameteri: vi.fn(),
    uniform1f: vi.fn(),
    uniform1i: vi.fn(),
    uniform2f: vi.fn(),
    uniform3f: vi.fn(),
    uniform4f: vi.fn(),
    useProgram: vi.fn(),
    vertexAttribPointer: vi.fn(),
    viewport: vi.fn(),
  };

  return gl as unknown as WebGLRenderingContext & {
    createProgram: ReturnType<typeof vi.fn>;
    pixelStorei: ReturnType<typeof vi.fn>;
    uniform1f: ReturnType<typeof vi.fn>;
  };
}
