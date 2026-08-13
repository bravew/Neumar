import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';

import { collectFeedbackDiagnostics } from '@/shared/services/feedback-diagnostics';
import {
  forwardFeedback,
  isRemoteForwardingEnabled,
} from '@/shared/services/feedback-forwarder';
import {
  insertFeedback,
  listFeedback,
  listUnsyncedFeedback,
  markFeedbackForwardFailed,
  markFeedbackForwarded,
  setFeedbackLinearId,
} from '@/shared/services/feedback-store';
import { createIssue, getLinearClient } from '@/shared/services/linear';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('Feedback');

const FEEDBACK_PRIORITY: Record<string, number> = {
  bug: 1,
  feature: 3,
  feedback: 4,
  question: 3,
};

const CATEGORY_EMOJI: Record<string, string> = {
  bug: '🐛',
  feature: '✨',
  feedback: '💬',
  question: '❓',
};

const SUBJECT_MAX_LENGTH = 200;
const DESCRIPTION_MAX_LENGTH = 5000;

const feedbackSchema = z.object({
  category: z.enum(['bug', 'feature', 'feedback', 'question']),
  subject: z.string().min(1).max(SUBJECT_MAX_LENGTH),
  description: z.string().min(1).max(DESCRIPTION_MAX_LENGTH),
  email: z.string().email().optional(),
  appName: z.string().optional(),
  appVersion: z.string().optional(),
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  category: z.enum(['bug', 'feature', 'feedback', 'question']).optional(),
});

// Token bucket per session (10/hour). Keyed by x-neuma-session-id header or
// remote address fallback.
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

interface RateBucket {
  count: number;
  resetAt: number;
}

const rateBuckets = new Map<string, RateBucket>();

export function _resetFeedbackRateLimitForTests(): void {
  rateBuckets.clear();
}

function sweepExpiredBuckets(now: number): void {
  // Bound memory: drop buckets whose window already closed. O(n) sweep is
  // fine because rateBuckets is small in practice (one entry per active
  // session id) and this only runs on POST.
  for (const [k, v] of rateBuckets) {
    if (v.resetAt <= now) rateBuckets.delete(k);
  }
}

function rateLimitCheck(key: string): {
  ok: boolean;
  retryAfterSec?: number;
} {
  const now = Date.now();
  sweepExpiredBuckets(now);
  const bucket = rateBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { ok: true };
  }
  if (bucket.count >= RATE_LIMIT_MAX) {
    return {
      ok: false,
      retryAfterSec: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    };
  }
  bucket.count += 1;
  return { ok: true };
}

function buildLinearDescription(opts: {
  category: string;
  subject: string;
  description: string;
  email?: string;
  appName?: string;
  appVersion?: string;
}): string {
  const categoryLabel =
    opts.category.charAt(0).toUpperCase() + opts.category.slice(1);
  const now = new Date().toISOString();

  const lines = [
    '## User Feedback',
    '',
    `**Category**: ${categoryLabel}`,
    opts.email ? `**From**: ${opts.email}` : null,
    opts.appName
      ? `**App**: ${opts.appName}${opts.appVersion ? ` v${opts.appVersion}` : ''}`
      : null,
    `**Source**: Neumar desktop app`,
    `**Submitted**: ${now}`,
    '',
    '---',
    '',
    opts.description,
  ].filter((l): l is string => l !== null);

  return lines.join('\n');
}

const feedbackRoutes = new Hono();

feedbackRoutes.post('/', zValidator('json', feedbackSchema), async (c) => {
  const input = c.req.valid('json');

  const sessionKey =
    c.req.header('x-neuma-session-id') ||
    c.req.header('x-forwarded-for') ||
    'anonymous';
  const limit = rateLimitCheck(sessionKey);
  if (!limit.ok) {
    c.header('Retry-After', String(limit.retryAfterSec ?? 60));
    return c.json({ success: false, error: 'rate_limited' }, 429);
  }

  logger.info(
    `Feedback received: [${input.category}] subject_len=${input.subject.length}`,
  );

  // Step 1 — local persistence FIRST (never lose feedback)
  const diagnostics =
    input.category === 'bug'
      ? collectFeedbackDiagnostics({
          appName: input.appName,
          appVersion: input.appVersion,
        })
      : null;

  let row;
  try {
    row = insertFeedback({
      category: input.category,
      subject: input.subject,
      description: input.description,
      email: input.email,
      appName: input.appName,
      appVersion: input.appVersion,
      diagnostics,
    });
  } catch (err) {
    logger.error('Failed to persist feedback locally', err);
    return c.json({ success: false, error: 'persistence_failed' }, 500);
  }

  // Step 2 — best-effort Linear forwarding
  let linearIdentifier: string | undefined;
  const teamId = process.env['LINEAR_FEEDBACK_TEAM_ID'];
  if (teamId) {
    try {
      getLinearClient();
      const emoji = CATEGORY_EMOJI[input.category] ?? '📝';
      const issue = await createIssue({
        teamId,
        title: `[${emoji}] ${input.subject}`,
        description: buildLinearDescription(input),
        priority: FEEDBACK_PRIORITY[input.category] ?? 3,
        ...(process.env['LINEAR_FEEDBACK_PROJECT_ID']
          ? { projectId: process.env['LINEAR_FEEDBACK_PROJECT_ID'] }
          : {}),
      });
      linearIdentifier = issue.identifier;
      setFeedbackLinearId(row.id, issue.identifier);
      logger.info(
        `Created Linear issue ${issue.identifier} for [${input.category}] feedback`,
      );
    } catch (err) {
      logger.warn('Linear issue creation failed (non-fatal):', err);
    }
  }

  // Step 3 — best-effort remote forwarding
  if (isRemoteForwardingEnabled()) {
    const result = await forwardFeedback({
      ...row,
      linear_id: linearIdentifier ?? row.linear_id,
    });
    if (result.ok) {
      markFeedbackForwarded(row.id, 'forwarded', linearIdentifier ?? null);
    } else {
      markFeedbackForwardFailed(row.id, result.error ?? 'unknown');
    }
  } else {
    markFeedbackForwarded(row.id, 'skipped', linearIdentifier ?? null);
  }

  return c.json({
    success: true,
    id: row.id,
    ...(linearIdentifier ? { referenceId: linearIdentifier } : {}),
  });
});

feedbackRoutes.get('/', zValidator('query', listQuerySchema), (c) => {
  const { page, limit, category } = c.req.valid('query');
  const result = listFeedback({ page, limit, category });
  return c.json({
    success: true,
    items: result.items,
    total: result.total,
    page: result.page,
    limit: result.limit,
  });
});

feedbackRoutes.post('/flush', async (c) => {
  if (!isRemoteForwardingEnabled()) {
    return c.json({ success: true, attempted: 0, forwarded: 0, failed: 0 });
  }

  const queued = listUnsyncedFeedback();
  let forwarded = 0;
  let failed = 0;

  for (const row of queued) {
    const result = await forwardFeedback(row);
    if (result.ok) {
      markFeedbackForwarded(row.id, 'forwarded');
      forwarded++;
    } else {
      markFeedbackForwardFailed(row.id, result.error ?? 'unknown');
      failed++;
    }
  }

  return c.json({
    success: true,
    attempted: queued.length,
    forwarded,
    failed,
  });
});

export { feedbackRoutes };
