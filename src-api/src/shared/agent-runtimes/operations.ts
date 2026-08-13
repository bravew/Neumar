// Operation runner for install/update. Spawns the allowlisted command with
// shell:false, captures sanitized output, supports cancellation, and
// auto-reprobes the runtime on success.

import { spawn, type ChildProcess } from 'child_process';
import { randomUUID } from 'crypto';
import { homedir } from 'os';

import { createLogger } from '@/shared/utils/logger';

import { detectAgent } from './detect.js';
import { commandHash, findOption, type Intent } from './install.js';
import { getExtendedPath } from './resolve.js';
import type {
  AgentRuntimeStatus,
  RuntimeInstallOption,
  RuntimeUpdateOption,
} from './types.js';

const logger = createLogger('AgentRuntimeOps');

export type OperationStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface OperationRecord {
  id: string;
  agentId: string;
  intent: Intent;
  optionId: string;
  command: string;
  args: string[];
  status: OperationStatus;
  exitCode: number | null;
  startedAt: number;
  endedAt: number | null;
  output: string; // sanitized tail
  cancellable: boolean;
  refreshedStatus?: AgentRuntimeStatus;
  error?: string;
}

const OUTPUT_TAIL_BYTES = 64 * 1024;
const HARDKILL_GRACE_MS = 5000;
const TERMINAL_RETENTION_MS = 10 * 60 * 1000;
const MAX_OPERATION_RECORDS = 100;
const TOKENISH_RE = /[A-Za-z0-9_-]{32,}/g;

const operations = new Map<string, OperationRecord>();
const childByOp = new Map<string, ChildProcess>();
const inflightByAgent = new Map<string, string>(); // agentId → opId

function scheduleEviction(id: string): void {
  setTimeout(() => operations.delete(id), TERMINAL_RETENTION_MS).unref?.();
}

function evictOldestIfFull(): void {
  if (operations.size < MAX_OPERATION_RECORDS) return;
  const oldest = [...operations.values()]
    .filter((r) => r.endedAt !== null)
    .sort((a, b) => (a.endedAt ?? 0) - (b.endedAt ?? 0))[0];
  if (oldest) operations.delete(oldest.id);
}

function sanitize(raw: string): string {
  const home = homedir();
  let out = raw;
  if (home && home.length > 1) {
    out = out.split(home).join('~');
  }
  out = out.replace(TOKENISH_RE, (m) =>
    m.length >= 32 ? `${m.slice(0, 4)}…${m.slice(-2)}` : m,
  );
  if (out.length > OUTPUT_TAIL_BYTES) {
    out =
      `…[truncated ${out.length - OUTPUT_TAIL_BYTES} bytes]…\n` +
      out.slice(-OUTPUT_TAIL_BYTES);
  }
  return out;
}

export function listOperations(): OperationRecord[] {
  return [...operations.values()].sort((a, b) => b.startedAt - a.startedAt);
}

export function getOperation(id: string): OperationRecord | null {
  return operations.get(id) ?? null;
}

export interface StartResult {
  ok: true;
  operation: OperationRecord;
}

export interface StartFailure {
  ok: false;
  status: 400 | 404 | 409 | 422;
  error: string;
}

export interface StartParams {
  agentId: string;
  intent: Intent;
  optionId: string;
  confirmedCommandHash: string;
}

export function startOperation(
  params: StartParams,
): StartResult | StartFailure {
  const { agentId, intent, optionId, confirmedCommandHash } = params;

  const found = findOption(agentId, intent, optionId);
  if (!found) {
    return { ok: false, status: 404, error: 'agent or option not found' };
  }
  const { option } = found;

  if (!option.platforms.includes(process.platform)) {
    return {
      ok: false,
      status: 400,
      error: `Option not available on platform ${process.platform}`,
    };
  }
  if (!option.inAppRunnable) {
    return {
      ok: false,
      status: 400,
      error: 'This option is copy-to-terminal only and cannot run in-app',
    };
  }

  const expectedHash = commandHash(option);
  if (
    typeof confirmedCommandHash !== 'string' ||
    confirmedCommandHash.length === 0 ||
    confirmedCommandHash !== expectedHash
  ) {
    return {
      ok: false,
      status: 422,
      error: 'confirmedCommandHash mismatch — UI is stale, refresh and retry',
    };
  }

  const existingOpId = inflightByAgent.get(agentId);
  if (existingOpId) {
    const existing = operations.get(existingOpId);
    if (
      existing &&
      (existing.status === 'pending' || existing.status === 'running')
    ) {
      return {
        ok: false,
        status: 409,
        error: `An ${existing.intent} for ${agentId} is already running (${existingOpId})`,
      };
    }
  }

  evictOldestIfFull();
  const id = randomUUID();
  const record: OperationRecord = {
    id,
    agentId,
    intent,
    optionId,
    command: option.command,
    args: [...option.args],
    status: 'pending',
    exitCode: null,
    startedAt: Date.now(),
    endedAt: null,
    output: '',
    cancellable: true,
  };
  operations.set(id, record);
  inflightByAgent.set(agentId, id);

  // Fire-and-forget the actual run; record updates in place.
  void runChild(record, option);

  return { ok: true, operation: record };
}

async function runChild(
  record: OperationRecord,
  _option: RuntimeInstallOption | RuntimeUpdateOption,
): Promise<void> {
  let buffer = '';
  const append = (chunk: string) => {
    buffer += chunk;
    if (buffer.length > OUTPUT_TAIL_BYTES * 2) {
      buffer = buffer.slice(-OUTPUT_TAIL_BYTES);
    }
    record.output = sanitize(buffer);
  };

  const env = {
    ...process.env,
    PATH: getExtendedPath(),
    // Force non-interactive flow where possible.
    CI: process.env.CI ?? '1',
    NO_COLOR: '1',
  };

  let child: ChildProcess;
  try {
    child = spawn(record.command, record.args, {
      shell: false,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    record.status = 'failed';
    record.error = (err as Error).message;
    record.endedAt = Date.now();
    record.cancellable = false;
    inflightByAgent.delete(record.agentId);
    logger.warn(
      `spawn failed for ${record.agentId} ${record.intent}: ${record.error}`,
    );
    scheduleEviction(record.id);
    return;
  }

  childByOp.set(record.id, child);
  record.status = 'running';

  child.stdout?.on('data', (chunk: Buffer | string) => {
    append(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
  });
  child.stderr?.on('data', (chunk: Buffer | string) => {
    append(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
  });

  await new Promise<void>((resolve) => {
    child.once('close', (code) => {
      record.exitCode = code;
      resolve();
    });
    child.once('error', (err) => {
      record.error = err.message;
      record.exitCode = record.exitCode ?? -1;
      resolve();
    });
  });

  childByOp.delete(record.id);
  record.cancellable = false;
  record.endedAt = Date.now();
  // cancelOperation() may have flipped this to 'cancelled' before close;
  // widen via `as OperationStatus` so TS doesn't narrow away the case.
  if ((record.status as OperationStatus) === 'cancelled') {
    inflightByAgent.delete(record.agentId);
    scheduleEviction(record.id);
    return;
  }

  if (record.exitCode === 0) {
    record.status = 'completed';
    try {
      const refreshed = await detectAgent(record.agentId);
      if (refreshed) record.refreshedStatus = refreshed;
    } catch (err) {
      logger.warn(
        `Re-probe after ${record.intent} failed: ${(err as Error).message}`,
      );
    }
  } else {
    record.status = 'failed';
  }
  inflightByAgent.delete(record.agentId);
  scheduleEviction(record.id);
}

export function cancelOperation(id: string): boolean {
  const record = operations.get(id);
  if (!record) return false;
  if (record.status !== 'pending' && record.status !== 'running') return false;
  const child = childByOp.get(id);
  if (!child || child.killed) return false;
  record.status = 'cancelled';
  try {
    child.kill('SIGTERM');
  } catch {
    // ignore
  }
  setTimeout(() => {
    if (!child.killed) {
      try {
        child.kill('SIGKILL');
      } catch {
        // ignore
      }
    }
  }, HARDKILL_GRACE_MS);
  return true;
}
