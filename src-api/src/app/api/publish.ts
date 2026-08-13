import { Hono } from 'hono';
import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { z } from 'zod';

import {
  isPublishPipelineEnabled,
  JobLedger,
  listPublishDestinationOptions,
  publishDestinationRegistry,
  PublishApprovalService,
  serializePublishSnapshot,
  type PublishJobSnapshot,
  type PublishLegSnapshot,
  type PublishDestinationRegistry,
  type PublishDestinationOption,
} from '@/shared/services/publish';
import {
  isPublishSourcePathAllowed,
  resolvePublishSourcePath,
} from '@/shared/services/publish/source-path-policy';
import { isTerminalLegState } from '@/shared/services/publish/state-machine';
import {
  destinationKindSchema,
  type CreateJobInput,
  type PublishJob,
  type ReformatSpec,
  type VersioningPolicy,
} from '@/shared/services/publish/types';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('PublishRoutes');

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

const versioningPolicySchema: z.ZodType<VersioningPolicy> = z.object({
  mode: z.enum([
    'provider-native',
    'content-addressable',
    'timestamped-folder',
    'overwrite',
  ]),
  keepRevisionForever: z.boolean().optional(),
  contentAddressable: z
    .object({
      hashLen: z.number().int().positive(),
      sep: z.string(),
    })
    .optional(),
  timestampedFolder: z
    .object({
      rootPath: z.string(),
      tsFormat: z.enum(['iso', 'epoch']),
    })
    .optional(),
});

const reformatSpecSchema: z.ZodType<ReformatSpec> = z.object({
  targetMime: z.string().optional(),
  aspectRatio: z.string().optional(),
  maxDurationSeconds: z.number().positive().optional(),
  videoCodec: z.string().optional(),
  audioCodec: z.string().optional(),
  container: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const destinationSchema = z.object({
  kind: destinationKindSchema,
  connectionId: z.string().min(1),
  approvalRequired: z.boolean().default(false),
  idempotencyKey: z.string().optional(),
  label: z.string().optional(),
  versioning: versioningPolicySchema.optional(),
  reformatSpec: reformatSpecSchema.optional(),
  schedule: z.object({ runAt: z.string().datetime() }).optional(),
  target: z.record(z.string(), z.unknown()).optional(),
});

const createJobSchema = z.object({
  workspaceId: z.string().min(1).default('local'),
  createdBy: z.string().min(1).default('human:desktop'),
  source: sourceSchema,
  destinations: z.array(destinationSchema).min(1),
  metadata: z.record(z.string(), z.unknown()).optional(),
  approval: z
    .object({
      required: z.boolean(),
      channel: z.enum(['frontend', 'channel']).optional(),
    })
    .optional(),
  scheduledFor: z.string().datetime().optional(),
  idempotencyKey: z.string().optional(),
});

const rescheduleSchema = z.object({
  runAt: z.string().datetime(),
});

const approvalSchema = z.object({
  by: z.string().min(1).default('human:desktop'),
  comment: z.string().optional(),
});

const rejectSchema = z.object({
  by: z.string().min(1).default('human:desktop'),
  reason: z.string().min(1),
});

interface PublishRouteDeps {
  ledger?: JobLedger;
  approvals?: PublishApprovalService;
  registry?: PublishDestinationRegistry;
  featureEnabled?: () => boolean;
  listDestinations?: () => PublishDestinationOption[];
  now?: () => Date;
  pollMs?: number;
}

export function createPublishRoutes(deps: PublishRouteDeps = {}) {
  const routes = new Hono();
  const ledger = deps.ledger ?? new JobLedger();
  const approvals = deps.approvals ?? new PublishApprovalService();
  const registry = deps.registry ?? publishDestinationRegistry;
  const featureEnabled = deps.featureEnabled ?? isPublishPipelineEnabled;
  const listDestinations =
    deps.listDestinations ??
    (() => listPublishDestinationOptions({ registry }));
  const pollMs = deps.pollMs ?? 1000;

  routes.get('/destinations', (c) =>
    c.json({
      featureEnabled: featureEnabled(),
      items: listDestinations(),
    }),
  );

  routes.post('/jobs', async (c) => {
    const gate = requireEnabled(c, featureEnabled);
    if (gate) return gate;

    const parsed = createJobSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: parsed.error.message }, 400);

    const job = ledger.createJob(toCreateJobInput(parsed.data));
    return c.json(snapshotForJob(ledger, job), 201);
  });

  routes.get('/jobs', (c) => {
    const workspaceId = c.req.query('workspaceId') ?? undefined;
    const state = c.req.query('state') ?? undefined;
    const limit = parseInteger(c.req.query('limit'), 100);
    const offset = parseInteger(c.req.query('offset'), 0);
    const items = ledger
      .listJobs({ workspaceId, state: state as never, limit, offset })
      .map((job) => snapshotForJob(ledger, job));
    return c.json({ items });
  });

  routes.get('/jobs/:id', (c) => {
    const snapshot = requireSnapshot(ledger, c.req.param('id'));
    if (!snapshot) return c.json({ error: 'publish_job_not_found' }, 404);
    return c.json(snapshot);
  });

  routes.post('/jobs/:id/cancel', (c) => {
    const gate = requireEnabled(c, featureEnabled);
    if (gate) return gate;

    try {
      return c.json(
        snapshotForJob(ledger, ledger.cancelJob(c.req.param('id'))),
      );
    } catch (error) {
      logger.warn('Failed to cancel publish job', error);
      return c.json({ error: 'publish_job_not_found' }, 404);
    }
  });

  routes.post('/legs/:id/approve', async (c) => {
    const gate = requireEnabled(c, featureEnabled);
    if (gate) return gate;

    const parsed = approvalSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: parsed.error.message }, 400);

    try {
      approvals.approveLeg(c.req.param('id'), parsed.data.by);
      return respondWithLegSnapshot(c, ledger, c.req.param('id'));
    } catch (error) {
      logger.warn('Failed to approve publish leg', error);
      return c.json({ error: 'publish_leg_not_found' }, 404);
    }
  });

  routes.post('/legs/:id/reject', async (c) => {
    const gate = requireEnabled(c, featureEnabled);
    if (gate) return gate;

    const parsed = rejectSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: parsed.error.message }, 400);

    try {
      approvals.rejectLeg(
        c.req.param('id'),
        parsed.data.by,
        parsed.data.reason,
      );
      return respondWithLegSnapshot(c, ledger, c.req.param('id'));
    } catch (error) {
      logger.warn('Failed to reject publish leg', error);
      return c.json({ error: 'publish_leg_not_found' }, 404);
    }
  });

  routes.post('/legs/:id/reschedule', async (c) => {
    const gate = requireEnabled(c, featureEnabled);
    if (gate) return gate;

    const parsed = rescheduleSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: parsed.error.message }, 400);

    const row = ledger.getLegRow(c.req.param('id'));
    if (!row) return c.json({ error: 'publish_leg_not_found' }, 404);
    if (isTerminalLegState(row.state as never)) {
      return c.json({ error: 'publish_leg_terminal' }, 409);
    }

    ledger.rescheduleLeg(row.id, parsed.data.runAt);
    return respondWithLegSnapshot(c, ledger, row.id);
  });

  routes.get('/jobs/:id/events', (c) => {
    const snapshot = requireSnapshot(ledger, c.req.param('id'));
    if (!snapshot) return c.json({ error: 'publish_job_not_found' }, 404);

    c.header('X-Accel-Buffering', 'no');
    c.header('Cache-Control', 'no-cache');
    c.header('Connection', 'keep-alive');

    return streamSSE(c, async (stream) => {
      let previous = snapshot;
      const approvalRequestedLegIds = new Set<string>();
      await stream.writeSSE({
        event: 'snapshot',
        data: JSON.stringify(previous),
      });

      if (c.req.query('once') === 'true') return;

      while (!c.req.raw.signal.aborted) {
        await sleep(pollMs, c.req.raw.signal);
        const next = requireSnapshot(ledger, c.req.param('id'));
        if (!next) return;
        for (const event of diffSnapshot(
          previous,
          next,
          approvalRequestedLegIds,
        )) {
          await stream.writeSSE({
            event: event.type,
            data: JSON.stringify(event),
          });
        }
        previous = next;
      }
    });
  });

  return routes;
}

export const publishRoutes = createPublishRoutes();

function requireEnabled(
  c: Context,
  enabled: () => boolean,
): Response | undefined {
  if (enabled()) return undefined;
  const status: ContentfulStatusCode = 403;
  return c.json({ error: 'publish_pipeline_disabled' }, status);
}

function snapshotForJob(
  ledger: JobLedger,
  job: PublishJob,
): PublishJobSnapshot {
  return serializePublishSnapshot(job, ledger.listLegRows(job.id));
}

function requireSnapshot(
  ledger: JobLedger,
  jobId: string,
): PublishJobSnapshot | null {
  const job = ledger.getJob(jobId);
  return job ? snapshotForJob(ledger, job) : null;
}

function respondWithLegSnapshot(
  c: Context,
  ledger: JobLedger,
  legId: string,
): Response {
  const row = ledger.getLegRow(legId);
  if (!row) return c.json({ error: 'publish_leg_not_found' }, 404);
  const job = ledger.getJob(row.job_id);
  if (!job) return c.json({ error: 'publish_job_not_found' }, 404);
  return c.json({
    leg: serializePublishSnapshot(job, [row]).legs[0],
  });
}

function diffSnapshot(
  previous: PublishJobSnapshot,
  next: PublishJobSnapshot,
  approvalRequestedLegIds?: Set<string>,
): Array<{ type: string; leg: PublishLegSnapshot }> {
  const before = new Map(previous.legs.map((leg) => [leg.id, leg]));
  const events: Array<{ type: string; leg: PublishLegSnapshot }> = [];
  for (const leg of next.legs) {
    const old = before.get(leg.id);
    if (!old) {
      events.push({ type: 'state_change', leg });
      continue;
    }
    if (old.state !== leg.state) {
      events.push({
        type:
          leg.state === 'published'
            ? 'published'
            : leg.state === 'failed'
              ? 'failed'
              : 'state_change',
        leg,
      });
    }
    if (old.chunkOffsetBytes !== leg.chunkOffsetBytes) {
      events.push({ type: 'chunk_progress', leg });
    }
    if (
      leg.approvalRequired &&
      !leg.approvedAt &&
      !approvalRequestedLegIds?.has(leg.id)
    ) {
      events.push({ type: 'approval_requested', leg });
      approvalRequestedLegIds?.add(leg.id);
    }
  }
  return events;
}

function toCreateJobInput(
  input: z.output<typeof createJobSchema>,
): CreateJobInput {
  return {
    workspaceId: input.workspaceId,
    createdBy: input.createdBy,
    source: input.source,
    destinations: input.destinations,
    metadata: input.metadata,
    approval: input.approval,
    scheduledFor: input.scheduledFor,
    idempotencyKey: input.idempotencyKey,
  };
}

function parseInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true },
    );
  });
}
