import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { z } from 'zod';

import {
  getApprovalManager,
  RISK_REQUIRES_TOKEN,
} from '@/core/approval-manager';
import type { ApprovalEvent } from '@/core/approval-manager';

import {
  getApprovalsByStatus,
  getPendingApprovalCount,
} from '@/shared/db/operations';
import {
  approvalStatusSchema,
  decideApprovalSchema,
} from '@/shared/db/schemas';
import type { Approval } from '@/shared/db/types';
import { verifyResumeToken } from '@/shared/services/ag-ui/resume-token';
import { createLogger } from '@/shared/utils/logger';

const listQuerySchema = z.object({
  status: approvalStatusSchema.default('pending'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const logger = createLogger('ApprovalRoutes');

/** SSE heartbeat — keep proxies and middleboxes from terminating idle connections. */
const SSE_HEARTBEAT_MS = 15_000;

type TokenError = { status: ContentfulStatusCode; error: string };

function checkResumeToken(
  approval: Approval,
  token: string | undefined,
): TokenError | null {
  if (!RISK_REQUIRES_TOKEN.has(approval.risk_level)) return null;
  if (!token) {
    return {
      status: 401,
      error: 'resumeToken required for risk-gated approval',
    };
  }
  const verified = verifyResumeToken(token);
  if (!verified.ok) {
    if (verified.reason === 'expired') {
      return { status: 410, error: 'Resume token expired' };
    }
    return { status: 401, error: `Resume token invalid: ${verified.reason}` };
  }
  // Refuse cross-approval token reuse — one approval's token cannot decide another.
  if (verified.approvalId !== approval.id) {
    return { status: 401, error: 'Resume token does not match approval' };
  }
  return null;
}

export const approvalRoutes = new Hono();

approvalRoutes.get('/', zValidator('query', listQuerySchema), (c) => {
  try {
    const { status, limit } = c.req.valid('query');
    const approvals = getApprovalsByStatus(status, limit);
    return c.json({ approvals });
  } catch (err) {
    logger.error('Failed to list approvals:', err);
    return c.json(
      { error: 'Failed to list approvals' },
      500 as ContentfulStatusCode,
    );
  }
});

approvalRoutes.get('/pending/count', (c) => {
  try {
    const count = getPendingApprovalCount();
    return c.json({ count });
  } catch (err) {
    logger.error('Failed to get pending count:', err);
    return c.json(
      { error: 'Failed to get count' },
      500 as ContentfulStatusCode,
    );
  }
});

// Static `/stream` registered before the dynamic `/:id` so route resolution
// is unambiguous regardless of router strategy.
approvalRoutes.get('/stream', (c) => {
  // Match the codebase SSE convention (agent.ts, files.ts, ag-ui.ts):
  // disable Nginx buffering and explicitly request keep-alive so reverse
  // proxies don't accumulate events before forwarding to the client.
  c.header('Cache-Control', 'no-cache');
  c.header('Connection', 'keep-alive');
  c.header('X-Accel-Buffering', 'no');
  return streamSSE(c, async (stream) => {
    const manager = getApprovalManager();

    const snapshot = manager.getPending();
    await stream.writeSSE({
      event: 'snapshot',
      data: JSON.stringify({ approvals: snapshot }),
    });

    let closed = false;
    const onEvent = (evt: ApprovalEvent) => {
      if (closed) return;
      stream
        .writeSSE({ event: evt.type, data: JSON.stringify(evt) })
        .catch(() => {});
    };
    manager.events.on('event', onEvent);

    const heartbeat = setInterval(() => {
      if (closed) return;
      stream
        .writeSSE({ event: 'heartbeat', data: String(Date.now()) })
        .catch(() => {});
    }, SSE_HEARTBEAT_MS);

    await new Promise<void>((resolve) => {
      stream.onAbort(() => {
        closed = true;
        clearInterval(heartbeat);
        manager.events.off('event', onEvent);
        resolve();
      });
    });
  });
});

approvalRoutes.get('/:id', (c) => {
  try {
    const manager = getApprovalManager();
    const approval = manager.getById(c.req.param('id'));
    if (!approval) {
      return c.json(
        { error: 'Approval not found' },
        404 as ContentfulStatusCode,
      );
    }
    return c.json({ approval });
  } catch (err) {
    logger.error('Failed to get approval:', err);
    return c.json(
      { error: 'Failed to get approval' },
      500 as ContentfulStatusCode,
    );
  }
});

approvalRoutes.post(
  '/:id/decide',
  zValidator('json', decideApprovalSchema),
  async (c) => {
    try {
      const { decision, reason, resumeToken } = c.req.valid('json');
      const id = c.req.param('id');
      const manager = getApprovalManager();
      const existing = manager.getById(id);
      if (!existing) {
        return c.json(
          { error: 'Approval not found' },
          404 as ContentfulStatusCode,
        );
      }

      const tokenErr = checkResumeToken(existing, resumeToken);
      if (tokenErr) {
        return c.json({ error: tokenErr.error }, tokenErr.status);
      }

      const approval = manager.decide(id, decision, 'user', reason);
      return c.json({ approval });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Failed to decide approval:', msg);
      if (msg.includes('not found')) {
        return c.json({ error: msg }, 404 as ContentfulStatusCode);
      }
      return c.json(
        { error: 'Failed to decide approval' },
        500 as ContentfulStatusCode,
      );
    }
  },
);
