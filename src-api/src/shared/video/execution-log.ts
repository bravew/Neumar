import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { createLogger } from '@/shared/utils/logger';

import { readVideoAgentPlan } from './agent-plan';
import { getProject, getVideoProjectDir } from './store';

export type VideoExecutionPhase =
  | 'started'
  | 'succeeded'
  | 'failed'
  | 'partial-success'
  | 'skipped'
  | 'rolled-back';

export interface VideoExecutionLogRecord {
  schemaVersion: 1;
  sequence: number;
  timestamp: string;
  runId: string;
  planId: string;
  planRevision: number;
  stepId: string;
  attempt: number;
  phase: VideoExecutionPhase;
  operation: string;
  idempotencyKey: string;
  inputDigest: string;
  projectRevisionBefore: number;
  projectRevisionAfter?: number;
  intentLogId?: string;
  journalEntryIds?: string[];
  result?: Record<string, unknown>;
  error?: { code: string; message: string; committed: boolean };
  verification?: Record<string, unknown>;
}

export type VideoExecutionLogAppendInput = Omit<
  VideoExecutionLogRecord,
  'schemaVersion' | 'sequence' | 'timestamp'
>;

export interface VideoExecutionLogOptions {
  maxBytes?: number;
  now?: string;
}

const DEFAULT_EXECUTION_LOG_MAX_BYTES = 5 * 1024 * 1024;
const logLocks = new Map<string, Promise<unknown>>();
const logger = createLogger('VideoExecutionLog');

export async function appendVideoExecutionLog(
  projectId: string,
  input: VideoExecutionLogAppendInput,
  options: VideoExecutionLogOptions = {},
): Promise<VideoExecutionLogRecord> {
  return withLogLock(projectId, async () => {
    const existing = await readVideoExecutionLog(projectId);
    const record: VideoExecutionLogRecord = {
      ...redactValue(input),
      schemaVersion: 1,
      sequence: (existing.at(-1)?.sequence ?? 0) + 1,
      timestamp: options.now ?? new Date().toISOString(),
    };
    const filePath = getVideoExecutionLogPath(projectId);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const line = `${JSON.stringify(record)}\n`;
    await rotateExecutionLogIfNeeded(
      filePath,
      Buffer.byteLength(line),
      options.maxBytes ?? DEFAULT_EXECUTION_LOG_MAX_BYTES,
    );
    const handle = await fs.open(filePath, 'a');
    try {
      await handle.appendFile(line, 'utf8');
      if (record.phase !== 'started') await handle.sync();
    } finally {
      await handle.close();
    }
    if (record.phase !== 'started') {
      logger.info('video.agent.execution_terminal', {
        project_id: projectId,
        plan_id: record.planId,
        plan_revision: record.planRevision,
        step_id: record.stepId,
        attempt: record.attempt,
        phase: record.phase,
        committed: record.error?.committed ?? false,
      });
    }
    return record;
  });
}

export async function readVideoExecutionLog(
  projectId: string,
): Promise<VideoExecutionLogRecord[]> {
  const dir = path.join(getVideoProjectDir(projectId), 'agent');
  const entries = await fs.readdir(dir).catch(() => []);
  const files = entries
    .filter((entry) => /^execution-log(?:\.\d+)?\.jsonl$/.test(entry))
    .sort(executionLogFileOrder);
  const records: VideoExecutionLogRecord[] = [];
  for (const file of files) {
    const raw = await fs.readFile(path.join(dir, file), 'utf8');
    const lines = raw.split('\n');
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]?.trim();
      if (!line) continue;
      try {
        records.push(JSON.parse(line) as VideoExecutionLogRecord);
      } catch (error) {
        const isTruncatedTail =
          file === 'execution-log.jsonl' && index === lines.length - 1;
        if (!isTruncatedTail) throw error;
      }
    }
  }
  return records.sort((a, b) => a.sequence - b.sequence);
}

export function getVideoExecutionLogPath(projectId: string): string {
  return path.join(
    getVideoProjectDir(projectId),
    'agent',
    'execution-log.jsonl',
  );
}

/**
 * Project revision an in-flight plan expects to see right now, or `undefined`
 * when the plan has not landed a step yet.
 *
 * The cursor exists to catch an edit that arrives from outside the plan while
 * the plan is running, so it is defined by what the plan has actually
 * committed — not by the project revision at the time the plan was written. A
 * plan that has done nothing yet constrains nothing: the user is free to keep
 * editing between writing a plan and running it.
 */
export function expectedProjectRevisionForPlan(
  plan: { id: string; revision: number },
  records: readonly VideoExecutionLogRecord[],
): number | undefined {
  const own = records.filter(
    (record) =>
      record.planId === plan.id && record.planRevision === plan.revision,
  );
  if (own.length === 0) return undefined;
  // A record that reached a terminal phase reports the revision it produced.
  // One that did not — a `started` with no terminal record, or a failure that
  // never committed — reports the revision it expected to leave behind. That
  // second case is what catches a step which committed and then died before
  // its terminal write: the project has moved past a revision no record
  // accounts for.
  return Math.max(
    ...own.map(
      (record) => record.projectRevisionAfter ?? record.projectRevisionBefore,
    ),
  );
}

export async function runLoggedVideoOperation<T>(input: {
  projectId: string;
  operation: string;
  operationInput: unknown;
  execute: () => Promise<T>;
}): Promise<T> {
  const before = await getProject(input.projectId);
  const plan = before.agentPlan;
  if (!plan || !['active', 'executing', 'paused'].includes(plan.status)) {
    return input.execute();
  }
  const planRead = await readVideoAgentPlan(input.projectId);
  if (planRead.drifted && input.operation !== 'video_get_plan') {
    throw new Error(
      'Durable video plan has changed on disk; import it as a new plan revision before execution.',
    );
  }
  const normalizedOperation = input.operation.replace(/^mcp__video-edit__/, '');
  const step =
    plan.steps.find(
      (candidate) =>
        candidate.operation === normalizedOperation ||
        candidate.operation === input.operation,
    ) ?? plan.steps[0];
  if (!step)
    throw new Error('The durable video plan contains no executable steps');
  const inputDigest = digestStable(input.operationInput);
  const priorRecords = await readVideoExecutionLog(input.projectId);
  const identity = {
    runId: randomUUID(),
    planId: plan.id,
    planRevision: plan.revision,
    stepId: step.id,
    attempt: nextAttempt(
      priorRecords,
      plan.id,
      plan.revision,
      step.id,
      normalizedOperation,
    ),
    operation: normalizedOperation,
    idempotencyKey: digestStable({
      planId: plan.id,
      planRevision: plan.revision,
      stepId: step.id,
      operation: normalizedOperation,
      inputDigest,
    }),
    inputDigest,
    projectRevisionBefore: before.revision,
  };
  const priorSuccess = [...priorRecords]
    .reverse()
    .find(
      (record) =>
        record.idempotencyKey === identity.idempotencyKey &&
        (record.phase === 'succeeded' || record.phase === 'skipped'),
    );
  if (
    priorSuccess &&
    operationPostconditionHolds(
      normalizedOperation,
      input.operationInput,
      before,
    )
  ) {
    await appendVideoExecutionLog(input.projectId, {
      ...identity,
      phase: 'started',
    });
    await appendVideoExecutionLog(input.projectId, {
      ...identity,
      phase: 'skipped',
      projectRevisionAfter: before.revision,
      result: { replayedSequence: priorSuccess.sequence },
      verification: { postcondition: 'already-satisfied' },
    });
    return replayToolResult(priorSuccess) as T;
  }
  const uncertainAttempt = [...priorRecords]
    .reverse()
    .find(
      (record) =>
        record.idempotencyKey === identity.idempotencyKey &&
        record.phase === 'started' &&
        !priorRecords.some(
          (candidate) =>
            candidate.sequence > record.sequence &&
            candidate.idempotencyKey === record.idempotencyKey &&
            candidate.phase !== 'started',
        ),
    );
  if (
    uncertainAttempt &&
    requiresApprovalForUncertainRetry(normalizedOperation)
  ) {
    throw new Error(
      `Outcome of ${normalizedOperation} attempt ${uncertainAttempt.attempt} is uncertain; explicit user approval is required before retrying.`,
    );
  }
  await appendVideoExecutionLog(input.projectId, {
    ...identity,
    phase: 'started',
  });
  try {
    const result = await input.execute();
    const after = await getProject(input.projectId);
    const error = toolResultError(result);
    const journalEntryIds = journalIdsAdded(before, after);
    await appendVideoExecutionLog(input.projectId, {
      ...identity,
      phase: error
        ? error.committed
          ? 'partial-success'
          : 'failed'
        : 'succeeded',
      projectRevisionAfter: after.revision,
      ...(journalEntryIds.length > 0 ? { journalEntryIds } : {}),
      ...(error ? { error } : { result: summarizeResult(result) }),
    });
    return result;
  } catch (error) {
    const after = await getProject(input.projectId).catch(() => before);
    await appendVideoExecutionLog(input.projectId, {
      ...identity,
      phase: after.revision > before.revision ? 'partial-success' : 'failed',
      projectRevisionAfter: after.revision,
      journalEntryIds: journalIdsAdded(before, after),
      error: {
        code: 'VIDEO_OPERATION_ERROR',
        message: error instanceof Error ? error.message : String(error),
        committed: after.revision > before.revision,
      },
    });
    throw error;
  }
}

export async function runLoggedVideoRollback<T>(input: {
  projectId: string;
  journalEntryId: string;
  execute: () => Promise<T>;
}): Promise<T> {
  const before = await getProject(input.projectId);
  const plan = before.agentPlan;
  if (!plan || !['active', 'executing', 'paused'].includes(plan.status)) {
    return input.execute();
  }
  const records = await readVideoExecutionLog(input.projectId);
  const source = [...records]
    .reverse()
    .find((record) => record.journalEntryIds?.includes(input.journalEntryId));
  const stepId = source?.stepId ?? plan.steps[0]?.id;
  if (!stepId) throw new Error('Approved video plan contains no rollback step');
  const operation = 'video_rollback_agent_journal_entry';
  const identity = {
    runId: randomUUID(),
    planId: plan.id,
    planRevision: plan.revision,
    stepId,
    attempt: nextAttempt(records, plan.id, plan.revision, stepId, operation),
    operation,
    idempotencyKey: digestStable({
      planId: plan.id,
      planRevision: plan.revision,
      stepId,
      operation,
      journalEntryId: input.journalEntryId,
    }),
    inputDigest: digestStable({ journalEntryId: input.journalEntryId }),
    projectRevisionBefore: before.revision,
  };
  await appendVideoExecutionLog(input.projectId, {
    ...identity,
    phase: 'started',
  });
  try {
    const result = await input.execute();
    const after = await getProject(input.projectId);
    await appendVideoExecutionLog(input.projectId, {
      ...identity,
      phase: 'rolled-back',
      projectRevisionAfter: after.revision,
      journalEntryIds: [input.journalEntryId],
      result: summarizeResult(result),
      verification: { journalEntryState: 'undone' },
    });
    return result;
  } catch (error) {
    const after = await getProject(input.projectId).catch(() => before);
    await appendVideoExecutionLog(input.projectId, {
      ...identity,
      phase: after.revision > before.revision ? 'partial-success' : 'failed',
      projectRevisionAfter: after.revision,
      journalEntryIds: [input.journalEntryId],
      error: {
        code: 'VIDEO_ROLLBACK_ERROR',
        message: error instanceof Error ? error.message : String(error),
        committed: after.revision > before.revision,
      },
    });
    throw error;
  }
}

async function rotateExecutionLogIfNeeded(
  filePath: string,
  incomingBytes: number,
  maxBytes: number,
): Promise<void> {
  const stat = await fs.stat(filePath).catch(() => undefined);
  if (!stat || stat.size === 0 || stat.size + incomingBytes <= maxBytes) return;
  const dir = path.dirname(filePath);
  const entries = await fs.readdir(dir);
  const nextIndex =
    entries.reduce((max, entry) => {
      const match = /^execution-log\.(\d+)\.jsonl$/.exec(entry);
      return match ? Math.max(max, Number(match[1])) : max;
    }, 0) + 1;
  await fs.rename(filePath, path.join(dir, `execution-log.${nextIndex}.jsonl`));
}

function executionLogFileOrder(a: string, b: string): number {
  if (a === 'execution-log.jsonl') return 1;
  if (b === 'execution-log.jsonl') return -1;
  const aIndex = Number(/^execution-log\.(\d+)\.jsonl$/.exec(a)?.[1] ?? 0);
  const bIndex = Number(/^execution-log\.(\d+)\.jsonl$/.exec(b)?.[1] ?? 0);
  return aIndex - bIndex;
}

function nextAttempt(
  records: VideoExecutionLogRecord[],
  planId: string,
  planRevision: number,
  stepId: string,
  operation: string,
): number {
  return (
    records.filter(
      (record) =>
        record.phase === 'started' &&
        record.planId === planId &&
        record.planRevision === planRevision &&
        record.stepId === stepId &&
        record.operation === operation,
    ).length + 1
  );
}

function journalIdsAdded(
  before: Awaited<ReturnType<typeof getProject>>,
  after: Awaited<ReturnType<typeof getProject>>,
): string[] {
  const existing = new Set(
    (before.agentJournal ?? []).map((entry) => entry.id),
  );
  return (after.agentJournal ?? [])
    .filter((entry) => !existing.has(entry.id))
    .map((entry) => entry.id);
}

function toolResultError(
  value: unknown,
): { code: string; message: string; committed: boolean } | undefined {
  if (!value || typeof value !== 'object' || !('isError' in value)) return;
  if ((value as { isError?: unknown }).isError !== true) return;
  const text = (
    value as { content?: Array<{ type?: string; text?: string }> }
  ).content?.find((item) => item.type === 'text')?.text;
  try {
    const parsed = JSON.parse(text ?? '') as {
      code?: string;
      error?: string;
      committed?: boolean;
    };
    return {
      code: parsed.code ?? 'VIDEO_TOOL_ERROR',
      message: parsed.error ?? 'Video tool failed',
      committed: parsed.committed ?? false,
    };
  } catch {
    return {
      code: 'VIDEO_TOOL_ERROR',
      message: text ?? 'Video tool failed',
      committed: false,
    };
  }
}

function summarizeResult(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') return { value: redactValue(value) };
  const toolResult = value as {
    content?: Array<{ type?: string; text?: string }>;
  };
  const text = toolResult.content?.find((item) => item.type === 'text')?.text;
  if (text) {
    try {
      const parsed = JSON.parse(text) as unknown;
      return { output: redactValue(parsed) };
    } catch {
      return { output: text.slice(0, 2000) };
    }
  }
  return { output: redactValue(value) };
}

function replayToolResult(record: VideoExecutionLogRecord): unknown {
  const output = record.result?.output ?? {
    skipped: true,
    replayedSequence: record.sequence,
  };
  return {
    content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
  };
}

function operationPostconditionHolds(
  operation: string,
  operationInput: unknown,
  project: Awaited<ReturnType<typeof getProject>>,
): boolean {
  if (!operationInput || typeof operationInput !== 'object') return false;
  const args = operationInput as Record<string, unknown>;
  if (operation === 'video_set_storyboard') {
    return (
      JSON.stringify(project.storyboard) === JSON.stringify(args.storyboard)
    );
  }
  if (operation === 'video_attach_asset') {
    const assetId = typeof args.assetId === 'string' ? args.assetId : undefined;
    const sceneId = typeof args.sceneId === 'string' ? args.sceneId : undefined;
    if (!assetId) return false;
    if (!sceneId) return project.assets.some((asset) => asset.id === assetId);
    const scene = project.scenes?.find((candidate) => candidate.id === sceneId);
    return scene?.clips.some((clip) => clip.mediaId === assetId) ?? false;
  }
  return false;
}

function requiresApprovalForUncertainRetry(operation: string): boolean {
  return /(?:render|publish|generate|import_youtube|share)/.test(operation);
}

function digestStable(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

function redactValue<T>(value: T): T {
  if (typeof value === 'string') {
    return (path.isAbsolute(value) ? '[absolute path redacted]' : value) as T;
  }
  if (Array.isArray(value)) return value.map(redactValue) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, redactValue(entry)]),
    ) as T;
  }
  return value;
}

async function withLogLock<T>(
  projectId: string,
  run: () => Promise<T>,
): Promise<T> {
  const previous = logLocks.get(projectId) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(run);
  const tracked = current.then(
    () => undefined,
    () => undefined,
  );
  logLocks.set(projectId, tracked);
  try {
    return await current;
  } finally {
    if (logLocks.get(projectId) === tracked) logLocks.delete(projectId);
  }
}
