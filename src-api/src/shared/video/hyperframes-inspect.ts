import fs from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import {
  runStreamingCommand,
  StreamingCommandError,
  type StreamingCommandInput,
  type StreamingCommandResult,
} from '@/shared/process/run-streaming-command';
import { resolveHyperframesCommand } from '@/shared/services/design-mode/hyperframes-command';
import { createLogger } from '@/shared/utils/logger';

import { probeHyperframes } from './engines/hyperframes-adapter';

// Phase E verification surfaces (P2-1): `compare`, `grade-compare`, and
// `check --json` wrapped as typed, agent-callable diagnostics.
//
// Two properties of the CLI shape this module:
//  - JSON is written to stdout *after* human-readable preamble lines
//    (`[StaticGuard] …`, `[hyperframes] browserGpuMode probe → …`), so the
//    parser takes the last balanced top-level object rather than the buffer;
//  - `check` exits non-zero when it finds issues, and that is a *result*, not
//    a failure — the payload still has to be read off the failed run's stdout.

const logger = createLogger('HyperframesInspect');

const META_SCHEMA = z
  .object({
    version: z.string(),
    latestVersion: z.string().optional(),
    updateAvailable: z.boolean().optional(),
  })
  .loose();

const FINDING_SCHEMA = z
  .object({
    code: z.string(),
    severity: z.string(),
    message: z.string(),
    selector: z.string().optional(),
    sourceFile: z.string().optional(),
    time: z.number().optional(),
    fixHint: z.string().optional(),
  })
  .loose();

const PASS_SCHEMA = z
  .object({
    ok: z.boolean(),
    errorCount: z.number().int().min(0),
    warningCount: z.number().int().min(0),
    infoCount: z.number().int().min(0).optional(),
    findings: z.array(FINDING_SCHEMA).default([]),
    enabled: z.boolean().optional(),
  })
  .loose();

const CHECK_SCHEMA = z
  .object({
    ok: z.boolean(),
    strict: z.boolean().optional(),
    lint: PASS_SCHEMA,
    runtime: PASS_SCHEMA,
    layout: PASS_SCHEMA,
    motion: PASS_SCHEMA.optional(),
    contrast: PASS_SCHEMA.optional(),
    _meta: META_SCHEMA.optional(),
  })
  .loose();

const COMPARE_SCHEMA = z
  .object({
    ok: z.boolean(),
    sheet: z.string().optional(),
    variants: z
      .array(z.object({ label: z.string(), path: z.string() }).loose())
      .optional(),
    rendered: z.number().int().min(0).optional(),
    error: z.string().optional(),
    _meta: META_SCHEMA.optional(),
  })
  .loose();

const GRADE_COMPARE_SCHEMA = z
  .object({
    ok: z.boolean(),
    sheet: z.string().optional(),
    cells: z.number().int().min(0).optional(),
    error: z.string().optional(),
    _meta: META_SCHEMA.optional(),
  })
  .loose();

export type HyperframesCheckReport = z.infer<typeof CHECK_SCHEMA>;
export type HyperframesCompareResult = z.infer<typeof COMPARE_SCHEMA>;
export type HyperframesGradeCompareResult = z.infer<
  typeof GRADE_COMPARE_SCHEMA
>;

export type HyperframesInspectErrorCode =
  | 'not-found'
  | 'version-too-old'
  | 'browser-missing'
  | 'invalid-input'
  | 'malformed-json'
  | 'command-failed';

export class HyperframesInspectError extends Error {
  constructor(
    public readonly code: HyperframesInspectErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'HyperframesInspectError';
  }
}

type RunCommand = (
  input: StreamingCommandInput,
) => Promise<StreamingCommandResult>;

export interface HyperframesInspectDeps {
  command?: string;
  runCommand?: RunCommand;
}

/** Timeouts are per-command: a browser session is the slow part everywhere. */
export const COMPARE_TIMEOUT_MS = 180_000;
const CHECK_TIMEOUT_MS = 240_000;

export interface CompareVariantInput {
  label: string;
  /** Absolute composition directory (or index.html) for this variant. */
  compositionPath: string;
}

export interface CompareVariantsInput {
  variants: CompareVariantInput[];
  /** Timeline time to seek before screenshotting every variant. */
  atSec?: number;
  outputPath: string;
  cols?: number;
  cwd: string;
  signal?: AbortSignal;
}

export async function compareHyperframesVariants(
  input: CompareVariantsInput,
  deps: HyperframesInspectDeps = {},
): Promise<HyperframesCompareResult> {
  if (input.variants.length < 2) {
    throw new HyperframesInspectError(
      'invalid-input',
      'video_compare_variants needs at least two variants.',
    );
  }
  const { command, runCommand } = await resolveRuntime(input.cwd, deps);
  const args = [
    'compare',
    ...input.variants.map((variant) => variant.compositionPath),
    '--labels',
    input.variants.map((variant) => variant.label).join(','),
    '--out',
    path.resolve(input.outputPath),
    '--json',
  ];
  if (input.atSec !== undefined) args.push('--at', String(input.atSec));
  if (input.cols !== undefined) args.push('--cols', String(input.cols));

  await fs.mkdir(path.dirname(path.resolve(input.outputPath)), {
    recursive: true,
  });
  const payload = await runJson({
    command,
    runCommand,
    args,
    cwd: input.cwd,
    timeoutMs: COMPARE_TIMEOUT_MS,
    signal: input.signal,
  });
  const result = parseWith(COMPARE_SCHEMA, payload, 'compare');
  if (!result.ok) {
    throw new HyperframesInspectError(
      'command-failed',
      result.error ?? 'HyperFrames compare failed.',
    );
  }
  return result;
}

export interface GradeCandidate {
  label: string;
  /** Canonical HyperFrames color-grading patch. Validated by the CLI. */
  grading: Record<string, unknown>;
}

export interface CompareGradesInput {
  /** Reference image, or a video sampled at t=0. */
  referencePath: string;
  grades?: GradeCandidate[];
  /** `.cube` LUT candidate paths. */
  luts?: string[];
  outputPath: string;
  /** Base directory for relative reference/grade/LUT paths. */
  projectDir: string;
  baseline?: boolean;
  cwd: string;
  signal?: AbortSignal;
}

export async function compareHyperframesGrades(
  input: CompareGradesInput,
  deps: HyperframesInspectDeps = {},
): Promise<HyperframesGradeCompareResult> {
  const grades = input.grades ?? [];
  const luts = input.luts ?? [];
  if (grades.length === 0 && luts.length === 0) {
    throw new HyperframesInspectError(
      'invalid-input',
      'video_compare_grades needs at least one grade candidate or LUT.',
    );
  }
  const { command, runCommand } = await resolveRuntime(input.cwd, deps);
  const outputPath = path.resolve(input.outputPath);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  // `--grades` takes a *file path*, not inline JSON (the CLI's own help text
  // is misleading here; passing JSON makes it look for a file by that name).
  let gradesFile: string | undefined;
  if (grades.length > 0) {
    gradesFile = path.join(
      path.dirname(outputPath),
      `${path.basename(outputPath, path.extname(outputPath))}.grades.json`,
    );
    await fs.writeFile(gradesFile, JSON.stringify(grades), 'utf8');
  }

  const args = [
    'grade-compare',
    '--for',
    input.referencePath,
    '--project',
    input.projectDir,
    '--out',
    outputPath,
    '--json',
  ];
  if (gradesFile) args.push('--grades', gradesFile);
  if (luts.length > 0) args.push('--luts', luts.join(','));
  if (input.baseline === false) args.push('--no-baseline');

  try {
    const payload = await runJson({
      command,
      runCommand,
      args,
      cwd: input.cwd,
      timeoutMs: COMPARE_TIMEOUT_MS,
      signal: input.signal,
    });
    const result = parseWith(GRADE_COMPARE_SCHEMA, payload, 'grade-compare');
    if (!result.ok) {
      throw new HyperframesInspectError(
        'command-failed',
        result.error ?? 'HyperFrames grade-compare failed.',
      );
    }
    return result;
  } finally {
    if (gradesFile) await fs.rm(gradesFile, { force: true });
  }
}

export interface CheckCompositionInput {
  compositionDir: string;
  /** Number of midpoint samples across the duration. */
  samples?: number;
  /** Explicit timestamps in seconds. Wins over `samples` in the CLI. */
  atSec?: number[];
  atTransitions?: boolean;
  contrast?: boolean;
  strict?: boolean;
  maxIssues?: number;
  cwd: string;
  signal?: AbortSignal;
}

export async function checkHyperframesComposition(
  input: CheckCompositionInput,
  deps: HyperframesInspectDeps = {},
): Promise<HyperframesCheckReport> {
  const { command, runCommand } = await resolveRuntime(input.cwd, deps);
  const args = ['check', input.compositionDir, '--json'];
  if (input.samples !== undefined)
    args.push('--samples', String(input.samples));
  if (input.atSec?.length) args.push('--at', input.atSec.join(','));
  if (input.atTransitions) args.push('--at-transitions');
  if (input.contrast === false) args.push('--no-contrast');
  if (input.strict) args.push('--strict');
  if (input.maxIssues !== undefined) {
    args.push('--max-issues', String(input.maxIssues));
  }
  // A non-zero exit means "issues found", which is the report we want.
  const payload = await runJson({
    command,
    runCommand,
    args,
    cwd: input.cwd,
    timeoutMs: CHECK_TIMEOUT_MS,
    signal: input.signal,
    allowNonZeroExit: true,
  });
  return parseWith(CHECK_SCHEMA, payload, 'check');
}

async function resolveRuntime(
  cwd: string,
  deps: HyperframesInspectDeps,
): Promise<{ command: string; runCommand: RunCommand }> {
  const command = deps.command ?? resolveHyperframesCommand();
  const runCommand = deps.runCommand ?? runStreamingCommand;
  const availability = await probeHyperframes(command, runCommand, cwd);
  if (!availability.installed) {
    throw new HyperframesInspectError(
      availability.reason,
      availability.detail ??
        `HyperFrames ${availability.reason.replaceAll('-', ' ')}`,
    );
  }
  return { command, runCommand };
}

async function runJson(input: {
  command: string;
  runCommand: RunCommand;
  args: string[];
  cwd: string;
  timeoutMs: number;
  signal?: AbortSignal;
  allowNonZeroExit?: boolean;
}): Promise<unknown> {
  try {
    const result = await input.runCommand({
      bin: input.command,
      args: input.args,
      cwd: input.cwd,
      timeoutMs: input.timeoutMs,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    return parseTrailingJson(result.stdout);
  } catch (error) {
    if (
      error instanceof StreamingCommandError &&
      error.code === 'failed' &&
      error.stdout
    ) {
      if (input.allowNonZeroExit) return parseTrailingJson(error.stdout);
      // Even on a hard failure the CLI usually emits `{ ok:false, error }`.
      const payload = tryParseTrailingJson(error.stdout);
      if (payload) return payload;
    }
    if (error instanceof HyperframesInspectError) throw error;
    logger.warn(
      `hyperframes ${input.args[0]} failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    throw new HyperframesInspectError(
      'command-failed',
      error instanceof Error ? error.message : String(error),
    );
  }
}

function parseWith<Schema extends z.ZodType>(
  schema: Schema,
  payload: unknown,
  label: string,
): z.infer<Schema> {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new HyperframesInspectError(
      'malformed-json',
      `HyperFrames ${label} returned an unexpected JSON shape: ${parsed.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ')}`,
    );
  }
  return parsed.data;
}

/**
 * Take the last balanced top-level `{…}` object in the buffer. The CLI writes
 * progress and guard lines to stdout before the JSON result, so `JSON.parse`
 * on the whole buffer would always fail.
 */
export function parseTrailingJson(stdout: string): unknown {
  const payload = tryParseTrailingJson(stdout);
  if (payload === undefined) {
    throw new HyperframesInspectError(
      'malformed-json',
      'HyperFrames returned no parsable JSON object.',
    );
  }
  return payload;
}

function tryParseTrailingJson(stdout: string): unknown {
  let found = false;
  let last: unknown;
  let start = stdout.indexOf('{');
  while (start !== -1) {
    const candidate = stdout.slice(start);
    try {
      // The whole remainder is one JSON document — nothing follows it, so
      // there is nothing left to scan for a later top-level object.
      last = JSON.parse(candidate);
      found = true;
      break;
    } catch {
      /* the object is followed by trailing output, or starts later */
    }
    const end = matchingBraceEnd(candidate);
    if (end !== -1) {
      try {
        last = JSON.parse(candidate.slice(0, end));
        found = true;
      } catch {
        /* not a JSON object after all — keep scanning */
      }
      // Skip past this whole balanced span, valid or not, so a `{` nested
      // inside it (e.g. a sub-object's own field) is never mistaken for the
      // start of a separate, later top-level object.
      start = stdout.indexOf('{', start + end);
      continue;
    }
    start = stdout.indexOf('{', start + 1);
  }
  return found ? last : undefined;
}

function matchingBraceEnd(text: string): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return -1;
}

/** Compact roll-up used by the QA panel and the MCP text result. */
export function summarizeHyperframesCheck(report: HyperframesCheckReport): {
  ok: boolean;
  errorCount: number;
  warningCount: number;
  passes: Array<{
    key: string;
    ok: boolean;
    errorCount: number;
    warningCount: number;
    enabled: boolean;
  }>;
} {
  const candidates: Array<[string, z.infer<typeof PASS_SCHEMA> | undefined]> = [
    ['lint', report.lint],
    ['runtime', report.runtime],
    ['layout', report.layout],
    ['motion', report.motion],
    ['contrast', report.contrast],
  ];
  const passes = candidates.flatMap(([key, pass]) =>
    pass
      ? [
          {
            key,
            ok: pass.ok,
            errorCount: pass.errorCount,
            warningCount: pass.warningCount,
            enabled: pass.enabled ?? true,
          },
        ]
      : [],
  );
  return {
    ok: report.ok,
    errorCount: passes.reduce((total, pass) => total + pass.errorCount, 0),
    warningCount: passes.reduce((total, pass) => total + pass.warningCount, 0),
    passes,
  };
}
