/**
 * Slack API Routes
 *
 * Config, gateway control, channels, and sessions.
 * Follows pattern from linear.ts: const slack = new Hono(), export { slack as slackRoutes }.
 */

import { zValidator } from '@hono/zod-validator';
import type { WebClient } from '@slack/web-api';
import { Hono } from 'hono';
import { z } from 'zod';

import * as tokenManager from '@/shared/auth/token-manager';
import type { OAuthConnection, OAuthTokens } from '@/shared/auth/types';
import {
  getSlackConfig,
  loadSlackConfig,
  saveSlackConfig,
} from '@/shared/services/slack-config';
import type { SlackConfig } from '@/shared/services/slack-config';
import { slackCoworkHandler } from '@/shared/services/slack-cowork-handler';
import { slackGateway, toGatewayConfig } from '@/shared/services/slack-gateway';
import type { SlackInboundMessage } from '@/shared/services/slack-gateway';
import { createLogger } from '@/shared/utils/logger';

const slack = new Hono();
const logger = createLogger('SlackAPI');

// ============================================================================
// Constants & Schemas
// ============================================================================

/** Timeout for outbound Slack API calls */
const SLACK_API_TIMEOUT_MS = 15_000;

const channelsQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(999).optional(),
  exclude_archived: z.enum(['true', 'false']).optional(),
  types: z.string().optional(),
});

const slackConfigUpdateSchema = z.object({
  clientId: z.string().optional(),
  clientSecret: z.string().optional(),
  appToken: z.string().optional(),
  botToken: z.string().optional(),
  userToken: z.string().optional(),
  teamId: z.string().optional(),
  teamName: z.string().optional(),
  botUserId: z.string().optional(),
  authedUserId: z.string().optional(),
  authedUserEmail: z.string().optional(),
  gateway: z
    .object({
      enabled: z.boolean().optional(),
      autoStart: z.boolean().optional(),
      listenToDMs: z.boolean().optional(),
      listenToMentions: z.boolean().optional(),
      defaultChannel: z.string().nullable().optional(),
    })
    .optional(),
  connectedAt: z.string().optional(),
});

const slackConnectSchema = z.object({
  botToken: z.string().min(1),
  userToken: z.string().optional(),
});

// ============================================================================
// Gateway ↔ Cowork Handler wiring
// ============================================================================

let gatewayWired = false;

function wireGatewayToCoworkHandler(): void {
  if (gatewayWired) return;
  slackGateway.on('inbound-message', onInboundMessage);
  slackCoworkHandler.startCleanup();
  gatewayWired = true;
  logger.info('Gateway wired to cowork handler');
}

function unwireGatewayFromCoworkHandler(): void {
  if (!gatewayWired) return;
  slackGateway.removeListener('inbound-message', onInboundMessage);
  slackCoworkHandler.stopCleanup();
  gatewayWired = false;
  logger.info('Gateway unwired from cowork handler');
}

function onInboundMessage(msg: SlackInboundMessage, client: WebClient): void {
  slackCoworkHandler.handleInboundMessage(msg, client).catch((err) => {
    logger.error('Cowork handler failed to process inbound message', { err });
  });
}

const SENSITIVE_FIELDS = [
  'clientSecret',
  'appToken',
  'botToken',
  'userToken',
] as const;

function redactConfig(config: SlackConfig): Record<string, unknown> {
  const out: Record<string, unknown> = { ...config };
  for (const field of SENSITIVE_FIELDS) {
    const val = config[field];
    if (val && typeof val === 'string') {
      out[field] = '••••••';
    }
  }
  return out;
}

// ============================================================================
// Config
// ============================================================================

slack.get('/config', async (c) => {
  try {
    await loadSlackConfig();
    const config = getSlackConfig();
    return c.json({ success: true, data: redactConfig(config) });
  } catch (err) {
    logger.error('Failed to load Slack config:', err);
    return c.json({ success: false, error: 'Failed to load config' }, 500);
  }
});

slack.put('/config', zValidator('json', slackConfigUpdateSchema), async (c) => {
  try {
    const body = c.req.valid('json');
    await saveSlackConfig(body as Partial<SlackConfig>);
    return c.json({ success: true, message: 'Config saved' });
  } catch (err) {
    logger.error('Failed to save Slack config:', err);
    return c.json({ success: false, error: 'Failed to save config' }, 500);
  }
});

// ============================================================================
// Manual Token Connect
// ============================================================================

/** ~10 years — Slack bot/user tokens don't expire */
const NON_EXPIRING_TOKEN_LIFETIME_MS = 10 * 365 * 24 * 60 * 60 * 1000;

interface SlackAuthTestResponse {
  ok: boolean;
  url?: string;
  team?: string;
  user?: string;
  team_id?: string;
  user_id?: string;
  bot_id?: string;
  is_enterprise_install?: boolean;
  error?: string;
}

/**
 * Connect Slack via manually-pasted tokens (bypasses OAuth redirect flow).
 * Validates tokens via auth.test, creates OAuthConnection + OAuthTokens,
 * and saves to slack-config for gateway use.
 */
slack.post('/connect', zValidator('json', slackConnectSchema), async (c) => {
  try {
    const body = c.req.valid('json');

    if (!body.botToken.startsWith('xoxb-')) {
      return c.json(
        {
          success: false,
          error: 'Bot token is required (must start with xoxb-)',
        },
        400,
      );
    }

    // Validate bot token via auth.test
    const botAuthRes = await fetch('https://slack.com/api/auth.test', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${body.botToken}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(SLACK_API_TIMEOUT_MS),
    });
    const botAuth: SlackAuthTestResponse = await botAuthRes.json();

    if (!botAuth.ok) {
      return c.json(
        {
          success: false,
          error: `Invalid bot token: ${botAuth.error ?? 'unknown error'}`,
        },
        400,
      );
    }

    // Validate user token if provided
    let userAuth: SlackAuthTestResponse | null = null;
    if (body.userToken) {
      if (!body.userToken.startsWith('xoxp-')) {
        return c.json(
          { success: false, error: 'User token must start with xoxp-' },
          400,
        );
      }
      const userAuthRes = await fetch('https://slack.com/api/auth.test', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${body.userToken}`,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(SLACK_API_TIMEOUT_MS),
      });
      userAuth = await userAuthRes.json();
      if (!userAuth?.ok) {
        return c.json(
          {
            success: false,
            error: `Invalid user token: ${userAuth?.error ?? 'unknown error'}`,
          },
          400,
        );
      }
    }

    const teamId = botAuth.team_id ?? '';
    const teamName = botAuth.team ?? '';
    const now = new Date().toISOString();

    // Build OAuthTokens (same structure as exchangeSlack in oauth-client.ts)
    const tokens: OAuthTokens = {
      accessToken: body.botToken,
      refreshToken: null,
      idToken: null,
      tokenType: 'bot',
      expiresAt: Date.now() + NON_EXPIRING_TOKEN_LIFETIME_MS,
      scopes: [], // scopes aren't returned by auth.test
      ...(body.userToken ? { userAccessToken: body.userToken } : {}),
    };

    // Build OAuthConnection
    const connection: OAuthConnection = {
      id: `slack_${teamId}`,
      provider: 'slack',
      accountEmail: teamName,
      displayName: teamName,
      avatarUrl: '',
      scopes: [],
      status: 'active',
      connectedAt: now,
      expiresAt: null,
      updatedAt: now,
      metadata: {
        teamId,
        teamName,
        ...(botAuth.bot_id ? { botUserId: botAuth.bot_id } : {}),
        ...(userAuth?.user_id ? { authedUserId: userAuth.user_id } : {}),
      },
    };

    // Save to token store (same as OAuth flow)
    await tokenManager.saveTokens('slack', connection, tokens);

    // Also save to slack-config for gateway/channel operations
    await saveSlackConfig({
      botToken: body.botToken,
      ...(body.userToken ? { userToken: body.userToken } : {}),
      teamId,
      teamName,
      botUserId: botAuth.bot_id ?? '',
      authedUserId: userAuth?.user_id ?? '',
      connectedAt: now,
    });

    logger.info(`Slack connected manually for team ${teamName} (${teamId})`);

    return c.json({
      success: true,
      data: {
        teamId,
        teamName,
        botUserId: botAuth.bot_id ?? '',
        user: userAuth?.user ?? '',
      },
    });
  } catch (err) {
    logger.error('Failed to connect Slack manually:', err);
    return c.json({ success: false, error: 'Failed to validate tokens' }, 500);
  }
});

// ============================================================================
// Gateway
// ============================================================================

slack.get('/gateway/status', (c) => {
  return c.json({ success: true, data: slackGateway.getStatus() });
});

slack.post('/gateway/start', async (c) => {
  try {
    await loadSlackConfig();
    const config = getSlackConfig();
    await slackGateway.start(toGatewayConfig(config));
    wireGatewayToCoworkHandler();
    return c.json({ success: true, message: 'Gateway started' });
  } catch (err) {
    logger.error('Failed to start Slack gateway:', err);
    return c.json({ success: false, error: 'Failed to start gateway' }, 500);
  }
});

slack.post('/gateway/stop', async (c) => {
  try {
    unwireGatewayFromCoworkHandler();
    await slackGateway.stop();
    return c.json({ success: true, message: 'Gateway stopped' });
  } catch (err) {
    logger.error('Failed to stop Slack gateway:', err);
    return c.json({ success: false, error: 'Failed to stop gateway' }, 500);
  }
});

slack.post('/gateway/restart', async (c) => {
  try {
    unwireGatewayFromCoworkHandler();
    await loadSlackConfig();
    const config = getSlackConfig();
    await slackGateway.restart(toGatewayConfig(config));
    wireGatewayToCoworkHandler();
    return c.json({ success: true, message: 'Gateway restarted' });
  } catch (err) {
    logger.error('Failed to restart Slack gateway:', err);
    return c.json({ success: false, error: 'Failed to restart gateway' }, 500);
  }
});

slack.post('/gateway/test', async (c) => {
  try {
    const config = getSlackConfig();
    const result = await slackGateway.testConnectivity(toGatewayConfig(config));
    return c.json({ success: true, data: result });
  } catch (err) {
    logger.error('Slack connectivity test failed:', err);
    return c.json({ success: false, error: 'Connectivity test failed' }, 500);
  }
});

// ============================================================================
// Channels & Sessions
// ============================================================================

slack.get('/channels', zValidator('query', channelsQuerySchema), async (c) => {
  try {
    const config = getSlackConfig();
    if (!config.botToken) {
      return c.json({ success: false, error: 'Bot token not configured' }, 400);
    }

    const q = c.req.valid('query');
    const cursor = q.cursor ?? '';
    const limit = q.limit ?? 200;
    const excludeArchived = q.exclude_archived !== 'false';
    const types = q.types ?? 'public_channel,private_channel';

    const params = new URLSearchParams();
    params.set('limit', String(limit));
    params.set('exclude_archived', excludeArchived ? 'true' : 'false');
    params.set('types', types);
    if (cursor) params.set('cursor', cursor);

    const res = await fetch(
      `https://slack.com/api/conversations.list?${params.toString()}`,
      {
        headers: {
          Authorization: `Bearer ${config.botToken}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        signal: AbortSignal.timeout(SLACK_API_TIMEOUT_MS),
      },
    );

    const retryAfter = res.headers.get('retry-after');
    const data = (await res.json()) as {
      ok?: boolean;
      channels?: Array<{ id: string; name: string; is_channel?: boolean }>;
      response_metadata?: { next_cursor?: string };
      error?: string;
    };

    if (!data.ok) {
      const slackError = data.error ?? 'unknown_error';
      let status: 400 | 401 | 403 | 429 | 502 = 400;
      if (slackError === 'invalid_auth' || slackError === 'not_authed') {
        status = 401;
      } else if (
        slackError === 'missing_scope' ||
        slackError === 'no_permission'
      ) {
        status = 403;
      } else if (slackError === 'rate_limited') {
        status = 429;
        if (retryAfter) c.header('Retry-After', retryAfter);
      } else if (res.status >= 500) {
        status = 502;
      }
      return c.json({ success: false, error: slackError }, status);
    }

    const channels = (data.channels ?? []).map((ch) => ({
      id: ch.id,
      name: ch.name,
      isChannel: ch.is_channel ?? false,
    }));
    const nextCursor = data.response_metadata?.next_cursor ?? '';

    return c.json({
      success: true,
      data: channels,
      nextCursor: nextCursor || null,
    });
  } catch (err) {
    logger.error('Failed to list Slack channels:', err);
    return c.json({ success: false, error: 'Failed to list channels' }, 500);
  }
});

slack.get('/sessions', (c) => {
  return c.json({
    success: true,
    data: slackCoworkHandler.getActiveSessions(),
  });
});

export { slack as slackRoutes };
