/**
 * Task Documents API Routes
 *
 * CRUD endpoints for task-level documents (notes, plans, design docs).
 * Version history is auto-maintained by a BEFORE UPDATE trigger.
 */

import crypto from 'crypto';

import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

import {
  createOrUpdateDocument,
  getDocument,
  getDocumentHistory,
  getDocumentKeys,
  getDocumentVersion,
} from '@/shared/db/operations';
import { CreateOrUpdateTaskDocumentSchema } from '@/shared/db/schemas';
import type { DocKey } from '@/shared/db/types';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('DocumentsAPI');

export const documentsRoutes = new Hono();

const VALID_DOC_KEYS: DocKey[] = ['plan', 'notes', 'design', 'custom'];

function validateDocKey(key: string): key is DocKey {
  return (VALID_DOC_KEYS as string[]).includes(key);
}

/** GET /tasks/:taskId/documents — list doc keys with latest version info */
documentsRoutes.get('/:taskId/documents', (c) => {
  try {
    const taskId = c.req.param('taskId');
    const keys = getDocumentKeys(taskId);
    const documents = keys
      .map((key) => {
        const doc = getDocument(taskId, key);
        return doc
          ? {
              doc_key: doc.doc_key,
              title: doc.title,
              version: doc.version,
              created_by: doc.created_by,
              updated_at: doc.updated_at,
            }
          : null;
      })
      .filter(Boolean);
    return c.json({ documents });
  } catch (err) {
    logger.error('Failed to list task documents:', err);
    return c.json(
      { error: 'Failed to list documents' },
      500 as ContentfulStatusCode,
    );
  }
});

/** GET /tasks/:taskId/documents/:key — get latest version content */
documentsRoutes.get('/:taskId/documents/:key', (c) => {
  try {
    const taskId = c.req.param('taskId');
    const key = c.req.param('key');
    if (!validateDocKey(key)) {
      return c.json({ error: 'Invalid doc_key' }, 400 as ContentfulStatusCode);
    }
    const doc = getDocument(taskId, key);
    if (!doc) {
      return c.json(
        { error: 'Document not found' },
        404 as ContentfulStatusCode,
      );
    }
    return c.json({ document: doc });
  } catch (err) {
    logger.error('Failed to get task document:', err);
    return c.json(
      { error: 'Failed to get document' },
      500 as ContentfulStatusCode,
    );
  }
});

/** POST /tasks/:taskId/documents/:key — create or update */
documentsRoutes.post(
  '/:taskId/documents/:key',
  zValidator('json', CreateOrUpdateTaskDocumentSchema),
  (c) => {
    try {
      const taskId = c.req.param('taskId');
      const key = c.req.param('key');
      if (!validateDocKey(key)) {
        return c.json(
          { error: 'Invalid doc_key' },
          400 as ContentfulStatusCode,
        );
      }
      const body = c.req.valid('json');
      const doc = createOrUpdateDocument({
        id: body.id ?? crypto.randomUUID(),
        task_id: taskId,
        doc_key: key,
        title: body.title,
        content: body.content,
        created_by: body.created_by,
      });
      return c.json({ document: doc }, 200 as ContentfulStatusCode);
    } catch (err) {
      logger.error('Failed to create/update task document:', err);
      return c.json(
        { error: 'Failed to save document' },
        500 as ContentfulStatusCode,
      );
    }
  },
);

/** GET /tasks/:taskId/documents/:key/history — list all versions */
documentsRoutes.get('/:taskId/documents/:key/history', (c) => {
  try {
    const taskId = c.req.param('taskId');
    const key = c.req.param('key');
    if (!validateDocKey(key)) {
      return c.json({ error: 'Invalid doc_key' }, 400 as ContentfulStatusCode);
    }
    const history = getDocumentHistory(taskId, key);
    return c.json({ history });
  } catch (err) {
    logger.error('Failed to get document history:', err);
    return c.json(
      { error: 'Failed to get document history' },
      500 as ContentfulStatusCode,
    );
  }
});

/** GET /tasks/:taskId/documents/:key/history/:historyId — single historical version */
documentsRoutes.get('/:taskId/documents/:key/history/:historyId', (c) => {
  try {
    const historyId = c.req.param('historyId');
    const version = getDocumentVersion(historyId);
    if (!version) {
      return c.json(
        { error: 'Version not found' },
        404 as ContentfulStatusCode,
      );
    }
    return c.json({ version });
  } catch (err) {
    logger.error('Failed to get document version:', err);
    return c.json(
      { error: 'Failed to get version' },
      500 as ContentfulStatusCode,
    );
  }
});
