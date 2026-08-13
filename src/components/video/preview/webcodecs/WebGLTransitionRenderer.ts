export type TransitionUniformType =
  | 'bool'
  | 'float'
  | 'int'
  | 'vec2'
  | 'vec3'
  | 'vec4';

export type TransitionUniformValue =
  | boolean
  | number
  | readonly [number, number]
  | readonly [number, number, number]
  | readonly [number, number, number, number];

export interface TransitionShaderSpec {
  glslFragment: string;
  id: string;
  uniformTypes: Record<string, TransitionUniformType>;
  uniforms?: Record<string, TransitionUniformValue>;
  license?: {
    author: string;
    sourceName: string;
    sourceUrl: string;
    license: 'MIT' | 'BSD-2-Clause' | 'custom';
    modifications?: string;
  };
}

export type TransitionImageSource = CanvasImageSourceWebCodecs &
  TexImageSourceWebCodecs;

interface ProgramRecord {
  attributes: {
    position: number;
  };
  program: WebGLProgram;
  uniforms: Map<string, WebGLUniformLocation | null>;
}

export interface RenderTransitionOptions {
  from: TransitionImageSource;
  height: number;
  progress: number;
  spec: TransitionShaderSpec;
  to: TransitionImageSource;
  width: number;
}

export interface TransitionShaderValidation {
  error?: string;
  ok: boolean;
}

const VERTEX_SHADER_SOURCE = `
attribute vec2 a_position;
varying vec2 v_uv;

void main() {
  v_uv = (a_position + 1.0) * 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const POSITION_BUFFER_DATA = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
const SUPPORTED_TRANSITION_UNIFORM_TYPES = new Set<TransitionUniformType>([
  'bool',
  'float',
  'int',
  'vec2',
  'vec3',
  'vec4',
]);
const CUSTOM_UNIFORM_DECLARATION_RE =
  /\buniform\s+([A-Za-z_]\w*)\s+([A-Za-z_]\w*)\s*(\[[^\]]+\])?\s*;/g;

export function buildTransitionFragmentShaderSource(
  transitionFragment: string,
): string {
  return `
precision mediump float;

uniform sampler2D fromTexture;
uniform sampler2D toTexture;
uniform float progress;
uniform vec2 resolution;
uniform float ratio;

varying vec2 v_uv;

vec4 getFromColor(vec2 uv) {
  return texture2D(fromTexture, vec2(uv.x, 1.0 - uv.y));
}

vec4 getToColor(vec2 uv) {
  return texture2D(toTexture, vec2(uv.x, 1.0 - uv.y));
}

${transitionFragment}

void main() {
  gl_FragColor = transition(v_uv);
}
`;
}

export function validateTransitionShaderSource(
  transitionFragment: string,
): TransitionShaderValidation {
  if (!/\bvec4\s+transition\s*\(\s*vec2\s+\w+\s*\)/.test(transitionFragment)) {
    return { ok: false, error: 'Missing vec4 transition(vec2 uv) function' };
  }

  const canvas = createHtmlCanvas(1, 1);
  const gl = getWebGLContext(canvas);
  if (!gl) return { ok: true };

  const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER_SOURCE);
  if (!vertex.ok) return vertex;
  const fragment = compileShader(
    gl,
    gl.FRAGMENT_SHADER,
    buildTransitionFragmentShaderSource(transitionFragment),
  );
  if (!fragment.ok) {
    gl.deleteShader(vertex.shader);
    return fragment;
  }
  const linked = linkProgram(gl, vertex.shader, fragment.shader);
  gl.deleteShader(vertex.shader);
  gl.deleteShader(fragment.shader);
  if (!linked.ok) return linked;
  gl.deleteProgram(linked.program);
  return { ok: true };
}

export function validateTransitionShaderSpec(
  spec: TransitionShaderSpec,
): TransitionShaderValidation {
  for (const [name, type] of Object.entries(spec.uniformTypes)) {
    if (!SUPPORTED_TRANSITION_UNIFORM_TYPES.has(type)) {
      return {
        ok: false,
        error: `Unsupported uniform type ${type} for ${name}`,
      };
    }
    if (spec.uniforms?.[name] === undefined) {
      return {
        ok: false,
        error: `Missing default uniform value for ${name}`,
      };
    }
  }

  for (const match of spec.glslFragment.matchAll(
    CUSTOM_UNIFORM_DECLARATION_RE,
  )) {
    const [, glslType, name, arraySuffix] = match;
    if (arraySuffix) {
      return {
        ok: false,
        error: `Unsupported uniform array ${name}`,
      };
    }
    if (
      !SUPPORTED_TRANSITION_UNIFORM_TYPES.has(glslType as TransitionUniformType)
    ) {
      return {
        ok: false,
        error: `Unsupported uniform type ${glslType} for ${name}`,
      };
    }
    if (!Object.hasOwn(spec.uniformTypes, name)) {
      return {
        ok: false,
        error: `Uniform ${name} is missing from uniformTypes`,
      };
    }
    if (spec.uniformTypes[name] !== glslType) {
      return {
        ok: false,
        error: `Uniform ${name} is declared as ${glslType} but configured as ${spec.uniformTypes[name]}`,
      };
    }
  }

  return validateTransitionShaderSource(spec.glslFragment);
}

export class WebGLTransitionRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly fallbackCanvas: HTMLCanvasElement;
  private readonly programCache = new Map<string, ProgramRecord>();
  private fromTexture: WebGLTexture | null = null;
  private gl: WebGLRenderingContext | null = null;
  private positionBuffer: WebGLBuffer | null = null;
  private toTexture: WebGLTexture | null = null;

  constructor(canvas = createHtmlCanvas(1, 1)) {
    this.canvas = canvas;
    this.fallbackCanvas = createHtmlCanvas(1, 1);
    this.canvas.addEventListener('webglcontextlost', this.handleContextLost);
    this.canvas.addEventListener(
      'webglcontextrestored',
      this.handleContextRestored,
    );
  }

  // Drop every GL handle when the context is lost so the next render either
  // re-acquires a fresh context or cleanly falls back to Canvas2D — the
  // stale `gl`/textures/programs would otherwise throw on every frame.
  private readonly handleContextLost = (event: Event): void => {
    event.preventDefault();
    this.gl = null;
    this.fromTexture = null;
    this.toTexture = null;
    this.positionBuffer = null;
    this.programCache.clear();
  };

  // Leave `gl` null so `ensureContext` lazily re-acquires it on next render.
  private readonly handleContextRestored = (): void => {};

  renderTransition({
    from,
    height,
    progress,
    spec,
    to,
    width,
  }: RenderTransitionOptions): HTMLCanvasElement {
    this.resize(width, height);
    try {
      const gl = this.ensureContext();
      if (!gl) {
        return this.renderFallback({
          from,
          height,
          progress,
          spec,
          to,
          width,
        });
      }

      const programRecord = this.getProgram(gl, spec.glslFragment);
      if (!programRecord) {
        return this.renderFallback({
          from,
          height,
          progress,
          spec,
          to,
          width,
        });
      }

      const fromTexture = this.ensureTexture(gl, 'from');
      const toTexture = this.ensureTexture(gl, 'to');
      const positionBuffer = this.ensurePositionBuffer(gl);
      if (!fromTexture || !toTexture || !positionBuffer) {
        return this.renderFallback({
          from,
          height,
          progress,
          spec,
          to,
          width,
        });
      }

      gl.viewport(0, 0, width, height);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(programRecord.program);

      updateTexture(gl, fromTexture, from);
      updateTexture(gl, toTexture, to);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, fromTexture);
      gl.uniform1i(getUniform(gl, programRecord, 'fromTexture'), 0);

      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, toTexture);
      gl.uniform1i(getUniform(gl, programRecord, 'toTexture'), 1);

      gl.uniform1f(
        getUniform(gl, programRecord, 'progress'),
        clamp01(progress),
      );
      gl.uniform2f(getUniform(gl, programRecord, 'resolution'), width, height);
      gl.uniform1f(getUniform(gl, programRecord, 'ratio'), width / height);

      for (const [name, type] of Object.entries(spec.uniformTypes)) {
        const value = spec.uniforms?.[name];
        if (value !== undefined) {
          setUniform(gl, programRecord, name, type, value);
        }
      }

      gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
      gl.enableVertexAttribArray(programRecord.attributes.position);
      gl.vertexAttribPointer(
        programRecord.attributes.position,
        2,
        gl.FLOAT,
        false,
        0,
        0,
      );
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      return this.canvas;
    } catch {
      return this.renderFallback({
        from,
        height,
        progress,
        spec,
        to,
        width,
      });
    }
  }

  destroy(): void {
    this.canvas.removeEventListener('webglcontextlost', this.handleContextLost);
    this.canvas.removeEventListener(
      'webglcontextrestored',
      this.handleContextRestored,
    );
    const gl = this.gl;
    if (!gl) return;
    for (const record of this.programCache.values()) {
      gl.deleteProgram(record.program);
    }
    this.programCache.clear();
    if (this.fromTexture) gl.deleteTexture(this.fromTexture);
    if (this.toTexture) gl.deleteTexture(this.toTexture);
    if (this.positionBuffer) gl.deleteBuffer(this.positionBuffer);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    this.fromTexture = null;
    this.toTexture = null;
    this.positionBuffer = null;
    this.gl = null;
  }

  private ensureContext(): WebGLRenderingContext | null {
    if (this.gl) return this.gl;
    this.gl = getWebGLContext(this.canvas);
    return this.gl;
  }

  private ensurePositionBuffer(gl: WebGLRenderingContext): WebGLBuffer | null {
    if (this.positionBuffer) return this.positionBuffer;
    const buffer = gl.createBuffer();
    if (!buffer) return null;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, POSITION_BUFFER_DATA, gl.STATIC_DRAW);
    this.positionBuffer = buffer;
    return buffer;
  }

  private ensureTexture(
    gl: WebGLRenderingContext,
    slot: 'from' | 'to',
  ): WebGLTexture | null {
    const existing = slot === 'from' ? this.fromTexture : this.toTexture;
    if (existing) return existing;
    const texture = gl.createTexture();
    if (!texture) return null;
    if (slot === 'from') this.fromTexture = texture;
    else this.toTexture = texture;
    return texture;
  }

  private getProgram(
    gl: WebGLRenderingContext,
    transitionFragment: string,
  ): ProgramRecord | null {
    const cached = this.programCache.get(transitionFragment);
    if (cached) return cached;

    const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER_SOURCE);
    if (!vertex.ok) return null;
    const fragment = compileShader(
      gl,
      gl.FRAGMENT_SHADER,
      buildTransitionFragmentShaderSource(transitionFragment),
    );
    if (!fragment.ok) {
      gl.deleteShader(vertex.shader);
      return null;
    }
    const linked = linkProgram(gl, vertex.shader, fragment.shader);
    gl.deleteShader(vertex.shader);
    gl.deleteShader(fragment.shader);
    if (!linked.ok) return null;

    const programRecord: ProgramRecord = {
      attributes: {
        position: gl.getAttribLocation(linked.program, 'a_position'),
      },
      program: linked.program,
      uniforms: new Map(),
    };
    this.programCache.set(transitionFragment, programRecord);
    return programRecord;
  }

  private resize(width: number, height: number): void {
    const nextWidth = Math.max(1, Math.round(width));
    const nextHeight = Math.max(1, Math.round(height));
    if (this.canvas.width !== nextWidth) this.canvas.width = nextWidth;
    if (this.canvas.height !== nextHeight) this.canvas.height = nextHeight;
  }

  private renderFallback(options: RenderTransitionOptions): HTMLCanvasElement {
    resizeCanvas(this.fallbackCanvas, options.width, options.height);
    renderCanvas2DFallback(this.fallbackCanvas, options);
    return this.fallbackCanvas;
  }
}

function compileShader(
  gl: WebGLRenderingContext,
  type: number,
  source: string,
): { ok: true; shader: WebGLShader } | { error?: string; ok: false } {
  const shader = gl.createShader(type);
  if (!shader) return { ok: false, error: 'Unable to create shader' };
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    return { ok: true, shader };
  }
  const error = gl.getShaderInfoLog(shader) ?? 'Shader compile failed';
  gl.deleteShader(shader);
  return { ok: false, error };
}

function linkProgram(
  gl: WebGLRenderingContext,
  vertex: WebGLShader,
  fragment: WebGLShader,
): { ok: true; program: WebGLProgram } | { error?: string; ok: false } {
  const program = gl.createProgram();
  if (!program) return { ok: false, error: 'Unable to create program' };
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (gl.getProgramParameter(program, gl.LINK_STATUS)) {
    return { ok: true, program };
  }
  const error = gl.getProgramInfoLog(program) ?? 'Program link failed';
  gl.deleteProgram(program);
  return { ok: false, error };
}

function getUniform(
  gl: WebGLRenderingContext,
  record: ProgramRecord,
  name: string,
): WebGLUniformLocation | null {
  if (!record.uniforms.has(name)) {
    record.uniforms.set(name, gl.getUniformLocation(record.program, name));
  }
  return record.uniforms.get(name) ?? null;
}

function setUniform(
  gl: WebGLRenderingContext,
  record: ProgramRecord,
  name: string,
  type: TransitionUniformType,
  value: TransitionUniformValue,
): void {
  const location = getUniform(gl, record, name);
  if (!location) return;
  switch (type) {
    case 'bool':
      gl.uniform1i(location, value === true ? 1 : 0);
      break;
    case 'float':
      gl.uniform1f(location, Number(value));
      break;
    case 'int':
      gl.uniform1i(location, Math.round(Number(value)));
      break;
    case 'vec2': {
      const vector = value as readonly [number, number];
      gl.uniform2f(location, vector[0], vector[1]);
      break;
    }
    case 'vec3': {
      const vector = value as readonly [number, number, number];
      gl.uniform3f(location, vector[0], vector[1], vector[2]);
      break;
    }
    case 'vec4': {
      const vector = value as readonly [number, number, number, number];
      gl.uniform4f(location, vector[0], vector[1], vector[2], vector[3]);
      break;
    }
  }
}

function updateTexture(
  gl: WebGLRenderingContext,
  texture: WebGLTexture,
  source: TransitionImageSource,
): void {
  gl.bindTexture(gl.TEXTURE_2D, texture);
  // getFromColor/getToColor already convert transition UVs to DOM-canvas
  // coordinates. Flipping at upload time would invert the rendered clip during
  // WebGL-only transition frames.
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
}

function renderCanvas2DFallback(
  canvas: HTMLCanvasElement,
  { from, height, progress, spec, to, width }: RenderTransitionOptions,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const clampedProgress = clamp01(progress);
  ctx.clearRect(0, 0, width, height);
  ctx.globalAlpha = 1;
  ctx.drawImage(from, 0, 0, width, height);
  if (spec.id === 'clock-wipe') {
    drawClockWipeFallback(ctx, to, width, height, clampedProgress);
    return;
  }
  ctx.globalAlpha = clampedProgress;
  ctx.drawImage(to, 0, 0, width, height);
  ctx.globalAlpha = 1;
}

function drawClockWipeFallback(
  ctx: CanvasRenderingContext2D,
  to: TransitionImageSource,
  width: number,
  height: number,
  progress: number,
): void {
  if (progress <= 0) return;
  if (progress >= 1) {
    ctx.drawImage(to, 0, 0, width, height);
    return;
  }
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = Math.hypot(width, height);
  const startAngle = -Math.PI / 2;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(centerX, centerY);
  ctx.arc(
    centerX,
    centerY,
    radius,
    startAngle,
    startAngle + progress * Math.PI * 2,
  );
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(to, 0, 0, width, height);
  ctx.restore();
}

function resizeCanvas(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
): void {
  const nextWidth = Math.max(1, Math.round(width));
  const nextHeight = Math.max(1, Math.round(height));
  if (canvas.width !== nextWidth) canvas.width = nextWidth;
  if (canvas.height !== nextHeight) canvas.height = nextHeight;
}

function createHtmlCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function getWebGLContext(
  canvas: HTMLCanvasElement,
): WebGLRenderingContext | null {
  try {
    return (
      (canvas.getContext('webgl', {
        premultipliedAlpha: false,
        preserveDrawingBuffer: true,
      }) as WebGLRenderingContext | null) ??
      (canvas.getContext('experimental-webgl', {
        premultipliedAlpha: false,
        preserveDrawingBuffer: true,
      }) as WebGLRenderingContext | null)
    );
  } catch {
    return null;
  }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
