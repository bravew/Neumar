/**
 * Per-operation authorization.
 *
 * Rejects variants the host cannot supervise, then rewrites every file
 * argument to a resolved path inside the session roots. Nested documents
 * (recipes, projects, subtitle lists, brand files) are read and checked
 * before a process starts.
 */

import { readFileSync, statSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';

import type { SkillArgs } from './argv';
import type { ContractTool } from './contract';
import { FfmpegSkillError } from './errors';
import { resolveSkillPath, samePath, type SkillPathRoots } from './paths';

const PREVIEW_REJECTED_TOOLS = new Set(['verify']);

/**
 * Arguments that name a filesystem location, keyed by tool.
 *
 * The contract records CLI spellings but not which strings are paths, so this
 * list is the host classification of those spellings. Values are the access
 * the operation needs. It is not a second flag table: argv still comes from
 * the contract.
 */
const PATH_ARGUMENTS: Record<string, Record<string, 'read' | 'write'>> = {
  audio: {
    input: 'read',
    music: 'read',
    effects: 'read',
    replace: 'read',
    output: 'write',
  },
  background: { output: 'write' },
  batch: { folder: 'read', recipe: 'read', work: 'write' },
  broll: { input: 'read', insert: 'read', output: 'write' },
  caption: {
    input: 'read',
    srt: 'read',
    ass: 'read',
    text: 'read',
    model: 'read',
    brand: 'read',
    fonts_dir: 'read',
    emoji_assets: 'read',
    output: 'write',
    write_srt: 'write',
    write_ass: 'write',
  },
  check: { input: 'read' },
  color: { input: 'read', lut: 'read', output: 'write' },
  crop: { input: 'read', output: 'write' },
  cropdetect: { input: 'read' },
  cut: { input: 'read', snap_source: 'read', output: 'write' },
  deinterlace: { input: 'read', output: 'write' },
  denoise: { input: 'read', output: 'write' },
  export: { input: 'read', output: 'write' },
  fit: { input: 'read', output: 'write' },
  freeze: { input: 'read', output: 'write' },
  graphics: {
    input: 'read',
    brand: 'read',
    font_file: 'read',
    emoji_assets: 'read',
    output: 'write',
    write_ass: 'write',
  },
  grid: { inputs: 'read', output: 'write' },
  insert: { input: 'read', output: 'write' },
  join: { inputs: 'read', list: 'read', output: 'write' },
  look: { input: 'read', compare: 'read', output: 'write' },
  loop: { input: 'read', output: 'write' },
  loudness: { input: 'read', output: 'write' },
  metadata: {
    input: 'read',
    chapters: 'read',
    output: 'write',
    chapters_out: 'write',
    description_out: 'write',
  },
  multicam: {
    inputs: 'read',
    output: 'write',
    edl: 'write',
    write_project: 'write',
  },
  overlay: {
    input: 'read',
    image: 'read',
    video: 'read',
    brand: 'read',
    font_file: 'read',
    emoji_assets: 'read',
    output: 'write',
  },
  pad: { input: 'read', output: 'write' },
  probe: { inputs: 'read' },
  proxy: { input: 'read', output: 'write' },
  redact: { input: 'read', output: 'write' },
  render: {
    project: 'read',
    init: 'write',
    work: 'write',
    cache: 'write',
    export_timeline: 'write',
    cues: 'read',
    srt: 'read',
    logo: 'read',
    brand: 'read',
    chapters: 'read',
    image: 'read',
    output: 'write',
    write_project: 'write',
  },
  report: {
    after: 'read',
    pack: 'read',
    before: 'read',
    commands: 'read',
    notes: 'read',
    output: 'write',
  },
  reverse: { input: 'read', output: 'write' },
  scenes: { input: 'read', edl: 'write', sheet: 'write' },
  sequence: { dir: 'read', output: 'write' },
  silence: {
    input: 'read',
    filler_words: 'read',
    words: 'read',
    output: 'write',
    edl: 'write',
  },
  speedramp: { input: 'read', output: 'write' },
  sphere: { input: 'read', output: 'write' },
  stabilize: { input: 'read', output: 'write' },
  straighten: { input: 'read', output: 'write' },
  sync: {
    reference: 'read',
    second: 'read',
    more_sources: 'read',
    output: 'write',
  },
  verify: { paths: 'read', out: 'write', report: 'write' },
  waveform: {
    input: 'read',
    image: 'read',
    srt: 'read',
    text: 'read',
    brand: 'read',
    output: 'write',
  },
};

/** Read arguments whose value is optional and not always a path. */
const OPTIONAL_PATHS = new Set([
  'caption.input',
  'caption.model',
  'export.input',
  'render.project',
]);

const MANIFEST_EXTENSIONS = new Set([
  '.m3u',
  '.m3u8',
  '.m3u8.txt',
  '.ffconcat',
  '.concat',
]);

const NESTED_READ_KEYS = new Set([
  'src',
  'source',
  'path',
  'file',
  'font',
  'font_file',
  'fontfile',
  'fonts_dir',
  'lut',
  'logo',
  'image',
  'srt',
  'ass',
  'cues',
  'text',
  'music',
  'replace',
  'effects',
  'audio',
  'brand',
  'chapters',
  'emoji',
  'emoji_assets',
  'watermark',
  'overlay',
  'background',
]);

export interface AuthorizedOperation {
  args: SkillArgs;
  /** Resolved inputs, used to prove a preview or failure did not replace them. */
  inputs: string[];
  /** Staged output paths the tool was told to write. */
  outputs: string[];
  /** The caller's requested output paths, used only for the overwrite checks. */
  requestedOutputs: string[];
}

export function authorizeOperation(
  tool: ContractTool,
  args: SkillArgs,
  roots: SkillPathRoots,
  preview: boolean,
): AuthorizedOperation {
  rejectUnsupported(tool, args, preview);
  const paths = PATH_ARGUMENTS[tool.name];
  if (!paths) {
    throw new FfmpegSkillError(
      'missing_runtime',
      `${tool.name} has no path classification. Refusing to run it.`,
    );
  }
  const authorized: SkillArgs = { ...args };
  const inputs: string[] = [];
  const outputs: string[] = [];
  const requestedOutputs: string[] = [];
  for (const [key, access] of Object.entries(paths)) {
    const value = args[key];
    if (typeof value !== 'string' && !Array.isArray(value)) continue;
    const values = Array.isArray(value) ? value : [value];
    const resolved = values.map((entry) =>
      authorizeOne(
        tool.name,
        key,
        entry,
        access,
        roots,
        inputs,
        outputs,
        requestedOutputs,
      ),
    );
    authorized[key] = Array.isArray(value)
      ? resolved.filter((entry): entry is string => entry !== null)
      : (resolved[0] ?? '');
  }
  assertNoInputOverwrite(inputs, requestedOutputs);
  return { args: authorized, inputs, outputs, requestedOutputs };
}

function authorizeOne(
  toolName: string,
  key: string,
  value: string,
  access: 'read' | 'write',
  roots: SkillPathRoots,
  inputs: string[],
  outputs: string[],
  requestedOutputs: string[],
): string | null {
  if (value.trim() === '') return null;
  if (OPTIONAL_PATHS.has(`${toolName}.${key}`) && !looksLikePath(value)) {
    return value;
  }
  const resolved = resolveSkillPath(
    stripLanguageSuffix(toolName, key, value),
    roots,
    access,
  );
  if (access === 'read') {
    inputs.push(resolved.real);
    inspectNested(toolName, key, resolved.real, roots, inputs);
    return resolved.real;
  }
  guardOverwrite(resolved.real, value);
  requestedOutputs.push(resolved.real);
  const staged = stageWrite(roots.staging, resolved.real);
  outputs.push(staged);
  return staged;
}

/**
 * Every write lands in the run's private staging directory, preserving the
 * filename. Publication into task/design/video assets is a later handoff.
 */
function stageWrite(staging: string, real: string): string {
  return join(staging, basename(real));
}

function rejectUnsupported(
  tool: ContractTool,
  args: SkillArgs,
  preview: boolean,
): void {
  if (
    args.transcribe === true &&
    (tool.name === 'caption' || tool.name === 'silence')
  ) {
    throw new FfmpegSkillError(
      'unsupported',
      `${tool.name} transcribe uses a local speech engine this host does not supervise. Supply a cue or word file instead.`,
    );
  }
  if (tool.name === 'batch' && args.watch !== undefined) {
    throw new FfmpegSkillError(
      'unsupported',
      'batch watch keeps running after the call returns. Run the recipe once instead.',
    );
  }
  if (tool.name === 'batch' && typeof args.recipe === 'string') {
    throw new FfmpegSkillError(
      'unsupported',
      'batch recipes are not executed. The host cannot parse every step a raw recipe names.',
    );
  }
  if (
    tool.name === 'render' &&
    typeof args.project === 'string' &&
    !args.template
  ) {
    throwIfPlan(args.project);
  }
  if (preview && PREVIEW_REJECTED_TOOLS.has(tool.name)) {
    throw new FfmpegSkillError(
      'unsupported',
      `preview cannot run ${tool.name}: it writes deliverables.`,
    );
  }
  if (preview && writesInPreview(tool, args)) {
    throw new FfmpegSkillError(
      'unsupported',
      `preview of ${tool.name} would write a file. Measure with probe, or pass dry_run.`,
    );
  }
}

function writesInPreview(tool: ContractTool, args: SkillArgs): boolean {
  if (args.dry_run === true) return false;
  if (tool.role === 'analysis') return false;
  if (tool.name === 'loudness' && args.measure_only === true) return false;
  if (
    tool.name === 'silence' &&
    (args.list === true || args.filler_list === true)
  ) {
    return false;
  }
  return tool.produces_artifact;
}

function throwIfPlan(project: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(project, 'utf8')) as unknown;
  } catch {
    return;
  }
  if (isRecord(parsed) && 'plan_version' in parsed) {
    throw new FfmpegSkillError(
      'unsupported',
      'Saved-plan replay is not available. The plan carries raw commands the host does not revalidate.',
    );
  }
}

function inspectNested(
  toolName: string,
  key: string,
  filePath: string,
  roots: SkillPathRoots,
  inputs: string[],
): void {
  let info: ReturnType<typeof statSync>;
  try {
    info = statSync(filePath);
  } catch {
    return;
  }
  if (info.isDirectory()) return;
  if (isManifest(filePath) || (toolName === 'join' && key === 'list')) {
    authorizeManifest(filePath, roots, inputs);
    return;
  }
  if (!filePath.endsWith('.json')) return;
  if (
    key === 'recipe' ||
    key === 'project' ||
    key === 'brand' ||
    key === 'words'
  ) {
    authorizeJsonDocument(filePath, roots, inputs);
  }
}

function authorizeManifest(
  filePath: string,
  roots: SkillPathRoots,
  inputs: string[],
): void {
  const text = readFileSync(filePath, 'utf8');
  const base = dirname(filePath);
  for (const reference of manifestReferences(text)) {
    const target = resolve(base, reference);
    const resolved = resolveSkillPath(target, roots, 'read');
    inputs.push(resolved.real);
    if (isManifest(resolved.real))
      authorizeManifest(resolved.real, roots, inputs);
  }
}

/** Pull file references out of an m3u, ffconcat, or one-path-per-line list. */
export function manifestReferences(text: string): string[] {
  const references: string[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const fileMatch = /^file\s+(['"]?)(.+?)\1$/i.exec(line);
    const target = fileMatch?.[2] ?? line;
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) && !target.startsWith('file:')) {
      throw new FfmpegSkillError(
        'path',
        `A playlist references "${target}", which is not a local file.`,
      );
    }
    const local = target.startsWith('file://')
      ? decodeURIComponent(target.slice('file://'.length))
      : target;
    references.push(local);
  }
  return references;
}

function authorizeJsonDocument(
  filePath: string,
  roots: SkillPathRoots,
  inputs: string[],
): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
  } catch {
    return;
  }
  if (isRecord(parsed) && 'plan_version' in parsed) {
    throw new FfmpegSkillError(
      'unsupported',
      'Saved-plan replay is not available. The plan carries raw commands the host does not revalidate.',
    );
  }
  const base = dirname(filePath);
  walkJson(parsed, (key, value) => {
    if (!NESTED_READ_KEYS.has(key) || !looksLikePath(value)) return;
    const resolved = resolveSkillPath(resolve(base, value), roots, 'read');
    inputs.push(resolved.real);
  });
}

function walkJson(
  value: unknown,
  visit: (key: string, value: string) => void,
): void {
  if (Array.isArray(value)) {
    for (const entry of value) walkJson(entry, visit);
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string') visit(key, entry);
    else walkJson(entry, visit);
  }
}

function guardOverwrite(real: string, original: string): void {
  try {
    if (statSync(real).isFile()) {
      throw new FfmpegSkillError(
        'path',
        `Refusing to overwrite "${original}". Write to a new file inside the session.`,
      );
    }
  } catch (error) {
    if (error instanceof FfmpegSkillError) throw error;
  }
}

function assertNoInputOverwrite(inputs: string[], outputs: string[]): void {
  for (const output of outputs) {
    if (inputs.some((input) => samePath(input, output))) {
      throw new FfmpegSkillError(
        'path',
        'Refusing to write over an input file. Choose a different output.',
      );
    }
  }
}

function stripLanguageSuffix(
  toolName: string,
  key: string,
  value: string,
): string {
  if (toolName === 'caption' && key === 'srt') {
    const index = value.lastIndexOf(':');
    if (
      index > 1 &&
      /^[a-z]{2,3}(?:-[a-z0-9]+)?$/i.test(value.slice(index + 1))
    ) {
      return value.slice(0, index);
    }
  }
  return value;
}

function looksLikePath(value: string): boolean {
  if (!value || value.length > 4096) return false;
  if (value.includes('/') || value.includes('\\') || value.startsWith('.')) {
    return true;
  }
  return /\.[a-z0-9]{1,5}$/i.test(basename(value));
}

function isManifest(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  for (const extension of MANIFEST_EXTENSIONS) {
    if (lower.endsWith(extension)) return true;
  }
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Read roots used by tests that want to assert the classification is total. */
export function pathArgumentsFor(
  toolName: string,
): Record<string, 'read' | 'write'> | undefined {
  const paths = PATH_ARGUMENTS[toolName];
  return paths ? { ...paths } : undefined;
}

export function sequenceFrames(directory: string, pattern: string): string {
  if (
    pattern.includes('..') ||
    pattern.includes('/') ||
    pattern.includes('\\')
  ) {
    throw new FfmpegSkillError(
      'path',
      'An image-sequence pattern must stay inside its directory.',
    );
  }
  return join(directory, pattern);
}

const MEDIA_EXTENSIONS = new Set([
  'mp4',
  'mov',
  'mkv',
  'webm',
  'avi',
  'ts',
  'm4v',
  'm4a',
  'mp3',
  'wav',
  'aac',
  'flac',
  'opus',
  'ogg',
  'wma',
  'flv',
]);

/**
 * A staged path for a producing tool whose output argument was omitted.
 *
 * The host supplies one so the tool's default (write next to the input, into
 * the session workspace) never happens. The extension follows the input; a
 * cosmetic mismatch is corrected at publication.
 */
export function stagedOutputName(
  staging: string,
  toolName: string,
  inputPath?: string,
): string {
  const extension = inputPath ? mediaExtension(inputPath) : '.mp4';
  const stem = inputPath ? basename(inputPath, extension) : 'output';
  return join(staging, `${stem}-${toolName}${extension}`);
}

function mediaExtension(filePath: string): string {
  const extension = extname(filePath).toLowerCase();
  if (
    extension &&
    extension.length <= 6 &&
    MEDIA_EXTENSIONS.has(extension.slice(1))
  ) {
    return extension;
  }
  return '.mp4';
}
