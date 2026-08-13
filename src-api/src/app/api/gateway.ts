import { Hono } from 'hono';

import {
  clearGatewayAuditLog,
  getAuditLog,
} from '@/shared/services/gateway/shared/db/operations';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('GatewayRoutes');

export const gatewayRoutes = new Hono();

gatewayRoutes.get('/audit-log', (c) => {
  try {
    const page = parseInt(c.req.query('page') ?? '1', 10);
    const limit = Math.min(parseInt(c.req.query('limit') ?? '20', 10), 100);
    const result = getAuditLog({ page, limit });
    return c.json(result);
  } catch (err) {
    logger.error('Failed to fetch gateway audit log:', err);
    return c.json({ entries: [], total: 0 });
  }
});

gatewayRoutes.delete('/audit-log', (c) => {
  try {
    const deleted = clearGatewayAuditLog();
    return c.json({ success: true, deleted });
  } catch (err) {
    logger.error('Failed to clear gateway audit log:', err);
    return c.json({ success: false, error: 'Failed to clear audit log' }, 500);
  }
});
