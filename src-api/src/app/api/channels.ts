import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { z } from 'zod';

import {
  getChannelToken,
  hasChannelCredential,
  mergeAndSaveCredential,
  mergeTokenFields,
  removeChannelCredential,
} from '@/shared/auth/credential-vault';
import { channelFallbackService } from '@/shared/channels/_shared/fallback-service';
import { getAuditLog } from '@/shared/channels/audit-log';
import { getChannelManager } from '@/shared/channels/channel-manager';
import { parseLarkTokenConfig } from '@/shared/channels/lark/diagnostics';
import { verifyAndPair } from '@/shared/channels/pairing-service';
import type {
  BasePluginConfig,
  ChannelPlatform,
} from '@/shared/channels/types';
import {
  createPairingCode,
  deleteChannelConfig,
  getAllChannelConfigs,
  getChannelAuditLogs,
  getChannelConfig,
  getChannelConfigById,
  getChannelSessionMessages,
  getChannelSessions,
  getChannelUsers,
  removeChannelUser,
  updateChannelUserBudget,
  updateChannelUserTier,
  upsertChannelConfig,
} from '@/shared/db/operations';
import {
  channelPermissionTierSchema,
  channelPlatformSchema,
  createChannelConfigSchema,
  upsertChannelConfigSchema,
} from '@/shared/db/schemas';
// Side-effect import: each adapter module registers itself with the registry
// at module load time. Without this, getRegisteredChannelIds() returns empty.
import '@/shared/services/gateway/channels';
import { getGateway } from '@/shared/services/gateway';
import { probeBlueBubbles } from '@/shared/services/gateway/channels/imessage/probe';
import { verifyBlueBubblesWebhook } from '@/shared/services/gateway/channels/imessage/webhook';
import {
  getRegisteredChannelIds,
  getRegisteredChannelMetadata,
} from '@/shared/services/gateway/channels/registry';
import {
  parseWhatsAppCloudConfig,
  verifyWhatsAppChallenge,
  verifyWhatsAppSignature,
} from '@/shared/services/gateway/channels/whatsapp/cloud';
import {
  createRoutingRule,
  deleteRoutingRule,
  getAllChannels,
  getAllRoutingRules,
  getChannelConfig as getGatewayChannelConfig,
  getRoutingRule,
  updateChannelStatus,
  updateRoutingRule,
  upsertChannel,
} from '@/shared/services/gateway/shared/db/operations';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('ChannelRoutes');

/**
 * Return a masked representation of the vault token for the given platform.
 *
 * Plain tokens (Telegram, Discord): `'...' + last4`.
 * JSON tokens (Slack, Lark): each sub-field masked individually so the frontend
 * can JSON.parse the result and populate individual `ApiKeyField` components.
 *
 * Returns `null` when no credential is stored.
 */
function getMaskedToken(configId: string): string | null {
  const token = getChannelToken(configId);
  if (!token) return null;
  try {
    const obj = JSON.parse(token) as Record<string, string>;
    return JSON.stringify(
      Object.fromEntries(
        Object.entries(obj).map(([k, v]) => [
          k,
          v.length <= 4 ? '****' : '...' + v.slice(-4),
        ]),
      ),
    );
  } catch {
    return token.length <= 4 ? '****' : '...' + token.slice(-4);
  }
}

/** Returns true when the token is a real credential, not a masked placeholder from getMaskedToken. */
function isRealToken(token: string): boolean {
  if (token.startsWith('...') || token === '****') return false;
  try {
    const obj = JSON.parse(token) as Record<string, string>;
    return Object.values(obj).some((v) => !v.startsWith('...') && v !== '****');
  } catch {
    return true;
  }
}

const putChannelConfigSchema = upsertChannelConfigSchema.extend({
  token: z.string().optional(),
});

const validateTokenSchema = z.object({ token: z.string().optional() });

const pairingVerifySchema = z.object({
  code: z.string().min(1),
  displayName: z.string().optional(),
});

const updateTierSchema = z.object({
  tier: channelPermissionTierSchema,
});

const updateBudgetSchema = z.object({
  tokenBudget: z.number().int().min(0),
});

/** Build a BasePluginConfig from a DB config row + vault token. */
function buildPluginConfig(
  cfg: NonNullable<ReturnType<typeof getChannelConfigById>>,
  configId: string,
  token: string,
): BasePluginConfig {
  return {
    configId,
    platform: cfg.platform as BasePluginConfig['platform'],
    token,
    mode: (cfg.mode ?? 'polling') as BasePluginConfig['mode'],
    guardrails_provider: (cfg.guardrails_provider ??
      'none') as BasePluginConfig['guardrails_provider'],
    guardrails_fail_mode: (cfg.guardrails_fail_mode ??
      'open') as BasePluginConfig['guardrails_fail_mode'],
    mention_only: cfg.mention_only ?? false,
    access_mode: (cfg.access_mode ?? 'open') as BasePluginConfig['access_mode'],
  };
}

type ValidationResult = { valid: boolean; info?: object; error?: string };
type PlatformValidator = (token: string) => Promise<ValidationResult>;

const validateTelegram: PlatformValidator = async (token) => {
  const { Bot } = await import('grammy');
  const bot = new Bot(token);
  const me = await bot.api.getMe();
  return { valid: true, info: { username: me.username, name: me.first_name } };
};

const validateDiscord: PlatformValidator = async (token) => {
  const { Client, GatewayIntentBits, Events } = await import('discord.js');
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
    ],
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('Connection timeout')),
        15_000,
      );
      client.once(Events.ClientReady, () => {
        clearTimeout(timeout);
        resolve();
      });
      client.once(Events.Error, (err) => {
        clearTimeout(timeout);
        reject(err);
      });
      client.login(token).catch(reject);
    });
    return {
      valid: true,
      info: { username: client.user?.username, id: client.user?.id },
    };
  } finally {
    await client.destroy();
  }
};

const validateSlack: PlatformValidator = async (token) => {
  let parsed: { botToken?: string; appToken?: string };
  try {
    parsed = JSON.parse(token) as { botToken?: string; appToken?: string };
  } catch {
    return {
      valid: false,
      error:
        'Slack token must be JSON: {"botToken": "xoxb-...", "appToken": "xapp-..."}',
    };
  }
  const { botToken, appToken } = parsed;
  if (!botToken?.startsWith('xoxb-'))
    return {
      valid: false,
      error:
        'Bot Token must start with xoxb- — find it under OAuth & Permissions → Bot User OAuth Token',
    };
  if (!appToken?.startsWith('xapp-'))
    return {
      valid: false,
      error:
        'App-Level Token must start with xapp- — create one under Basic Information → App-Level Tokens with connections:write scope, then enable Socket Mode',
    };
  const resp = await fetch('https://slack.com/api/auth.test', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${botToken}`,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(10_000),
  });
  const data = (await resp.json()) as {
    ok: boolean;
    error?: string;
    user?: string;
    team?: string;
  };
  if (!data.ok) {
    return {
      valid: false,
      error:
        data.error === 'invalid_auth'
          ? 'Invalid Bot Token — verify your xoxb-... token in OAuth & Permissions'
          : `Slack auth.test failed: ${data.error}`,
    };
  }
  return { valid: true, info: { user: data.user, team: data.team } };
};

const validateLark: PlatformValidator = async (token) => {
  try {
    const parsed = parseLarkTokenConfig(token);
    return {
      valid: true,
      info: {
        domain: parsed.domain,
        appId: parsed.appId,
        feishu: parsed.domain === 'feishu',
      },
    };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

const validateImessage: PlatformValidator = async (token) => {
  let parsed: { serverUrl?: string; password?: string };
  try {
    parsed = JSON.parse(token) as { serverUrl?: string; password?: string };
  } catch {
    return {
      valid: false,
      error:
        'iMessage token must be JSON: {"serverUrl": "http://…", "password": "…"}',
    };
  }
  if (!parsed.serverUrl || !parsed.password) {
    return {
      valid: false,
      error: 'iMessage requires both serverUrl and password',
    };
  }
  const probe = await probeBlueBubbles({
    serverUrl: parsed.serverUrl,
    password: parsed.password,
  });
  if (!probe.ok) return { valid: false, error: probe.error };
  return { valid: true, info: { server: probe.host } };
};

const validateWhatsapp: PlatformValidator = async () => ({
  valid: true,
  info: {
    warning:
      'WhatsApp is configured through the gateway WhatsApp Cloud adapter. Use Gateway adapters for phoneNumberId, accessToken, webhookVerifyToken, and appSecret.',
  },
});

const PLATFORM_VALIDATORS: Record<string, PlatformValidator> = {
  telegram: validateTelegram,
  discord: validateDiscord,
  slack: validateSlack,
  lark: validateLark,
  imessage: validateImessage,
  whatsapp: validateWhatsapp,
};

/** Platform-specific token validation. Shared between configId and legacy routes. */
async function validateTokenForPlatform(
  platform: string,
  tokenToTest: string,
): Promise<ValidationResult> {
  const validator = PLATFORM_VALIDATORS[platform];
  if (!validator) return { valid: true };
  return validator(tokenToTest);
}

/** Translate token validation errors into actionable messages. */
function formatValidationError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (raw.includes('4014') || raw.toLowerCase().includes('disallowed intent'))
    return 'Disallowed intent: enable "Message Content Intent" in Discord Developer Portal → Bot → Privileged Gateway Intents';
  if (raw.includes('401') || raw.toLowerCase().includes('invalid token'))
    return 'Invalid token — double-check the bot token in the Developer Portal';
  return raw;
}

/** Resolve a token for validation: merge incoming override with vault, or fall back to vault. */
async function resolveValidationToken(
  configId: string,
  req: Request,
): Promise<string | null> {
  try {
    const rawBody = await req.json();
    const bodyResult = validateTokenSchema.safeParse(rawBody);
    if (
      bodyResult.success &&
      bodyResult.data.token &&
      !bodyResult.data.token.startsWith('...')
    ) {
      try {
        return mergeTokenFields(
          bodyResult.data.token,
          getChannelToken(configId),
        );
      } catch {
        return bodyResult.data.token;
      }
    }
  } catch {
    /* no body */
  }
  return getChannelToken(configId);
}

export const channelRoutes = new Hono();

channelRoutes.get('/fallback-diagnostics', (c) => {
  return c.json({ diagnostics: channelFallbackService.listDiagnostics() });
});

// ══════════════════════════════════════════════════════════════════════════════
// ── New configId-based endpoints (multi-bot) ─────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

channelRoutes.get('/configs', (c) => {
  const configs = getAllChannelConfigs().map((cfg) => ({
    ...cfg,
    token: getMaskedToken(cfg.id),
    configured: hasChannelCredential(cfg.id),
  }));
  return c.json({ configs });
});

channelRoutes.post(
  '/configs',
  zValidator('json', createChannelConfigSchema),
  async (c) => {
    try {
      const body = c.req.valid('json');
      const configId = crypto.randomUUID();
      const tokenForDb = body.token
        ? await mergeAndSaveCredential(configId, body.token)
        : undefined;

      const cfg = upsertChannelConfig({
        id: configId,
        platform: body.platform,
        name: body.name,
        token: tokenForDb,
      });

      // Register and optionally start the new plugin
      await getChannelManager().addConfig(
        configId,
        body.platform as ChannelPlatform,
      );

      return c.json(
        {
          ...cfg,
          token: getMaskedToken(configId),
          configured: hasChannelCredential(configId),
        },
        201 as ContentfulStatusCode,
      );
    } catch (err) {
      logger.error('Failed to create channel config:', err);
      return c.json(
        { error: 'Failed to create config' },
        500 as ContentfulStatusCode,
      );
    }
  },
);

channelRoutes.get('/configs/:configId', (c) => {
  const configId = c.req.param('configId');
  const cfg = getChannelConfigById(configId);
  if (!cfg)
    return c.json({ error: 'Config not found' }, 404 as ContentfulStatusCode);
  return c.json({
    ...cfg,
    token: getMaskedToken(configId),
    configured: hasChannelCredential(configId),
  });
});

channelRoutes.put(
  '/configs/:configId',
  zValidator('json', putChannelConfigSchema),
  async (c) => {
    try {
      const configId = c.req.param('configId');
      const existing = getChannelConfigById(configId);
      if (!existing)
        return c.json(
          { error: 'Config not found' },
          404 as ContentfulStatusCode,
        );
      const body = c.req.valid('json');

      const tokenForDb = await mergeAndSaveCredential(configId, body.token);

      const cfg = upsertChannelConfig({
        id: configId,
        platform: existing.platform,
        name:
          body.name !== undefined
            ? (body.name ?? undefined)
            : (existing.name ?? undefined),
        token: tokenForDb,
        mode: body.mode ?? existing.mode,
        rate_limit: body.rate_limit ?? existing.rate_limit,
        enabled: body.enabled ?? existing.enabled,
        guardrails_provider:
          body.guardrails_provider ?? existing.guardrails_provider,
        guardrails_fail_mode:
          body.guardrails_fail_mode ?? existing.guardrails_fail_mode,
        model: body.model !== undefined ? body.model : existing.model,
        mention_only: body.mention_only ?? existing.mention_only,
        agent_profile_id:
          body.agent_profile_id !== undefined
            ? body.agent_profile_id
            : existing.agent_profile_id,
        access_mode: body.access_mode ?? existing.access_mode,
        cred_connectors_allowlist:
          body.cred_connectors_allowlist !== undefined
            ? body.cred_connectors_allowlist
            : existing.cred_connectors_allowlist,
        user_mcp_policy: body.user_mcp_policy ?? existing.user_mcp_policy,
      });

      const mgr = getChannelManager();
      mgr.refreshConfig(configId, cfg);

      let restarted = false;
      let restartError: string | null = null;
      if (body.token && isRealToken(body.token)) {
        const plugin = mgr.getPlugin(configId);
        if (plugin && plugin.state === 'running') {
          const freshToken = getChannelToken(configId);
          if (freshToken) {
            try {
              await plugin.stop();
              await plugin.start(buildPluginConfig(cfg, configId, freshToken));
              restarted = true;
            } catch (restartErr) {
              restartError = (
                restartErr instanceof Error
                  ? restartErr.message
                  : String(restartErr)
              )
                .replace(/xox[a-zA-Z]-[^\s'"]+/g, '[REDACTED]')
                .slice(0, 200);
            }
          }
        }
      }

      await getAuditLog().write('config_updated', null, existing.platform, {
        configId,
        fields: Object.keys(body),
      });
      return c.json({
        ...cfg,
        token: getMaskedToken(configId),
        configured: hasChannelCredential(configId),
        restarted,
        ...(restartError ? { restartError } : {}),
      });
    } catch (err) {
      logger.error('Failed to update channel config:', err);
      return c.json(
        { error: 'Failed to update config' },
        500 as ContentfulStatusCode,
      );
    }
  },
);

channelRoutes.delete('/configs/:configId', async (c) => {
  try {
    const configId = c.req.param('configId');
    const existing = getChannelConfigById(configId);
    if (!existing)
      return c.json({ error: 'Config not found' }, 404 as ContentfulStatusCode);

    await getChannelManager().removeConfig(configId);
    await removeChannelCredential(configId);
    deleteChannelConfig(configId);

    await getAuditLog().write('config_deleted', null, existing.platform, {
      configId,
    });
    return c.json({ success: true });
  } catch (err) {
    logger.error('Failed to delete channel config:', err);
    return c.json(
      { error: 'Failed to delete config' },
      500 as ContentfulStatusCode,
    );
  }
});

channelRoutes.post('/configs/:configId/start', async (c) => {
  try {
    const configId = c.req.param('configId');
    const plugin = getChannelManager().getPlugin(configId);
    if (!plugin)
      return c.json({ error: 'Plugin not found' }, 404 as ContentfulStatusCode);
    const cfg = getChannelConfigById(configId);
    const token = getChannelToken(configId);
    if (!token)
      return c.json(
        { error: 'No token configured' },
        400 as ContentfulStatusCode,
      );

    if (!cfg)
      return c.json({ error: 'Config not found' }, 404 as ContentfulStatusCode);
    const pluginConfig = buildPluginConfig(cfg, configId, token);
    getChannelManager().refreshConfig(configId, cfg);
    await plugin.start(pluginConfig);
    await getAuditLog().write('plugin_started', null, plugin.platform, {
      configId,
    });
    return c.json({ state: plugin.state });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Plugin start failed:', err);
    return c.json({ error: message }, 500 as ContentfulStatusCode);
  }
});

channelRoutes.post('/configs/:configId/stop', async (c) => {
  try {
    const configId = c.req.param('configId');
    const plugin = getChannelManager().getPlugin(configId);
    if (!plugin)
      return c.json({ error: 'Plugin not found' }, 404 as ContentfulStatusCode);
    await plugin.stop();
    await getAuditLog().write('plugin_stopped', null, plugin.platform, {
      configId,
    });
    return c.json({ state: plugin.state });
  } catch (err) {
    logger.error('Plugin stop failed:', err);
    return c.json({ error: 'Stop failed' }, 500 as ContentfulStatusCode);
  }
});

channelRoutes.post('/configs/:configId/validate', async (c) => {
  try {
    const configId = c.req.param('configId');
    const cfg = getChannelConfigById(configId);
    if (!cfg)
      return c.json({ error: 'Config not found' }, 404 as ContentfulStatusCode);
    const tokenToTest = await resolveValidationToken(configId, c.req.raw);
    if (!tokenToTest)
      return c.json(
        { valid: false, error: 'No token configured' },
        400 as ContentfulStatusCode,
      );
    const result = await validateTokenForPlatform(cfg.platform, tokenToTest);
    if (!result.valid) return c.json(result, 400 as ContentfulStatusCode);
    return c.json(result);
  } catch (err) {
    logger.warn('Token validation failed:', err);
    return c.json(
      { valid: false, error: formatValidationError(err) },
      400 as ContentfulStatusCode,
    );
  }
});

channelRoutes.get('/configs/:configId/users', (c) => {
  const configId = c.req.param('configId');
  const users = getChannelUsers(configId);
  return c.json({ users });
});

channelRoutes.post('/configs/:configId/pairing/generate', async (c) => {
  try {
    const configId = c.req.param('configId');
    const cfg = getChannelConfigById(configId);
    if (!cfg)
      return c.json({ error: 'Config not found' }, 404 as ContentfulStatusCode);
    const record = createPairingCode(configId, cfg.platform, 'pending');
    return c.json({ code: record.code, expiresAt: record.expires_at });
  } catch (err) {
    logger.error('Failed to generate pairing code:', err);
    return c.json(
      { error: 'Failed to generate code' },
      500 as ContentfulStatusCode,
    );
  }
});

channelRoutes.get('/configs/:configId/audit-log', (c) => {
  const configId = c.req.param('configId');
  const channelUserId = c.req.query('channelUserId');
  const limit = Math.min(parseInt(c.req.query('limit') ?? '200', 10), 500);
  const offset = parseInt(c.req.query('offset') ?? '0', 10);
  const excludeRaw = c.req.query('exclude');
  const excludeActions = excludeRaw
    ? excludeRaw.split(',').map((a) => a.trim())
    : [];
  const result = getChannelAuditLogs({
    configId,
    channelUserId,
    limit,
    offset,
  });
  const logs =
    excludeActions.length > 0
      ? {
          ...result,
          logs: result.logs.filter((l) => !excludeActions.includes(l.action)),
        }
      : result;
  return c.json(logs);
});

channelRoutes.get('/configs/:configId/sessions', (c) => {
  const configId = c.req.param('configId');
  const status = c.req.query('status');
  const sessions = getChannelSessions({ configId, status });
  return c.json({ sessions });
});

// ══════════════════════════════════════════════════════════════════════════════
// ── Legacy platform-based endpoints (deprecated — use /configs/:configId) ────
// ══════════════════════════════════════════════════════════════════════════════

// ── Config endpoints ──────────────────────────────────────────────────────────

channelRoutes.get('/config', (c) => {
  const configs = getAllChannelConfigs().map((cfg) => ({
    ...cfg,
    token: getMaskedToken(cfg.id),
    configured: hasChannelCredential(cfg.id),
  }));
  return c.json({ configs });
});

channelRoutes.get('/config/:platform', (c) => {
  const platformResult = channelPlatformSchema.safeParse(
    c.req.param('platform'),
  );
  if (!platformResult.success) {
    return c.json({ error: 'Invalid platform' }, 400 as ContentfulStatusCode);
  }
  const cfg = getChannelConfig(platformResult.data);
  if (!cfg)
    return c.json({
      platform: platformResult.data,
      enabled: false,
      configured: false,
    });
  return c.json({
    ...cfg,
    token: getMaskedToken(cfg.id),
    configured: hasChannelCredential(cfg.id),
  });
});

channelRoutes.put(
  '/config/:platform',
  zValidator('json', putChannelConfigSchema),
  async (c) => {
    try {
      const platformResult = channelPlatformSchema.safeParse(
        c.req.param('platform'),
      );
      if (!platformResult.success) {
        return c.json(
          { error: 'Invalid platform' },
          400 as ContentfulStatusCode,
        );
      }
      const platform = platformResult.data;
      const body = c.req.valid('json');
      const existing = getChannelConfig(platform);
      const configId = existing?.id ?? crypto.randomUUID();

      const tokenForDb = await mergeAndSaveCredential(configId, body.token);

      const cfg = upsertChannelConfig({
        id: configId,
        platform,
        name:
          body.name !== undefined
            ? (body.name ?? undefined)
            : (existing?.name ?? undefined),
        token: tokenForDb,
        mode: body.mode ?? existing?.mode ?? 'polling',
        rate_limit: body.rate_limit ?? existing?.rate_limit ?? 10,
        enabled: body.enabled ?? existing?.enabled ?? true,
        guardrails_provider:
          body.guardrails_provider ?? existing?.guardrails_provider ?? 'none',
        guardrails_fail_mode:
          body.guardrails_fail_mode ?? existing?.guardrails_fail_mode ?? 'open',
        model:
          body.model !== undefined ? body.model : (existing?.model ?? null),
        mention_only: body.mention_only ?? existing?.mention_only ?? false,
        agent_profile_id:
          body.agent_profile_id !== undefined
            ? body.agent_profile_id
            : (existing?.agent_profile_id ?? null),
        access_mode: body.access_mode ?? existing?.access_mode ?? 'open',
        cred_connectors_allowlist:
          body.cred_connectors_allowlist !== undefined
            ? body.cred_connectors_allowlist
            : (existing?.cred_connectors_allowlist ?? null),
        user_mcp_policy:
          body.user_mcp_policy ?? existing?.user_mcp_policy ?? 'open',
      });
      const mgr = getChannelManager();
      mgr.refreshConfig(configId, cfg);

      let restarted = false;
      let restartError: string | null = null;
      if (body.token && isRealToken(body.token)) {
        const plugin = mgr.getPlugin(configId);
        if (plugin && plugin.state === 'running') {
          const freshToken = getChannelToken(configId);
          if (freshToken) {
            try {
              await plugin.stop();
              await plugin.start(buildPluginConfig(cfg, configId, freshToken));
              restarted = true;
            } catch (restartErr) {
              restartError = (
                restartErr instanceof Error
                  ? restartErr.message
                  : String(restartErr)
              )
                .replace(/xox[a-zA-Z]-[^\s'"]+/g, '[REDACTED]')
                .slice(0, 200);
            }
          }
        }
      }

      await getAuditLog().write('config_updated', null, platform, {
        configId,
        fields: Object.keys(body),
      });
      return c.json({
        ...cfg,
        token: getMaskedToken(configId),
        configured: hasChannelCredential(configId),
        restarted,
        ...(restartError ? { restartError } : {}),
      });
    } catch (err) {
      logger.error('Failed to update channel config:', err);
      return c.json(
        { error: 'Failed to update config' },
        500 as ContentfulStatusCode,
      );
    }
  },
);

channelRoutes.post('/config/:platform/validate', async (c) => {
  try {
    const platformResult = channelPlatformSchema.safeParse(
      c.req.param('platform'),
    );
    if (!platformResult.success)
      return c.json({ error: 'Invalid platform' }, 400 as ContentfulStatusCode);
    const existingCfg = getChannelConfig(platformResult.data);
    const configId = existingCfg?.id;
    const tokenToTest = configId
      ? await resolveValidationToken(configId, c.req.raw)
      : null;
    if (!tokenToTest)
      return c.json(
        { valid: false, error: 'No token configured' },
        400 as ContentfulStatusCode,
      );
    const result = await validateTokenForPlatform(
      platformResult.data,
      tokenToTest,
    );
    if (!result.valid) return c.json(result, 400 as ContentfulStatusCode);
    return c.json(result);
  } catch (err) {
    logger.warn('Token validation failed:', err);
    return c.json(
      { valid: false, error: formatValidationError(err) },
      400 as ContentfulStatusCode,
    );
  }
});

// ── User management endpoints ─────────────────────────────────────────────────

channelRoutes.get('/users/:platform', (c) => {
  const platformResult = channelPlatformSchema.safeParse(
    c.req.param('platform'),
  );
  if (!platformResult.success) {
    return c.json({ error: 'Invalid platform' }, 400 as ContentfulStatusCode);
  }
  // Legacy: look up configId from platform
  const cfg = getChannelConfig(platformResult.data);
  const users = cfg ? getChannelUsers(cfg.id) : [];
  return c.json({ users });
});

channelRoutes.delete('/users/:id', async (c) => {
  const id = c.req.param('id');
  const removed = removeChannelUser(id);
  if (removed) {
    await getAuditLog().write('user_removed', id, null, {});
  }
  return c.json({ success: removed });
});

channelRoutes.patch(
  '/users/:id/tier',
  zValidator('json', updateTierSchema),
  async (c) => {
    try {
      const id = c.req.param('id');
      const { tier } = c.req.valid('json');
      const user = updateChannelUserTier(id, tier);
      if (!user)
        return c.json({ error: 'User not found' }, 404 as ContentfulStatusCode);
      await getAuditLog().write('user_tier_changed', id, user.platform, {
        tier,
      });
      return c.json({ user });
    } catch (err) {
      logger.error('Failed to update user tier:', err);
      return c.json({ error: 'Update failed' }, 500 as ContentfulStatusCode);
    }
  },
);

channelRoutes.patch(
  '/users/:id/budget',
  zValidator('json', updateBudgetSchema),
  async (c) => {
    try {
      const id = c.req.param('id');
      const { tokenBudget } = c.req.valid('json');
      const user = updateChannelUserBudget(id, tokenBudget);
      if (!user)
        return c.json({ error: 'User not found' }, 404 as ContentfulStatusCode);
      await getAuditLog().write('config_updated', id, user.platform, {
        tokenBudget,
      });
      return c.json({ user });
    } catch (err) {
      logger.error('Failed to update user budget:', err);
      return c.json({ error: 'Update failed' }, 500 as ContentfulStatusCode);
    }
  },
);

// ── Pairing ───────────────────────────────────────────────────────────────────

const pairingGenerateSchema = z.object({
  platform: channelPlatformSchema,
});

channelRoutes.post(
  '/pairing/generate',
  zValidator('json', pairingGenerateSchema),
  async (c) => {
    try {
      const { platform } = c.req.valid('json');
      const cfg = getChannelConfig(platform);
      if (!cfg)
        return c.json(
          { error: 'No config for platform' },
          404 as ContentfulStatusCode,
        );
      const record = createPairingCode(cfg.id, platform, 'pending');
      return c.json({ code: record.code, expiresAt: record.expires_at });
    } catch (err) {
      logger.error('Failed to generate pairing code:', err);
      return c.json(
        { error: 'Failed to generate code' },
        500 as ContentfulStatusCode,
      );
    }
  },
);

channelRoutes.post(
  '/pairing/verify',
  zValidator('json', pairingVerifySchema),
  async (c) => {
    try {
      const { code, displayName } = c.req.valid('json');
      const result = verifyAndPair(code, displayName);
      if (result.success) {
        await getAuditLog().write(
          'user_paired',
          result.user?.id ?? null,
          result.user?.platform ?? null,
          {},
        );
      }
      return c.json(result);
    } catch (err) {
      logger.error('Pairing verify failed:', err);
      return c.json(
        { success: false, error: 'Verification failed' },
        500 as ContentfulStatusCode,
      );
    }
  },
);

// ── Plugin status + control ───────────────────────────────────────────────────

channelRoutes.get('/status', (c) => {
  const status = getChannelManager().getStatus();
  return c.json({ status });
});

channelRoutes.post('/:platform/start', async (c) => {
  try {
    const platformResult = channelPlatformSchema.safeParse(
      c.req.param('platform'),
    );
    if (!platformResult.success) {
      return c.json({ error: 'Invalid platform' }, 400 as ContentfulStatusCode);
    }
    const cfg = getChannelConfig(platformResult.data);
    if (!cfg)
      return c.json(
        { error: 'No config for platform' },
        404 as ContentfulStatusCode,
      );
    const configId = cfg.id;
    const plugin = getChannelManager().getPlugin(configId);
    if (!plugin)
      return c.json({ error: 'Plugin not found' }, 404 as ContentfulStatusCode);
    const token = getChannelToken(configId);
    if (!token)
      return c.json(
        { error: 'No token configured' },
        400 as ContentfulStatusCode,
      );
    const pluginConfig = buildPluginConfig(cfg, configId, token);
    getChannelManager().refreshConfig(configId, cfg);
    await plugin.start(pluginConfig);
    await getAuditLog().write('plugin_started', null, cfg.platform, {
      configId,
    });
    return c.json({ state: plugin.state });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Plugin start failed:', err);
    return c.json({ error: message }, 500 as ContentfulStatusCode);
  }
});

channelRoutes.post('/:platform/stop', async (c) => {
  try {
    const platformResult = channelPlatformSchema.safeParse(
      c.req.param('platform'),
    );
    if (!platformResult.success) {
      return c.json({ error: 'Invalid platform' }, 400 as ContentfulStatusCode);
    }
    const cfg = getChannelConfig(platformResult.data);
    if (!cfg)
      return c.json(
        { error: 'No config for platform' },
        404 as ContentfulStatusCode,
      );
    const plugin = getChannelManager().getPlugin(cfg.id);
    if (!plugin)
      return c.json({ error: 'Plugin not found' }, 404 as ContentfulStatusCode);
    await plugin.stop();
    await getAuditLog().write('plugin_stopped', null, cfg.platform, {
      configId: cfg.id,
    });
    return c.json({ state: plugin.state });
  } catch (err) {
    logger.error('Plugin stop failed:', err);
    return c.json({ error: 'Stop failed' }, 500 as ContentfulStatusCode);
  }
});

// ── Audit log ─────────────────────────────────────────────────────────────────

channelRoutes.get('/audit-log', (c) => {
  const platform = c.req.query('platform');
  const channelUserId = c.req.query('channelUserId');
  const limit = Math.min(parseInt(c.req.query('limit') ?? '200', 10), 500);
  const offset = parseInt(c.req.query('offset') ?? '0', 10);
  const excludeRaw = c.req.query('exclude'); // comma-separated actions to exclude
  const excludeActions = excludeRaw
    ? excludeRaw.split(',').map((a) => a.trim())
    : [];
  const result = getChannelAuditLogs({
    platform,
    channelUserId,
    limit,
    offset,
  });
  const logs =
    excludeActions.length > 0
      ? {
          ...result,
          logs: result.logs.filter((l) => !excludeActions.includes(l.action)),
        }
      : result;
  return c.json(logs);
});

// ── Sessions ──────────────────────────────────────────────────────────────────

channelRoutes.get('/sessions', (c) => {
  const platform = c.req.query('platform');
  const status = c.req.query('status');
  const sessions = getChannelSessions({ platform, status });
  return c.json({ sessions });
});

channelRoutes.get('/sessions/:id/messages', (c) => {
  const id = c.req.param('id');
  const messages = getChannelSessionMessages(id, 50);
  return c.json({ messages });
});

// ══════════════════════════════════════════════════════════════════════════════
// ── Routing rules CRUD ───────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

const intentSchema = z.enum([
  'code',
  'research',
  'planning',
  'triage',
  'support',
  '*',
]);

const routingRuleCreateSchema = z.object({
  workspace_id: z.string().min(1).max(100).default('*'),
  channel_id: z.string().min(1).max(50).default('*'),
  chat_pattern: z.string().min(1).max(500).default('*'),
  intent: intentSchema.default('*'),
  profile_id: z.string().min(1).max(100),
  model_override: z.string().max(200).nullable().optional(),
  priority: z.number().int().min(0).max(10000).default(100),
  enabled: z.union([z.literal(0), z.literal(1)]).default(1),
});

const routingRulePatchSchema = routingRuleCreateSchema.partial();

channelRoutes.get('/routing-rules', (c) => {
  return c.json({ rules: getAllRoutingRules() });
});

channelRoutes.post(
  '/routing-rules',
  zValidator('json', routingRuleCreateSchema),
  (c) => {
    try {
      const body = c.req.valid('json');
      const rule = createRoutingRule(crypto.randomUUID(), body);
      return c.json({ rule }, 201 as ContentfulStatusCode);
    } catch (err) {
      logger.error('Failed to create routing rule:', err);
      return c.json(
        { error: 'Failed to create routing rule' },
        500 as ContentfulStatusCode,
      );
    }
  },
);

channelRoutes.patch(
  '/routing-rules/:id',
  zValidator('json', routingRulePatchSchema),
  (c) => {
    const id = c.req.param('id');
    if (!getRoutingRule(id)) {
      return c.json(
        { error: 'Routing rule not found' },
        404 as ContentfulStatusCode,
      );
    }
    const updated = updateRoutingRule(id, c.req.valid('json'));
    return c.json({ rule: updated });
  },
);

// ══════════════════════════════════════════════════════════════════════════════
// ── Gateway adapter admin (registry-backed) ───────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

channelRoutes.get('/', (c) => {
  const ids = getRegisteredChannelIds();
  const rows = new Map(getAllChannels().map((row) => [row.id, row]));
  const channels = ids.map((id) => {
    const row = rows.get(id);
    const capabilities = getRegisteredChannelMetadata(id)?.capabilities;
    return {
      id,
      enabled: row?.enabled === 1,
      health: row?.status ?? 'disabled',
      lastError: row?.last_error ?? null,
      lastConnectedAt: row?.last_connected_at ?? null,
      capabilities,
      runtimeClass: capabilities?.runtimeClass,
    };
  });
  return c.json({ channels });
});

function ensureRegistered(id: string): boolean {
  return getRegisteredChannelIds().includes(id);
}

channelRoutes.post('/:id/enable', (c) => {
  const id = c.req.param('id');
  if (!ensureRegistered(id)) {
    return c.json({ error: 'Unknown channel' }, 404 as ContentfulStatusCode);
  }
  const existing = getGatewayChannelConfig(id);
  upsertChannel(id, existing?.config ?? '{}', 1);
  return c.json({ id, enabled: true });
});

channelRoutes.post('/:id/disable', (c) => {
  const id = c.req.param('id');
  if (!ensureRegistered(id)) {
    return c.json({ error: 'Unknown channel' }, 404 as ContentfulStatusCode);
  }
  const existing = getGatewayChannelConfig(id);
  upsertChannel(id, existing?.config ?? '{}', 0);
  updateChannelStatus(id, 'disabled');
  return c.json({ id, enabled: false });
});

channelRoutes.post('/:id/reconnect', (c) => {
  const id = c.req.param('id');
  if (!ensureRegistered(id)) {
    return c.json({ error: 'Unknown channel' }, 404 as ContentfulStatusCode);
  }
  // Mark disconnected so the gateway supervisor's next health sweep restarts
  // the adapter. The actual disconnect/connect cycle is owned by the gateway
  // service, not the HTTP layer, so we only signal intent here.
  updateChannelStatus(id, 'disconnected');
  return c.json({ id, status: 'reconnect_requested' });
});

channelRoutes.post('/imessage/webhook', async (c) => {
  if (process.platform !== 'darwin') {
    return c.json({ error: 'host_unsupported' }, 403 as ContentfulStatusCode);
  }

  const adapter = getGateway().getAdapter('imessage') as
    | {
        handleWebhookEvent?: (
          eventType: string,
          payload: unknown,
        ) => Promise<void>;
        webhookSecret?: () => string;
      }
    | undefined;
  if (!adapter?.handleWebhookEvent) {
    return c.json(
      { error: 'imessage_adapter_not_running' },
      503 as ContentfulStatusCode,
    );
  }

  const body = await c.req.text();
  const channelConfig = getGatewayChannelConfig('imessage');
  const parsedConfig = safeJson(channelConfig?.config);
  const secret =
    adapter.webhookSecret?.() ??
    stringValue(parsedConfig, 'webhookSecret') ??
    stringValue(parsedConfig, 'password') ??
    '';
  const signature =
    c.req.header('x-neuma-signature') ??
    c.req.header('x-bluebubbles-signature') ??
    c.req.header('x-hub-signature-256');
  if (secret && !verifyBlueBubblesWebhook({ body, secret, signature })) {
    return c.json({ error: 'invalid_signature' }, 401 as ContentfulStatusCode);
  }

  const payload = safeJson(body);
  const eventType =
    stringValue(payload, 'eventType') ??
    stringValue(payload, 'type') ??
    stringValue(payload, 'event') ??
    'new-message';
  const data =
    recordValue(payload, 'data') ?? recordValue(payload, 'payload') ?? payload;
  await adapter.handleWebhookEvent(eventType, data);
  return c.json({ ok: true });
});

channelRoutes.get('/whatsapp/webhook', (c) => {
  const channelConfig = getGatewayChannelConfig('whatsapp');
  const parsedConfig = parseWhatsAppConfig(channelConfig?.config);
  if (!parsedConfig) {
    return c.text('Not configured', 404 as ContentfulStatusCode);
  }
  const challenge = verifyWhatsAppChallenge(
    new URL(c.req.url).searchParams,
    parsedConfig.webhookVerifyToken,
  );
  if (challenge === null) {
    return c.text('Forbidden', 403 as ContentfulStatusCode);
  }
  return c.text(challenge);
});

channelRoutes.post('/whatsapp/webhook', async (c) => {
  const channelConfig = getGatewayChannelConfig('whatsapp');
  const parsedConfig = parseWhatsAppConfig(channelConfig?.config);
  if (!parsedConfig) {
    return c.json(
      { error: 'whatsapp_not_configured' },
      404 as ContentfulStatusCode,
    );
  }

  const body = await c.req.text();
  if (
    !verifyWhatsAppSignature({
      body,
      appSecret: parsedConfig.appSecret,
      signature: c.req.header('x-hub-signature-256'),
    })
  ) {
    return c.json({ error: 'invalid_signature' }, 401 as ContentfulStatusCode);
  }

  const adapter = getGateway().getAdapter('whatsapp') as
    | { handleWebhookEvent?: (payload: unknown) => Promise<void> }
    | undefined;
  if (!adapter?.handleWebhookEvent) {
    return c.json(
      { error: 'whatsapp_adapter_not_running' },
      503 as ContentfulStatusCode,
    );
  }
  await adapter.handleWebhookEvent(safeJson(body));
  return c.json({ ok: true });
});

channelRoutes.delete('/routing-rules/:id', (c) => {
  const id = c.req.param('id');
  const removed = deleteRoutingRule(id);
  if (!removed) {
    return c.json(
      { error: 'Routing rule not found' },
      404 as ContentfulStatusCode,
    );
  }
  return c.json({ success: true });
});

function safeJson(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' &&
      parsed !== null &&
      !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function stringValue(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

function recordValue(
  record: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const value = record[key];
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function parseWhatsAppConfig(raw: string | null | undefined) {
  try {
    return parseWhatsAppCloudConfig(safeJson(raw));
  } catch {
    return null;
  }
}
