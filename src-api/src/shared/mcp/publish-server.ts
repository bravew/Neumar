import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

import {
  evaluatePublishConnectorGate,
  type PublishPolicyInput,
} from '@/shared/auth/connector-policy';
import {
  isPublishPipelineEnabled,
  JobLedger,
  listPublishDestinationOptions,
  PublishApprovalService,
  serializePublishSnapshot,
  type PublishDestinationOption,
} from '@/shared/services/publish';
import {
  isPublishSourcePathAllowed,
  resolvePublishSourcePath,
} from '@/shared/services/publish/source-path-policy';
import {
  destinationKindSchema,
  type CreateJobInput,
} from '@/shared/services/publish/types';
import { errorMessage } from '@/shared/utils/errors';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('PublishMCP');

const publishSourcePathSchema = z
  .string()
  .trim()
  .min(1)
  .transform(resolvePublishSourcePath)
  .refine(isPublishSourcePathAllowed, {
    message: 'source_path_outside_workspace',
  });

const sourceSchema = z.object({
  artifactId: z.string().optional(),
  path: publishSourcePathSchema,
  sha256: z.string().min(32),
  sizeBytes: z.number().int().nonnegative(),
  mime: z.string().min(1),
  manifestPath: publishSourcePathSchema.optional(),
  provenance: z.record(z.string(), z.unknown()).optional(),
});

const PUBLISH_DESTINATIONS_DESCRIPTION =
  'List writable publish destinations. Use this before publish.start whenever the user asks to upload, publish, save, or add a generated/edited local file to a connected target. This is the authoritative way to resolve user-facing labels like "home album" or "Home Immich" to the required connectionId. Do not use Google Photos picker tools for publishing; those tools only let users select existing photos.';

const PUBLISH_START_DESCRIPTION =
  'Start a publish/upload job for one or more writable destinations including Box, Dropbox, OneDrive, Immich, and local archive. First call publish.destinations to enumerate available destinations and their connectionIds (e.g. "local_box", "local_dropbox", "local_onedrive") — that is also how user-facing labels like "home album" or "Home Immich" resolve to a connectionId. For Box/Dropbox/OneDrive use kind "box"/"dropbox"/"onedrive" with the matching local_* connectionId. For Immich, pass kind "immich" with the connectionId of the target server. Native cloud and Immich destinations do not require approval after the user explicitly asks to publish; omit approvalRequired or pass false.';

const destinationSchema = z.object({
  kind: destinationKindSchema.describe(
    'Destination kind. Use "immich" for connected Immich/self-hosted media destinations; do not substitute Google Photos picker tools for publish requests.',
  ),
  connectionId: z
    .string()
    .min(1)
    .describe(
      'Concrete destination id returned by publish.destinations. For labels like "home album", call publish.destinations and copy the matching connectionId.',
    ),
  approvalRequired: z
    .boolean()
    .default(false)
    .describe(
      'Whether this publish leg needs a separate human approval after job creation. Leave false for Immich/self-hosted media when the user explicitly asked to publish.',
    ),
  label: z
    .string()
    .optional()
    .describe(
      'Optional human-readable label copied from publish.destinations.',
    ),
  idempotencyKey: z.string().optional(),
  schedule: z.object({ runAt: z.string().datetime() }).optional(),
  target: z.record(z.string(), z.unknown()).optional(),
});

export const PUBLISH_TOOL_NAMES = [
  'publish.destinations',
  'publish.start',
  'publish.status',
  'publish.cancel',
  'publish.reschedule',
  'publish.cross-post',
  'publish.approve',
  'publish.reject',
  'publish.session.start',
  'publish.session.append',
  'publish.session.finalize',
  'publish.session.abort',
] as const;

export interface PublishMcpDeps {
  ledger?: JobLedger;
  approvals?: PublishApprovalService;
  caller?: PublishPolicyInput;
  featureEnabled?: () => boolean;
  listDestinations?: () => PublishDestinationOption[];
}

export function createPublishToolHandlers(deps: PublishMcpDeps = {}) {
  const ledger = deps.ledger ?? new JobLedger();
  const approvals = deps.approvals ?? new PublishApprovalService();
  const featureEnabled = deps.featureEnabled ?? isPublishPipelineEnabled;
  const caller = deps.caller ?? { platform: 'desktop', human: true };
  const listDestinations =
    deps.listDestinations ?? (() => listPublishDestinationOptions());

  const ensureEnabled = () => {
    if (!featureEnabled()) throw new Error('publish_pipeline_disabled');
  };
  const ensureScope = (
    scope: Parameters<typeof evaluatePublishConnectorGate>[0],
  ) => {
    const gate = evaluatePublishConnectorGate(scope, caller, caller.locale);
    if (!gate.allow) throw new Error('publish_policy_denied');
  };

  return {
    destinations() {
      ensureEnabled();
      ensureScope('publish');
      return {
        items: listDestinations(),
      };
    },

    start(input: z.infer<typeof startSchema>) {
      ensureEnabled();
      for (const destination of input.destinations) {
        ensureScope(`publish:${destination.kind}`);
      }
      const job = ledger.createJob(toCreateJobInput(input));
      return { jobId: job.id };
    },

    status(input: { jobId: string }) {
      ensureScope('publish');
      const job = ledger.getJob(input.jobId);
      if (!job) throw new Error(`publish_job_not_found:${input.jobId}`);
      return serializePublishSnapshot(job, ledger.listLegRows(job.id));
    },

    cancel(input: { jobId: string }) {
      ensureEnabled();
      ensureScope('publish');
      const job = ledger.cancelJob(input.jobId);
      return serializePublishSnapshot(job, ledger.listLegRows(job.id));
    },

    reschedule(input: { legId: string; runAt: string }) {
      ensureEnabled();
      ensureScope('publish');
      const leg = ledger.rescheduleLeg(input.legId, input.runAt);
      return { legId: leg.id, nextRetryAt: leg.next_retry_at };
    },

    crossPost(input: { artifactId: string; presetId: string }) {
      ensureEnabled();
      ensureScope('publish');
      throw new Error(
        `publish_preset_not_found:${input.presetId}:${input.artifactId}`,
      );
    },

    approve(input: { legId: string; comment?: string }) {
      ensureEnabled();
      ensureScope('publish:human');
      approvals.approveLeg(input.legId, caller.identityId ?? 'human:desktop');
      return { legId: input.legId, approved: true, comment: input.comment };
    },

    reject(input: { legId: string; reason: string }) {
      ensureEnabled();
      ensureScope('publish:human');
      approvals.rejectLeg(
        input.legId,
        caller.identityId ?? 'human:desktop',
        input.reason,
      );
      return { legId: input.legId, rejected: true };
    },

    sessionStart(input: {
      legId: string;
      destinationKind: z.infer<typeof destinationKindSchema>;
      contentSha256: string;
    }) {
      ensureEnabled();
      ensureScope(`publish:session:${input.destinationKind}`);
      return {
        sessionId: `manual:${input.legId}`,
        legId: input.legId,
        contentSha256: input.contentSha256,
      };
    },

    sessionAppend(input: {
      sessionId: string;
      chunkBase64: string;
      offset: number;
    }) {
      ensureEnabled();
      ensureScope('publish');
      return {
        sessionId: input.sessionId,
        offset: input.offset + Buffer.byteLength(input.chunkBase64, 'base64'),
      };
    },

    sessionFinalize(input: { sessionId: string }) {
      ensureEnabled();
      ensureScope('publish');
      return { sessionId: input.sessionId, finalized: true };
    },

    sessionAbort(input: { sessionId: string }) {
      ensureEnabled();
      ensureScope('publish');
      return { sessionId: input.sessionId, aborted: true };
    },
  };
}

function toCreateJobInput(input: z.output<typeof startSchema>): CreateJobInput {
  return {
    workspaceId: input.workspaceId,
    createdBy: input.createdBy,
    source: input.source,
    destinations: input.destinations,
    metadata: input.metadata,
    scheduledFor: input.schedule?.runAt,
  };
}

const startSchema = z.object({
  workspaceId: z.string().min(1).default('local'),
  createdBy: z.string().min(1).default('agent:publish'),
  artifactId: z.string().optional(),
  source: sourceSchema,
  destinations: z.array(destinationSchema).min(1),
  metadata: z.record(z.string(), z.unknown()).optional(),
  schedule: z.object({ runAt: z.string().datetime() }).optional(),
});

const statusSchema = z.object({ jobId: z.string().min(1) });
const cancelSchema = statusSchema;
const rescheduleSchema = z.object({
  legId: z.string().min(1),
  runAt: z.string().datetime(),
});
const crossPostSchema = z.object({
  artifactId: z.string().min(1),
  presetId: z.string().min(1),
});
const approveSchema = z.object({
  legId: z.string().min(1),
  comment: z.string().optional(),
});
const rejectSchema = z.object({
  legId: z.string().min(1),
  reason: z.string().min(1),
});
const sessionStartSchema = z.object({
  legId: z.string().min(1),
  destinationKind: destinationKindSchema,
  contentSha256: z.string().min(32),
});
const sessionAppendSchema = z.object({
  sessionId: z.string().min(1),
  chunkBase64: z.string().min(1),
  offset: z.number().int().nonnegative(),
});
const sessionIdSchema = z.object({ sessionId: z.string().min(1) });

export function publishTools(deps: PublishMcpDeps = {}) {
  const handlers = createPublishToolHandlers(deps);
  return [
    publishTool(
      'publish.destinations',
      PUBLISH_DESTINATIONS_DESCRIPTION,
      {},
      handlers.destinations,
    ),
    publishTool(
      'publish.start',
      PUBLISH_START_DESCRIPTION,
      startSchema.shape,
      handlers.start,
    ),
    publishTool(
      'publish.status',
      'Return a publish job and per-destination leg status.',
      statusSchema.shape,
      handlers.status,
    ),
    publishTool(
      'publish.cancel',
      'Cancel a publish job and any non-terminal legs.',
      cancelSchema.shape,
      handlers.cancel,
    ),
    publishTool(
      'publish.reschedule',
      'Move a queued publish leg to a later retry time.',
      rescheduleSchema.shape,
      handlers.reschedule,
    ),
    publishTool(
      'publish.cross-post',
      'Start a publish job from a saved cross-post preset.',
      crossPostSchema.shape,
      handlers.crossPost,
    ),
    publishTool(
      'publish.approve',
      'Human-only approval for a pending publish leg.',
      approveSchema.shape,
      handlers.approve,
    ),
    publishTool(
      'publish.reject',
      'Human-only rejection for a pending publish leg.',
      rejectSchema.shape,
      handlers.reject,
    ),
    publishTool(
      'publish.session.start',
      'Advanced low-level upload session start.',
      sessionStartSchema.shape,
      handlers.sessionStart,
    ),
    publishTool(
      'publish.session.append',
      'Advanced low-level upload session append.',
      sessionAppendSchema.shape,
      handlers.sessionAppend,
    ),
    publishTool(
      'publish.session.finalize',
      'Advanced low-level upload session finalize.',
      sessionIdSchema.shape,
      handlers.sessionFinalize,
    ),
    publishTool(
      'publish.session.abort',
      'Advanced low-level upload session abort.',
      sessionIdSchema.shape,
      handlers.sessionAbort,
    ),
  ];
}

export function createPublishMcpServer(deps: PublishMcpDeps = {}) {
  return createSdkMcpServer({
    name: 'publish',
    version: '1.0.0',
    tools: publishTools(deps),
  });
}

function publishTool<Schema extends z.ZodRawShape, Output>(
  name: (typeof PUBLISH_TOOL_NAMES)[number],
  description: string,
  schema: Schema,
  handler: (input: z.infer<z.ZodObject<Schema>>) => Output,
) {
  return tool(name, description, schema, async (input) => {
    try {
      const parsedInput = input as z.infer<z.ZodObject<Schema>>;
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(handler(parsedInput), null, 2),
          },
        ],
      };
    } catch (error) {
      const message = errorMessage(error);
      logger.warn(`${name} failed: ${message}`);
      return {
        content: [{ type: 'text' as const, text: message }],
        isError: true,
      };
    }
  });
}
