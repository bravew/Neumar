/**
 * Linear API Routes
 *
 * Webhook receiver with idempotency + Linear integration endpoints.
 * Follows pattern from mcp.ts: const linear = new Hono(), export { linear as linearRoutes }.
 */

import { Hono } from 'hono';

import { APP_SLUG } from '@/config/branding';
import {
  LINEAR_WEBHOOK_IPS,
  WEBHOOK_DELIVERY_TTL_MS,
} from '@/config/constants';

import {
  createTestClient,
  getAssignedIssues,
  getIssueDetails,
  getLinearClient,
  getWebhookClient,
  isPolling,
  LINEAR_WEBHOOK_SIGNATURE_HEADER,
  LINEAR_WEBHOOK_TS_FIELD,
  startPolling,
  stopPolling,
} from '@/shared/services/linear';
import {
  getLinearConfig,
  loadLinearConfig,
  saveLinearConfig,
} from '@/shared/services/linear-config';
import type { LinearConfig } from '@/shared/services/linear-config';
import {
  cleanup as cleanupPipelines,
  enqueue,
  getAll as getAllPipelines,
  getBudgetSummary,
  getStatus as getPipelineStatus,
} from '@/shared/services/pipeline';
import { createLogger } from '@/shared/utils/logger';

const linear = new Hono();
const logger = createLogger('LinearAPI');

// ============================================================================
// Webhook delivery dedup
// ============================================================================

const processedDeliveries = new Map<string, number>();

function hasProcessedDelivery(deliveryId: string): boolean {
  return processedDeliveries.has(deliveryId);
}

function markDeliveryProcessed(deliveryId: string): void {
  processedDeliveries.set(deliveryId, Date.now());
  const cutoff = Date.now() - WEBHOOK_DELIVERY_TTL_MS;
  for (const [id, ts] of processedDeliveries) {
    if (ts < cutoff) processedDeliveries.delete(id);
  }
}

// ============================================================================
// Webhook endpoint
// ============================================================================

linear.post('/webhook', async (c) => {
  const config = getLinearConfig();

  // 0. IP allowlisting
  const clientIp =
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    c.req.header('x-real-ip') ||
    '';
  if (clientIp && !LINEAR_WEBHOOK_IPS.includes(clientIp)) {
    logger.warn(`Webhook rejected: IP ${clientIp} not in Linear allowlist`);
    return c.json({ success: false, error: 'Forbidden' }, 403);
  }

  // 1. Read raw body
  const rawBody = await c.req.text();
  const signature = c.req.header(LINEAR_WEBHOOK_SIGNATURE_HEADER) ?? '';
  const deliveryId = c.req.header('Linear-Delivery') ?? '';

  // 2. Parse payload
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return c.json({ success: false, error: 'Invalid JSON' }, 400);
  }

  // 3. Verify signature + timestamp
  if (config.webhookSecret) {
    const webhookClient = getWebhookClient(config.webhookSecret);
    try {
      webhookClient.verify(
        Buffer.from(rawBody),
        signature,
        payload[LINEAR_WEBHOOK_TS_FIELD] as number | string | undefined,
      );
    } catch (err) {
      logger.warn('Webhook signature/timestamp verification failed:', err);
      return c.json(
        { success: false, error: 'Invalid signature or stale webhook' },
        401,
      );
    }
  } else {
    logger.warn(
      'Webhook secret not configured — signature verification skipped. Set a webhook secret for production use.',
    );
  }

  // 4. Idempotency
  if (deliveryId && hasProcessedDelivery(deliveryId)) {
    return c.json({
      success: true,
      data: { skipped: true, reason: 'duplicate' },
    });
  }
  if (deliveryId) markDeliveryProcessed(deliveryId);

  // 5. Filter by event type
  if (payload.type !== 'Issue' || payload.action !== 'update') {
    return c.json({
      success: true,
      data: { skipped: true, reason: 'irrelevant event' },
    });
  }

  const data = payload.data as Record<string, unknown> | undefined;

  // 5b. Check trigger conditions: assignee match OR label match
  // Agent processes tickets that are either assigned to it or have a trigger label
  const assigneeId = (data?.assignee as Record<string, unknown> | undefined)
    ?.id;
  const issueLabels = (
    (data?.labels as { name: string }[] | undefined) ?? []
  ).map((l) => l.name.toLowerCase());

  const agentId = config.agentUserId || config.assigneeFilter;
  const assigneeMatch = agentId ? assigneeId === agentId : false;
  const labelMatch =
    config.triggerLabels.length > 0 &&
    config.triggerLabels.some((tl) => issueLabels.includes(tl.toLowerCase()));

  // Must match at least one trigger condition (if any are configured)
  if (
    (agentId || config.triggerLabels.length > 0) &&
    !assigneeMatch &&
    !labelMatch
  ) {
    return c.json({
      success: true,
      data: { skipped: true, reason: 'no trigger match (assignee or label)' },
    });
  }

  // 6. Return 200 immediately, enqueue async
  const issueId = data?.id as string;
  void (async () => {
    try {
      const issue = await getIssueDetails(issueId);
      await enqueue(issue);
    } catch (err) {
      logger.error(`Failed to enqueue issue ${issueId}:`, err);
    }
  })();

  return c.json({ success: true });
});

// ============================================================================
// Status & config endpoints
// ============================================================================

linear.get('/status', (c) => {
  const config = getLinearConfig();
  const pipelines = getAllPipelines();
  return c.json({
    success: true,
    data: {
      connected: !!config.apiKey,
      pollerRunning: isPolling(),
      webhookEnabled: config.webhookEnabled,
      activePipelines: pipelines.filter(
        (p) => !['completed', 'failed'].includes(p.status),
      ).length,
      pipelines: pipelines.map((p) => ({
        issueId: p.issueId,
        issueIdentifier: p.issueIdentifier,
        status: p.status,
      })),
    },
  });
});

linear.get('/config', (c) => {
  const config = getLinearConfig();
  // Redact secrets — show last 4 chars only
  const redact = (s: string) =>
    s ? `${'*'.repeat(Math.max(0, s.length - 4))}${s.slice(-4)}` : '';

  return c.json({
    success: true,
    data: {
      ...config,
      apiKey: redact(config.apiKey),
      webhookSecret: redact(config.webhookSecret),
      githubToken: redact(config.githubToken),
      slackWebhookUrl: redact(config.slackWebhookUrl),
      figmaToken: redact(config.figmaToken),
      clientSecret: redact(config.clientSecret),
    },
  });
});

linear.post('/config', async (c) => {
  try {
    const body = await c.req.json<Partial<LinearConfig>>();
    await saveLinearConfig(body);

    // Restart poller if needed
    const config = getLinearConfig();
    if (config.pollEnabled && config.apiKey) {
      stopPolling();
      startPolling(config);
    } else {
      stopPolling();
    }

    return c.json({ success: true, message: 'Config saved' });
  } catch (err) {
    logger.error('Failed to save config:', err);
    return c.json({ success: false, error: 'Failed to save config' }, 500);
  }
});

// ============================================================================
// Issue & pipeline endpoints
// ============================================================================

linear.get('/issues', async (c) => {
  try {
    const config = getLinearConfig();
    if (!config.apiKey || !config.assigneeFilter) {
      return c.json(
        {
          success: false,
          error: 'API key or assignee filter not configured',
        },
        400,
      );
    }
    getLinearClient(config.apiKey);
    const issues = await getAssignedIssues(config.assigneeFilter);
    return c.json({ success: true, data: issues });
  } catch (err) {
    logger.error('Failed to fetch issues:', err);
    return c.json({ success: false, error: 'Failed to fetch issues' }, 500);
  }
});

linear.post('/process/:issueId', async (c) => {
  const issueId = c.req.param('issueId');
  try {
    const config = getLinearConfig();
    if (!config.apiKey) {
      return c.json({ success: false, error: 'API key not configured' }, 400);
    }
    getLinearClient(config.apiKey);

    // Check if already active
    const existing = getPipelineStatus(issueId);
    if (existing && !['completed', 'failed'].includes(existing.status)) {
      return c.json(
        {
          success: false,
          error: 'Pipeline already active for this issue',
        },
        409,
      );
    }

    const issue = await getIssueDetails(issueId);
    const result = await enqueue(issue);
    return c.json({ success: result.accepted, reason: result.reason });
  } catch (err) {
    logger.error(`Failed to process issue ${issueId}:`, err);
    return c.json({ success: false, error: 'Failed to process issue' }, 500);
  }
});

linear.get('/pipeline/:issueId', (c) => {
  const issueId = c.req.param('issueId');
  const state = getPipelineStatus(issueId);
  if (!state) {
    return c.json({ success: false, error: 'Pipeline not found' }, 404);
  }
  return c.json({ success: true, data: state });
});

linear.get('/pipelines', (c) => {
  return c.json({ success: true, data: getAllPipelines() });
});

// ============================================================================
// Connection & polling management
// ============================================================================

linear.post('/test-connection', async (c) => {
  try {
    const body = await c.req.json<{ apiKey?: string; useStored?: boolean }>();
    let apiKey = body.apiKey;

    // Allow testing with the stored key when the frontend only has the redacted value
    if ((!apiKey || apiKey.includes('****')) && body.useStored) {
      const config = getLinearConfig();
      apiKey = config.apiKey;
    }

    if (!apiKey) {
      return c.json({ success: false, error: 'API key required' }, 400);
    }
    // Use ephemeral client — does NOT mutate global state
    const client = createTestClient(apiKey);
    const viewer = await client.viewer;

    // Auto-populate agent identity on successful connection
    const config = getLinearConfig();
    if (!config.agentUserId || !config.agentName) {
      await saveLinearConfig({
        agentUserId: config.agentUserId || viewer.id,
        agentName: config.agentName || viewer.displayName || viewer.name,
        // Auto-set assigneeFilter if not already configured
        ...(config.assigneeFilter ? {} : { assigneeFilter: viewer.id }),
      });
      logger.info(
        `Auto-populated agent identity: ${viewer.name} (${viewer.id})`,
      );
    }

    return c.json({
      success: true,
      data: {
        name: viewer.name,
        email: viewer.email,
        id: viewer.id,
        displayName: viewer.displayName,
      },
    });
  } catch (err) {
    logger.error('Connection test failed:', err);
    return c.json(
      {
        success: false,
        error: 'Connection failed. Check your API key.',
      },
      401,
    );
  }
});

linear.post('/polling/start', async (c) => {
  try {
    await loadLinearConfig();
    const config = getLinearConfig();
    if (!config.apiKey) {
      return c.json({ success: false, error: 'API key not configured' }, 400);
    }
    startPolling(config);
    return c.json({ success: true, message: 'Poller started' });
  } catch (err) {
    logger.error('Failed to start poller:', err);
    return c.json({ success: false, error: 'Failed to start poller' }, 500);
  }
});

linear.post('/polling/stop', (c) => {
  stopPolling();
  return c.json({ success: true, message: 'Poller stopped' });
});

linear.post('/test-slack', async (c) => {
  try {
    const config = getLinearConfig();
    if (!config.slackWebhookUrl) {
      return c.json(
        { success: false, error: 'Slack webhook URL not configured' },
        400,
      );
    }

    const { sendSlackNotification } = await import('@/shared/services/slack');
    await sendSlackNotification(config.slackWebhookUrl, {
      title: 'Test Notification',
      issueId: 'TEST-0',
      issueTitle: `This is a test notification from ${APP_SLUG}`,
      prUrl: '',
      summary:
        'If you see this message, Slack integration is working correctly.',
      branch: 'main',
    });

    return c.json({ success: true, message: 'Test message sent' });
  } catch (err) {
    logger.error('Slack test failed:', err);
    return c.json(
      {
        success: false,
        error:
          err instanceof Error ? err.message : 'Failed to send test message',
      },
      500,
    );
  }
});

linear.get('/budget', async (c) => {
  try {
    const summary = await getBudgetSummary();
    const config = getLinearConfig();
    return c.json({
      success: true,
      data: {
        ...summary,
        limits: {
          maxUsdPerTicket: config.maxUsdPerTicket,
          maxUsdPerDay: config.maxUsdPerDay,
        },
      },
    });
  } catch (err) {
    logger.error('Failed to get budget summary:', err);
    return c.json({ success: false, error: 'Failed to get budget' }, 500);
  }
});

linear.post('/cleanup', (c) => {
  const evicted = cleanupPipelines();
  return c.json({
    success: true,
    data: { evicted },
  });
});

export { linear as linearRoutes };
