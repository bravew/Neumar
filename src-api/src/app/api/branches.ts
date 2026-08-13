/**
 * Branches API Routes
 *
 * Endpoints for conversation branching — creating, listing, and merging
 * message branches within a task.
 */

import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { z } from 'zod';

import {
  createBranch,
  createBranchWithEditedMessage,
  deleteBranchMessagesAfter,
  getBranches,
  getBranchesAtForkPoint,
  mergeBranch,
  resolveMessageId,
  searchMessages,
} from '@/shared/db/operations';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('BranchesAPI');

export const branchesRoutes = new Hono();

const createBranchSchema = z.object({
  fromMessageId: z.union([z.number(), z.string()]),
});

const mergeBranchSchema = z.object({
  targetBranchId: z.string(),
  afterMessageId: z.union([z.number(), z.string()]),
});

const editBranchSchema = z.object({
  fromMessageId: z.union([z.number(), z.string()]),
  newContent: z.string().min(1),
});

const regenerateSchema = z.object({
  afterMessageId: z.union([z.number(), z.string()]),
  branchId: z.string().uuid(),
});

/** POST /:taskId/branches — create branch from message */
branchesRoutes.post(
  '/:taskId/branches',
  zValidator('json', createBranchSchema),
  async (c) => {
    try {
      const taskId = c.req.param('taskId');
      const { fromMessageId } = c.req.valid('json');
      const numericId = resolveMessageId(taskId, fromMessageId);
      const branchId = createBranch(taskId, numericId);
      return c.json({ branchId }, 201 as ContentfulStatusCode);
    } catch (err) {
      logger.error('Failed to create branch:', err);
      return c.json(
        { error: 'Failed to create branch' },
        500 as ContentfulStatusCode,
      );
    }
  },
);

/** GET /:taskId/branches — list branches for task */
branchesRoutes.get('/:taskId/branches', (c) => {
  try {
    const taskId = c.req.param('taskId');
    const branches = getBranches(taskId);
    return c.json({ branches });
  } catch (err) {
    logger.error('Failed to list branches:', err);
    return c.json(
      { error: 'Failed to list branches' },
      500 as ContentfulStatusCode,
    );
  }
});

/** POST /:taskId/branches/:branchId/merge — merge branch */
branchesRoutes.post(
  '/:taskId/branches/:branchId/merge',
  zValidator('json', mergeBranchSchema),
  async (c) => {
    try {
      const taskId = c.req.param('taskId');
      const sourceBranchId = c.req.param('branchId');
      const { targetBranchId, afterMessageId } = c.req.valid('json');
      const numericId = resolveMessageId(taskId, afterMessageId);
      const result = mergeBranch(
        taskId,
        sourceBranchId,
        targetBranchId,
        numericId,
      );
      return c.json({ result });
    } catch (err) {
      logger.error('Failed to merge branch:', err);
      return c.json(
        { error: 'Failed to merge branch' },
        500 as ContentfulStatusCode,
      );
    }
  },
);

/** POST /:taskId/branches/edit — edit message and create branch */
branchesRoutes.post(
  '/:taskId/branches/edit',
  zValidator('json', editBranchSchema),
  async (c) => {
    try {
      const taskId = c.req.param('taskId');
      const { fromMessageId, newContent } = c.req.valid('json');
      const numericId = resolveMessageId(taskId, fromMessageId);
      const result = createBranchWithEditedMessage(
        taskId,
        numericId,
        newContent,
      );
      return c.json(result, 201 as ContentfulStatusCode);
    } catch (err) {
      logger.error('Failed to create edit branch:', err);
      return c.json(
        { error: 'Failed to create edit branch' },
        500 as ContentfulStatusCode,
      );
    }
  },
);

const messageIdParamSchema = z.object({
  messageId: z.coerce.number().int(),
});

/** GET /:taskId/branches/at/:messageId — branches forking from a message */
branchesRoutes.get(
  '/:taskId/branches/at/:messageId',
  zValidator('param', messageIdParamSchema),
  (c) => {
    try {
      const taskId = c.req.param('taskId');
      const { messageId } = c.req.valid('param');
      const branches = getBranchesAtForkPoint(taskId, messageId);
      return c.json({ branches });
    } catch (err) {
      logger.error('Failed to get branches at fork point:', err);
      return c.json(
        { error: 'Failed to get branches at fork point' },
        500 as ContentfulStatusCode,
      );
    }
  },
);

/** POST /:taskId/branches/regenerate — delete messages after point for re-run */
branchesRoutes.post(
  '/:taskId/branches/regenerate',
  zValidator('json', regenerateSchema),
  async (c) => {
    try {
      const taskId = c.req.param('taskId');
      const { afterMessageId, branchId } = c.req.valid('json');
      const numericId = resolveMessageId(taskId, afterMessageId);
      const deleted = deleteBranchMessagesAfter(taskId, branchId, numericId);
      return c.json({ deleted, branchId });
    } catch (err) {
      logger.error('Failed to regenerate branch:', err);
      return c.json(
        { error: 'Failed to regenerate' },
        500 as ContentfulStatusCode,
      );
    }
  },
);

/** GET /:taskId/messages/search — full-text search within task messages */
branchesRoutes.get('/:taskId/messages/search', (c) => {
  try {
    const taskId = c.req.param('taskId');
    const query = c.req.query('q') ?? '';
    if (!query) {
      return c.json({ messages: [] });
    }
    const messages = searchMessages(taskId, query);
    return c.json({ messages });
  } catch (err) {
    logger.error('Failed to search messages:', err);
    return c.json(
      { error: 'Failed to search messages' },
      500 as ContentfulStatusCode,
    );
  }
});
