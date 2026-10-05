/**
 * One managed FFmpeg skill operation.
 *
 * Validates the request, runs the vendored script under the supervisor, and
 * returns the script's own JSON unchanged under `details`. Process status,
 * artifact creation, and property verification stay separate facts.
 * Publication into task, design, or video assets is a later handoff.
 */

import { createHash } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import { memoryBudgetSupervisor } from '@/shared/services/memory-budget';

import { buildArgv, prepareArgs, type SkillArgs } from './argv';
import { loadFfmpegContract, type ContractTool } from './contract';
import { FfmpegSkillError, isFfmpegSkillError } from './errors';
import { skillPathRoots } from './paths';
import {
  authorizeOperation,
  pathArgumentsFor,
  stagedOutputName,
} from './policy';
import { resolveSkillRuntime, skillProcessEnv } from './runtime';
import { runSupervised, type SupervisedRunResult } from './supervisor';

export interface SkillProgress {
  stage: 'running' | 'finished';
  line?: string;
}

export interface ExecuteSkillInput {
  tool: string;
  args?: unknown;
  preview?: boolean;
  signal?: AbortSignal;
  /** Whole-operation deadline. Defaults to 30 minutes. */
  timeoutMs?: number;
  onProgress?: (progress: SkillProgress) => void;
}

export type OperationStatus =
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timed_out';

export type VisualInspection = 'not_applicable' | 'required' | 'unavailable';

export interface SkillArtifact {
  /** Validated absolute path inside the run staging directory or a write root. */
  path: string;
  bytes: number;
  sha256: string;
}

export interface SkillOperationResult {
  status: OperationStatus;
  tool: string;
  exitCode: number | null;
  /** True only when a non-empty output file was validated. */
  artifactCreated: boolean;
  /** True only when the tool's own JSON says verified. Never implied by exit 0. */
  verified: boolean;
  /** Preview is always unverified and never a deliverable. */
  preview: boolean;
  visualInspection: VisualInspection;
  artifact: SkillArtifact | null;
  /** The tool's own JSON document, unflattened. */
  details: unknown;
  stderr: string;
  durationMs: number;
  error?: { kind: string; message: string };
}

export async function executeSkillOperation(
  input: ExecuteSkillInput,
): Promise<SkillOperationResult> {
  const loaded = await loadFfmpegContract();
  const tool = loaded.tools.get(input.tool);
  if (!tool) {
    throw new FfmpegSkillError(
      'input',
      `Unknown FFmpeg skill tool "${input.tool}". Call ffmpeg_skill_catalog for the tool names.`,
    );
  }
  const prepared = prepareArgs(tool, input.args);
  const runtime = resolveSkillRuntime(loaded.payloadVersion);
  const staging = await realpath(
    await mkdtemp(join(tmpdir(), 'neumar-ffmpeg-skill-')),
  );
  const roots = skillPathRoots(staging);
  const authorized = authorizeOperation(
    tool,
    prepared.args,
    roots,
    input.preview === true,
  );
  if (
    input.preview !== true &&
    authorized.args.dry_run !== true &&
    tool.produces_artifact &&
    tool.role !== 'analysis' &&
    !authorized.args.output &&
    pathArgumentsFor(tool.name)?.output
  ) {
    // Supply a staged output so the tool's own default never writes into the
    // session workspace.
    authorized.args.output = stagedOutputName(
      staging,
      tool.name,
      authorized.inputs[0],
    );
    authorized.outputs.push(authorized.args.output);
  }
  const argv = buildArgv(tool, authorized.args);
  const script = join(loaded.skillDir, tool.executable);
  if (
    !tool.executable.startsWith('scripts/') ||
    tool.executable.includes('..')
  ) {
    throw new FfmpegSkillError(
      'missing_runtime',
      `${tool.name} has an unexpected executable path in the contract.`,
    );
  }

  let run: SupervisedRunResult;
  try {
    run = await memoryBudgetSupervisor.runWithFfmpegSlot(
      () =>
        runSupervised({
          command: runtime.python.command,
          args: [...runtime.python.prefixArgs, script, ...argv],
          cwd: loaded.skillDir,
          env: skillProcessEnv(runtime),
          signal: input.signal,
          timeoutMs: operationTimeout(input, authorized.args),
          onProgress: (line) => input.onProgress?.({ stage: 'running', line }),
        }),
      input.signal,
    );
  } catch (error) {
    if (isFfmpegSkillError(error) && isTerminal(error.kind)) {
      await discardStaging(staging);
      return terminalResult(tool, input.preview === true, error);
    }
    throw error;
  }

  if (input.signal?.aborted) {
    await discardStaging(staging);
    return terminalResult(
      tool,
      input.preview === true,
      new FfmpegSkillError(
        'aborted',
        'The operation was cancelled and its output was not published.',
      ),
    );
  }

  const details = parseDetails(run.stdout);
  const artifact = await validatedArtifact(
    details,
    authorized.outputs,
    staging,
  );
  const verified = detailsVerified(details);
  const failed = run.exitCode !== 0;
  input.onProgress?.({ stage: 'finished' });
  return {
    status: failed ? 'failed' : 'completed',
    tool: tool.name,
    exitCode: run.exitCode,
    artifactCreated: artifact !== null,
    verified: input.preview === true ? false : verified,
    preview: input.preview === true,
    visualInspection: visualState(tool, input.preview === true),
    artifact,
    details,
    stderr: run.stderr.slice(-4000),
    durationMs: run.durationMs,
    ...(failed
      ? {
          error: {
            kind: detailKind(details) ?? 'failed',
            message:
              detailMessage(details) ?? `${tool.name} exited ${run.exitCode}.`,
          },
        }
      : {}),
  };
}

function operationTimeout(input: ExecuteSkillInput, args: SkillArgs): number {
  const requested =
    typeof args.timeout === 'number' ? args.timeout * 1000 : undefined;
  const ceiling = input.timeoutMs ?? 30 * 60 * 1000;
  if (requested === undefined) return ceiling;
  return Math.min(requested + 60_000, ceiling);
}

function isTerminal(kind: string): boolean {
  return kind === 'aborted' || kind === 'timeout' || kind === 'output_limit';
}

function terminalResult(
  tool: ContractTool,
  preview: boolean,
  error: FfmpegSkillError,
): SkillOperationResult {
  const status: OperationStatus =
    error.kind === 'timeout' ? 'timed_out' : 'cancelled';
  return {
    status,
    tool: tool.name,
    exitCode: null,
    artifactCreated: false,
    verified: false,
    preview,
    visualInspection: visualState(tool, preview),
    artifact: null,
    details: null,
    stderr: '',
    durationMs: 0,
    error: { kind: error.kind, message: error.message },
  };
}

function parseDetails(stdout: string): unknown {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  const start = trimmed.indexOf('{');
  const list = trimmed.indexOf('[');
  const open =
    start === -1 ? list : list === -1 ? start : Math.min(start, list);
  if (open === -1) return { text: trimmed.slice(0, 4000) };
  try {
    return JSON.parse(trimmed.slice(open)) as unknown;
  } catch {
    return { text: trimmed.slice(0, 4000) };
  }
}

async function validatedArtifact(
  details: unknown,
  outputs: string[],
  staging: string,
): Promise<SkillArtifact | null> {
  const declared = declaredOutput(details);
  const candidate = declared ?? outputs[0] ?? null;
  if (!candidate) {
    await discardStaging(staging);
    return null;
  }
  try {
    const info = await stat(candidate);
    if (!info.isFile() || info.size <= 0) {
      await discardStaging(staging);
      return null;
    }
    const bytes = await readFile(candidate);
    const artifact = {
      path: candidate,
      bytes: info.size,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
    if (!candidate.startsWith(staging)) await discardStaging(staging);
    return artifact;
  } catch {
    await discardStaging(staging);
    return null;
  }
}

function declaredOutput(details: unknown): string | null {
  if (!details || typeof details !== 'object') return null;
  const output = (details as { output?: unknown }).output;
  return typeof output === 'string' && output.trim() ? output : null;
}

function detailsVerified(details: unknown): boolean {
  if (!details || typeof details !== 'object') return false;
  return (details as { verified?: unknown }).verified === true;
}

function detailKind(details: unknown): string | null {
  const error = recordError(details);
  return typeof error?.kind === 'string' ? error.kind : null;
}

function detailMessage(details: unknown): string | null {
  const error = recordError(details);
  return typeof error?.message === 'string' ? error.message : null;
}

function recordError(
  details: unknown,
): { kind?: unknown; message?: unknown } | null {
  if (!details || typeof details !== 'object') return null;
  const error = (details as { error?: unknown }).error;
  return error && typeof error === 'object'
    ? (error as { kind?: unknown; message?: unknown })
    : null;
}

function visualState(tool: ContractTool, preview: boolean): VisualInspection {
  if (preview) return 'unavailable';
  return tool.requires_visual_verification ? 'required' : 'not_applicable';
}

async function discardStaging(staging: string): Promise<void> {
  await rm(staging, { recursive: true, force: true });
}

/** Files the tool itself named, for diagnostics. Not a publish step. */
export function artifactName(artifact: SkillArtifact | null): string | null {
  return artifact ? basename(artifact.path) : null;
}
