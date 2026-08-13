import { z } from 'zod';

import { inferContextWindowTokens } from './output-budget.js';

const SESSION_BINDING_SCHEMA_VERSION = 1 as const;
const RUN_VERDICT_SCHEMA_VERSION = 1 as const;

const IsoTimestampSchema = z.iso.datetime({ offset: true });

const AgentSessionBindingV1Schema = z.object({
  schemaVersion: z.literal(SESSION_BINDING_SCHEMA_VERSION).default(1),
  conversationId: z.string().min(1),
  projectId: z.string().min(1).nullable(),
  runtimeId: z.string().min(1),
  modelId: z.string().min(1).nullable(),
  workspaceRoot: z.string().min(1).nullable(),
  handleKind: z.enum([
    'opaque-id',
    'cli-thread-id',
    'acp-session-handle',
    'continue-latest',
  ]),
  handle: z.string().min(1),
  lastMessageId: z.string().min(1).nullable(),
  updatedAt: IsoTimestampSchema,
});

const LegacyResumeIdentitySchema = z.object({
  taskId: z.string().min(1),
  providerId: z.string().min(1),
  modelId: z.string().min(1).optional(),
  workspaceRoot: z.string().min(1).optional(),
  nativeSessionId: z.string().min(1),
  createdAt: IsoTimestampSchema.optional(),
  lastSeenAt: IsoTimestampSchema.optional(),
});

export const AgentSessionBindingSchema = z.preprocess((input) => {
  const legacy = LegacyResumeIdentitySchema.safeParse(input);
  if (!legacy.success) return input;
  return {
    schemaVersion: SESSION_BINDING_SCHEMA_VERSION,
    conversationId: legacy.data.taskId,
    projectId: null,
    runtimeId: legacy.data.providerId,
    modelId: legacy.data.modelId ?? null,
    workspaceRoot: legacy.data.workspaceRoot ?? null,
    handleKind: 'opaque-id',
    handle: legacy.data.nativeSessionId,
    lastMessageId: null,
    updatedAt:
      legacy.data.lastSeenAt ??
      legacy.data.createdAt ??
      new Date(0).toISOString(),
  };
}, AgentSessionBindingV1Schema);

export type AgentSessionBinding = z.infer<typeof AgentSessionBindingSchema>;

const RunVerdictV1Schema = z.object({
  schemaVersion: z.literal(RUN_VERDICT_SCHEMA_VERSION).default(1),
  process: z.enum(['running', 'succeeded', 'failed', 'cancelled']),
  completeness: z.enum(['complete', 'unfinished', 'unknown']),
  delivery: z.enum([
    'not_expected',
    'pending',
    'delivered',
    'blocked',
    'failed',
  ]),
  retry: z.enum(['not_safe', 'safe_once', 'user_action']),
  failureCause: z.string().min(1).optional(),
});

const LEGACY_PROCESS_BY_STATUS = {
  queued: 'running',
  running: 'running',
  completed: 'succeeded',
  failed: 'failed',
  cancelled: 'cancelled',
} as const;

export const RunVerdictSchema = z.preprocess((input) => {
  if (!input || typeof input !== 'object' || !('status' in input)) return input;
  const status = (input as { status?: unknown }).status;
  if (typeof status !== 'string' || !(status in LEGACY_PROCESS_BY_STATUS)) {
    return input;
  }
  const process =
    LEGACY_PROCESS_BY_STATUS[status as keyof typeof LEGACY_PROCESS_BY_STATUS];
  return {
    schemaVersion: RUN_VERDICT_SCHEMA_VERSION,
    process,
    completeness: process === 'succeeded' ? 'unknown' : 'unfinished',
    delivery: 'not_expected',
    retry: process === 'failed' ? 'user_action' : 'not_safe',
  };
}, RunVerdictV1Schema);

export type RunVerdict = z.infer<typeof RunVerdictSchema>;

export type RunMode = 'task' | 'design' | 'video';

export interface ModeFailureVerdict {
  verdict: RunVerdict;
  recoveryAction: 'retry_run' | 'retry_generation' | 'retry_render';
}

export function parseAgentSessionBinding(input: unknown): AgentSessionBinding {
  return AgentSessionBindingSchema.parse(input);
}

export function parseRunVerdict(input: unknown): RunVerdict {
  return RunVerdictSchema.parse(input);
}

export function serializeRuntimeState(
  value: AgentSessionBinding | RunVerdict,
): string {
  return JSON.stringify(value);
}

const TERMINAL_PROCESSES = new Set<RunVerdict['process']>([
  'succeeded',
  'failed',
  'cancelled',
]);

export function advanceRunVerdict(
  current: RunVerdict,
  proposed: RunVerdict,
): RunVerdict {
  if (TERMINAL_PROCESSES.has(current.process)) return current;
  if (
    proposed.process === 'succeeded' &&
    (proposed.completeness !== 'complete' ||
      (proposed.delivery !== 'not_expected' &&
        proposed.delivery !== 'delivered'))
  ) {
    return {
      ...proposed,
      process: 'failed',
      retry: 'user_action',
      failureCause:
        proposed.completeness !== 'complete'
          ? 'unfinished_declared_work'
          : 'artifact_delivery_incomplete',
    };
  }
  return proposed;
}

const NATIVE_SESSION_ROLLOVER_RATIO = 0.9;

/**
 * Native provider sessions become unreliable when their retained context is
 * almost full. Roll over while there is still enough room to reseed a fresh
 * session from Neuma's persisted conversation instead of waiting for an
 * upstream context-window failure.
 */
export function shouldRolloverNativeSession(
  modelId: string | undefined,
  contextTokensUsed: number | undefined,
): boolean {
  if (!modelId || contextTokensUsed === undefined || contextTokensUsed < 0) {
    return false;
  }
  const contextWindow = inferContextWindowTokens(modelId);
  if (!contextWindow) return false;
  return (
    contextTokensUsed >=
    Math.floor(contextWindow * NATIVE_SESSION_ROLLOVER_RATIO)
  );
}

export function adaptRunFailure(
  mode: RunMode,
  failureCause: string,
  retry: RunVerdict['retry'] = 'user_action',
): ModeFailureVerdict {
  const recoveryAction = {
    task: 'retry_run',
    design: 'retry_generation',
    video: 'retry_render',
  } as const;
  return {
    verdict: parseRunVerdict({
      process: 'failed',
      completeness: 'unfinished',
      delivery: 'not_expected',
      retry,
      failureCause,
    }),
    recoveryAction: recoveryAction[mode],
  };
}
