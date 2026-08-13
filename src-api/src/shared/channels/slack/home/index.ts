/**
 * App Home — publish + interaction wiring.
 *
 * Phase-1/2 deliverables (per dev-doc/plan/2026-04-27-slack-app-home.md):
 *   • Render unpaired and paired Home views.
 *   • Pairing via Slack modal that reuses the existing `verifyAndPairFromBot`
 *     flow.
 *   • Routing-mode radio (auto / chat / task) writes to slack_user_links.
 *   • Disconnect button crypto-shreds the user's link + dependent secrets.
 *
 * Out of scope here (Phases 3-5):
 *   • Hosted OAuth callback for the "Connect with Neumar" button (today
 *     just opens the pairing modal — see `onConnectHostedFallback`).
 *   • Provider OAuth Connect buttons.
 *   • MCP add/edit/disable modals.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { App } from '@slack/bolt';
import type { WebClient } from '@slack/web-api';

import { verifyAndPairFromBot } from '@/shared/channels/pairing-service';
import { probeHttpMcp } from '@/shared/channels/slack/mcp/probe';
import {
  approveChannelUser,
  getChannelConfigById,
} from '@/shared/db/operations';
import {
  type McpTransport,
  type RoutingMode,
  createSlackUserLink,
  deleteSlackUserCredential,
  deleteSlackUserLink,
  deleteSlackUserMcp,
  getSlackUserLink,
  insertSlackUserMcp,
  listSlackUserMcp,
  setRoutingMode,
  setSlackUserMcpEnabled,
  touchSlackUserLink,
  unwrapDekFor,
  upsertSlackUserCredential,
} from '@/shared/db/operations-slack-home';
import { createLogger } from '@/shared/utils/logger';

import { getCredentialConnector } from './credentials';
import { getMcpPreset } from './mcp-presets';
import {
  CRED_ACTION_IDS,
  CRED_BLOCK_IDS,
  MCP_ACTION_IDS,
  MCP_BLOCK_IDS,
  MCP_PRESET_ACTION_IDS,
  MCP_PRESET_BLOCK_IDS,
  PAIRING_INPUT_ACTION_ID,
  PAIRING_INPUT_BLOCK_ID,
  buildCredentialAddModal,
  buildMcpAddModal,
  buildMcpPresetModal,
  buildPairingCodeModal,
  parseHeaderLines,
} from './modals';
import { loadHomeState } from './state';
import { HOME_ACTION_IDS, HOME_CALLBACK_IDS, buildHomeView } from './view';

const logger = createLogger('SlackHome');

/**
 * better-sqlite3 surfaces a UNIQUE-constraint failure as an Error with
 * `code === 'SQLITE_CONSTRAINT_UNIQUE'`. Used by the MCP add handlers
 * so a race between pre-check and insert (double-submit on mobile)
 * surfaces the proper "already exists" message instead of a generic
 * "could not save" error.
 */
function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  // Only the specific extended code — the parent `SQLITE_CONSTRAINT` covers
  // FK / NOT NULL / CHECK violations too, which we must NOT mask as
  // "already exists".
  return code === 'SQLITE_CONSTRAINT_UNIQUE';
}

// ESM-safe `__dirname` polyfill — the project is `"type": "module"` and
// the bare identifier throws at runtime. Mirrors `shared/plugins/scaffold.ts`.
// pkg-bundled builds keep the file URL via createRequire semantics; tsx and
// pnpm dev:api both resolve `import.meta.url` directly.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let cachedAppVersion: string | null = null;
function getAppVersion(): string {
  if (cachedAppVersion) return cachedAppVersion;
  for (const candidate of [
    resolve(__dirname, '../../../../../package.json'),
    resolve(__dirname, '../../../../package.json'),
    resolve(__dirname, '../../../package.json'),
  ]) {
    try {
      const pkg = JSON.parse(readFileSync(candidate, 'utf-8')) as {
        version?: string;
      };
      if (pkg.version) return (cachedAppVersion = pkg.version);
    } catch {
      // try next
    }
  }
  return (cachedAppVersion = '0.0.0');
}

/**
 * Deps wired in by the SlackPlugin owner — pulled out of Bolt's per-event
 * `client` rather than the App's global client so multi-workspace installs
 * route correctly when they land later.
 */
export interface PublishContext {
  client: Pick<WebClient, 'views'>;
}

/**
 * In `open` access mode the bot auto-approves any user on first message.
 * Apply the same semantic to the App Home: opening the bot is explicit
 * intent to use it, so create the slack_user_link inline rather than
 * forcing the pair-or-paste card.
 *
 * No-op when:
 *   • the user is already linked, or
 *   • the bot is in `gated` mode (admin wants explicit approval).
 */
function maybeAutoLink(args: {
  slackTeamId: string;
  slackUserId: string;
  configId: string;
}): void {
  if (getSlackUserLink(args.slackTeamId, args.slackUserId)) return;
  const botCfg = getChannelConfigById(args.configId);
  if (botCfg?.access_mode !== 'open') return;
  try {
    const channelUser = approveChannelUser(
      args.configId,
      'slack',
      args.slackUserId,
    );
    createSlackUserLink({
      slackTeamId: args.slackTeamId,
      slackUserId: args.slackUserId,
      configId: args.configId,
      channelUserId: channelUser.id,
    });
    logger.info(
      `auto-link: paired ${args.slackUserId} on team ${args.slackTeamId} (open mode)`,
    );
  } catch (err) {
    logger.warn('auto-link failed', { err });
  }
}

export async function publishHomeView(
  ctx: PublishContext,
  args: { slackTeamId: string; slackUserId: string; configId: string },
): Promise<void> {
  maybeAutoLink(args);
  const state = loadHomeState({
    slackTeamId: args.slackTeamId,
    slackUserId: args.slackUserId,
    configId: args.configId,
    appVersion: getAppVersion(),
  });
  const view = buildHomeView(state);
  logger.info(
    `views.publish: user=${args.slackUserId} team=${args.slackTeamId} blocks=${view.blocks.length} paired=${state.link !== null}`,
  );

  try {
    await ctx.client.views.publish({
      user_id: args.slackUserId,
      view,
    });
    // `@slack/web-api` throws on `ok: false`, so reaching here means success.
    if (state.link) touchSlackUserLink(args.slackTeamId, args.slackUserId);
    logger.info(`views.publish ok: user=${args.slackUserId}`);
  } catch (err) {
    const data = (
      err as {
        data?: { error?: string; response_metadata?: { messages?: string[] } };
      }
    )?.data;
    const code = data?.error ?? 'unknown';
    const messages = data?.response_metadata?.messages?.join('; ') ?? '';
    if (code === 'not_enabled') {
      logger.warn(
        'views.publish failed: enable the Home Tab toggle in the Slack app config (Features → App Home), then reinstall the app.',
      );
      return;
    }
    if (code === 'hash_conflict') {
      // Single retry — Slack rejected because state changed under us.
      // Rebuild the view from fresh state so we don't overwrite whatever
      // the concurrent publish wrote (credential add, MCP toggle, etc.).
      try {
        const freshState = loadHomeState({
          slackTeamId: args.slackTeamId,
          slackUserId: args.slackUserId,
          configId: args.configId,
          appVersion: getAppVersion(),
        });
        await ctx.client.views.publish({
          user_id: args.slackUserId,
          view: buildHomeView(freshState),
        });
        return;
      } catch (retryErr) {
        const retryCode =
          (retryErr as { data?: { error?: string } })?.data?.error ?? 'unknown';
        logger.warn(`views.publish retry failed: code=${retryCode}`, {
          err: retryErr,
        });
        return;
      }
    }
    logger.warn(
      `views.publish failed: code=${code}${messages ? ` messages=${messages}` : ''}`,
      { err },
    );
  }
}

interface RegisterHomeArgs {
  app: App;
  configId: string;
  /** Display-name resolver — falls back to platform_user_id when missing. */
  resolveDisplayName?: (
    client: WebClient,
    slackUserId: string,
  ) => Promise<string | null>;
  /** Re-publish hook for owners who want to react to home state changes. */
  afterChange?: () => void;
}

/**
 * Register every block_action / view_submission listener the Home tab
 * needs. Caller is responsible for branching `app_home_opened` on
 * `tab === 'home'` and calling `publishHomeView` — that's done in
 * `slack/index.ts` so the existing Messages-tab welcome flow is preserved.
 */
export function registerHomeHandlers(args: RegisterHomeArgs): void {
  const { app, configId } = args;

  // ── Pairing-code modal flow ─────────────────────────────────────────
  app.action(HOME_ACTION_IDS.CONNECT_PAIRING, async ({ ack, body, client }) => {
    await ack();
    const triggerId = (body as { trigger_id?: string }).trigger_id;
    const teamId = (body as { team?: { id?: string } }).team?.id;
    const userId = (body as { user?: { id?: string } }).user?.id;
    if (!triggerId || !teamId || !userId) {
      logger.warn('CONNECT_PAIRING action missing identity fields');
      return;
    }
    try {
      await client.views.open({
        trigger_id: triggerId,
        view: buildPairingCodeModal({
          slackTeamId: teamId,
          slackUserId: userId,
        }),
      });
    } catch (err) {
      logger.warn('views.open for pairing modal failed', { err });
    }
  });

  // Hosted OAuth route is Phase-3 work. For now the primary "Connect with
  // Neumar" button opens the same modal as the secondary one — keeps the
  // unpaired surface useful instead of dead.
  app.action(HOME_ACTION_IDS.CONNECT_HOSTED, async ({ ack, body, client }) => {
    await ack();
    const triggerId = (body as { trigger_id?: string }).trigger_id;
    const teamId = (body as { team?: { id?: string } }).team?.id;
    const userId = (body as { user?: { id?: string } }).user?.id;
    if (!triggerId || !teamId || !userId) return;
    try {
      await client.views.open({
        trigger_id: triggerId,
        view: buildPairingCodeModal({
          slackTeamId: teamId,
          slackUserId: userId,
        }),
      });
    } catch (err) {
      logger.warn('views.open for hosted-fallback modal failed', { err });
    }
  });

  app.view(
    HOME_CALLBACK_IDS.PAIRING_MODAL,
    async ({ ack, body, view, client }) => {
      const code = (
        view.state.values[PAIRING_INPUT_BLOCK_ID]?.[PAIRING_INPUT_ACTION_ID]
          ?.value ?? ''
      ).trim();

      if (!code) {
        await ack({
          response_action: 'errors',
          errors: { [PAIRING_INPUT_BLOCK_ID]: 'Enter a pairing code.' },
        });
        return;
      }

      // Identity always comes from `body.user.id` / `body.team.id` — never
      // from `private_metadata` (which the user can't tamper with, but is
      // still untrusted by policy).
      const slackUserId = body.user?.id;
      const slackTeamId = body.team?.id ?? null;
      if (!slackUserId || !slackTeamId) {
        await ack({
          response_action: 'errors',
          errors: {
            [PAIRING_INPUT_BLOCK_ID]: 'Could not resolve your Slack identity.',
          },
        });
        return;
      }

      const displayName = args.resolveDisplayName
        ? await args
            .resolveDisplayName(client as WebClient, slackUserId)
            .catch(() => null)
        : null;

      const result = verifyAndPairFromBot(
        code,
        configId,
        'slack',
        slackUserId,
        displayName ?? slackUserId,
      );
      if (!result.success) {
        await ack({
          response_action: 'errors',
          errors: {
            [PAIRING_INPUT_BLOCK_ID]:
              'Invalid or expired pairing code. Generate a new one in Settings → Channels.',
          },
        });
        return;
      }

      createSlackUserLink({
        slackTeamId,
        slackUserId,
        configId,
        channelUserId: result.user?.id ?? null,
        displayName,
      });

      await ack();
      await publishHomeView(
        { client: client as WebClient },
        { slackTeamId, slackUserId, configId },
      );
      args.afterChange?.();
    },
  );

  // ── Routing mode ────────────────────────────────────────────────────
  app.action(HOME_ACTION_IDS.ROUTING_MODE, async ({ ack, body, action }) => {
    await ack();
    const teamId = (body as { team?: { id?: string } }).team?.id;
    const userId = (body as { user?: { id?: string } }).user?.id;
    if (!teamId || !userId) return;

    const value = (action as { selected_option?: { value?: string } })
      .selected_option?.value;
    if (value !== 'auto' && value !== 'chat' && value !== 'task') return;

    if (!getSlackUserLink(teamId, userId)) return;
    setRoutingMode(teamId, userId, value as RoutingMode);
    args.afterChange?.();
    // No re-publish needed — Slack already shows the new selection.
  });

  // ── Disconnect ──────────────────────────────────────────────────────
  app.action(HOME_ACTION_IDS.DISCONNECT, async ({ ack, body, client }) => {
    await ack();
    const teamId = (body as { team?: { id?: string } }).team?.id;
    const userId = (body as { user?: { id?: string } }).user?.id;
    if (!teamId || !userId) return;
    deleteSlackUserLink(teamId, userId);
    args.afterChange?.();
    await publishHomeView(
      { client: client as WebClient },
      { slackTeamId: teamId, slackUserId: userId, configId },
    );
  });

  // ── Credentials: Add / Replace modal ────────────────────────────────
  const openCredModal = async (
    body: unknown,
    client: WebClient,
    preselectProvider?: string,
  ) => {
    const triggerId = (body as { trigger_id?: string }).trigger_id;
    const teamId = (body as { team?: { id?: string } }).team?.id;
    const userId = (body as { user?: { id?: string } }).user?.id;
    if (!triggerId || !teamId || !userId) return;
    if (!getSlackUserLink(teamId, userId)) {
      logger.warn('credential modal opened by unpaired user', {
        teamId,
        userId,
      });
      return;
    }
    try {
      await client.views.open({
        trigger_id: triggerId,
        view: buildCredentialAddModal({
          slackTeamId: teamId,
          slackUserId: userId,
          preselectProvider,
        }),
      });
    } catch (err) {
      logger.warn('views.open for credential modal failed', { err });
    }
  };

  app.action(HOME_ACTION_IDS.CRED_ADD, async ({ ack, body, client }) => {
    await ack();
    await openCredModal(body, client as WebClient);
  });

  app.action(/^home:cred_replace:/, async ({ ack, body, action, client }) => {
    await ack();
    const provider = (action as { action_id?: string }).action_id?.slice(
      HOME_ACTION_IDS.CRED_REPLACE_PREFIX.length,
    );
    await openCredModal(body, client as WebClient, provider);
  });

  app.view(
    HOME_CALLBACK_IDS.CRED_ADD_MODAL,
    async ({ ack, body, view, client }) => {
      const slackUserId = body.user?.id;
      const slackTeamId = body.team?.id ?? null;
      if (!slackUserId || !slackTeamId) {
        await ack({
          response_action: 'errors',
          errors: {
            [CRED_BLOCK_IDS.PROVIDER]: 'Could not resolve your Slack identity.',
          },
        });
        return;
      }
      const values = view.state.values;
      const providerKey =
        values[CRED_BLOCK_IDS.PROVIDER]?.[CRED_ACTION_IDS.PROVIDER]
          ?.selected_option?.value;
      const tokenRaw =
        values[CRED_BLOCK_IDS.TOKEN]?.[CRED_ACTION_IDS.TOKEN]?.value ?? '';
      const label = (
        values[CRED_BLOCK_IDS.LABEL]?.[CRED_ACTION_IDS.LABEL]?.value ?? ''
      ).trim();

      const errors: Record<string, string> = {};
      const connector = providerKey
        ? getCredentialConnector(providerKey)
        : null;
      if (!connector) {
        errors[CRED_BLOCK_IDS.PROVIDER] = 'Pick a connector.';
      }
      const token = tokenRaw.trim();
      if (token.length < 8) {
        errors[CRED_BLOCK_IDS.TOKEN] = 'Token looks too short.';
      } else if (connector?.validateToken) {
        const fail = connector.validateToken(token);
        if (fail) errors[CRED_BLOCK_IDS.TOKEN] = fail;
      }
      if (Object.keys(errors).length > 0) {
        await ack({ response_action: 'errors', errors });
        return;
      }

      const dek = unwrapDekFor(slackTeamId, slackUserId);
      if (!dek) {
        await ack({
          response_action: 'errors',
          errors: {
            [CRED_BLOCK_IDS.PROVIDER]:
              'Your Slack pairing seems broken. Reconnect from Home and try again.',
          },
        });
        return;
      }

      try {
        upsertSlackUserCredential({
          slackTeamId,
          slackUserId,
          provider: connector!.key,
          accountLabel: label || null,
          token,
          dek,
        });
      } catch (err) {
        logger.warn('upsertSlackUserCredential failed', { err });
        await ack({
          response_action: 'errors',
          errors: {
            [CRED_BLOCK_IDS.TOKEN]: 'Could not save the credential.',
          },
        });
        return;
      }

      await ack();
      args.afterChange?.();
      await publishHomeView(
        { client: client as WebClient },
        { slackTeamId, slackUserId, configId },
      );
    },
  );

  app.action(/^home:cred_remove:/, async ({ ack, body, action, client }) => {
    await ack();
    const teamId = (body as { team?: { id?: string } }).team?.id;
    const userId = (body as { user?: { id?: string } }).user?.id;
    const provider = (action as { action_id?: string }).action_id?.slice(
      HOME_ACTION_IDS.CRED_REMOVE_PREFIX.length,
    );
    if (!teamId || !userId || !provider) return;
    deleteSlackUserCredential(teamId, userId, provider);
    args.afterChange?.();
    await publishHomeView(
      { client: client as WebClient },
      { slackTeamId: teamId, slackUserId: userId, configId },
    );
  });

  // ── MCP: Quick-add catalog preset (one-click, token-only modal) ──────
  app.action(/^home:mcp_preset:/, async ({ ack, body, action, client }) => {
    await ack();
    const presetKey = (action as { action_id?: string }).action_id?.slice(
      HOME_ACTION_IDS.MCP_PRESET_PREFIX.length,
    );
    const preset = presetKey ? getMcpPreset(presetKey) : null;
    if (!preset) {
      logger.warn('MCP preset action with unknown key', { presetKey });
      return;
    }
    const triggerId = (body as { trigger_id?: string }).trigger_id;
    const teamId = (body as { team?: { id?: string } }).team?.id;
    const userId = (body as { user?: { id?: string } }).user?.id;
    if (!triggerId || !teamId || !userId) return;
    if (!getSlackUserLink(teamId, userId)) return;
    try {
      await (client as WebClient).views.open({
        trigger_id: triggerId,
        view: buildMcpPresetModal({
          slackTeamId: teamId,
          slackUserId: userId,
          preset,
        }),
      });
    } catch (err) {
      logger.warn('views.open for MCP preset modal failed', { err });
    }
  });

  // ── MCP: preset submission ─────────────────────────────────────────
  app.view(
    HOME_CALLBACK_IDS.MCP_PRESET_MODAL,
    async ({ ack, body, view, client }) => {
      const slackUserId = body.user?.id;
      const slackTeamId = body.team?.id ?? null;
      const meta = (() => {
        try {
          return JSON.parse(view.private_metadata) as { presetKey?: string };
        } catch {
          return {} as { presetKey?: string };
        }
      })();
      const preset = meta.presetKey ? getMcpPreset(meta.presetKey) : null;
      if (!slackUserId || !slackTeamId || !preset) {
        await ack({
          response_action: 'errors',
          errors: {
            [MCP_PRESET_BLOCK_IDS.TOKEN]: 'Could not resolve the connector.',
          },
        });
        return;
      }
      const token = (
        view.state.values[MCP_PRESET_BLOCK_IDS.TOKEN]?.[
          MCP_PRESET_ACTION_IDS.TOKEN
        ]?.value ?? ''
      ).trim();
      if (token.length < 8) {
        await ack({
          response_action: 'errors',
          errors: {
            [MCP_PRESET_BLOCK_IDS.TOKEN]: 'Token looks too short.',
          },
        });
        return;
      }
      // Don't allow duplicates by name (preset.key).
      const existing = listSlackUserMcp(slackTeamId, slackUserId);
      if (existing.some((s) => s.name === preset.key)) {
        await ack({
          response_action: 'errors',
          errors: {
            [MCP_PRESET_BLOCK_IDS.TOKEN]:
              'Already added — remove the existing entry first.',
          },
        });
        return;
      }
      const dek = unwrapDekFor(slackTeamId, slackUserId);
      if (!dek) {
        await ack({
          response_action: 'errors',
          errors: {
            [MCP_PRESET_BLOCK_IDS.TOKEN]:
              'Your Slack pairing seems broken. Reconnect from Home and try again.',
          },
        });
        return;
      }

      const botCfg = getChannelConfigById(configId);
      const policy = botCfg?.user_mcp_policy ?? 'open';
      const pendingAdminApproval = policy === 'admin-approved';

      let insertedId: string;
      try {
        insertedId = insertSlackUserMcp({
          slackTeamId,
          slackUserId,
          name: preset.key,
          transport: 'http',
          url: preset.url,
          env: { Authorization: `Bearer ${token}` },
          dek,
          enabled: false,
          pendingAdminApproval,
        });
      } catch (err) {
        // A concurrent submit (mobile double-tap) can pass the dup
        // pre-check then trip the UNIQUE constraint at insert time.
        // Surface the same "already added" message rather than the
        // generic save error.
        const isDup = isUniqueViolation(err);
        if (!isDup) logger.warn('insertSlackUserMcp (preset) failed', { err });
        await ack({
          response_action: 'errors',
          errors: {
            [MCP_PRESET_BLOCK_IDS.TOKEN]: isDup
              ? 'Already added — remove the existing entry first.'
              : 'Could not save — try again.',
          },
        });
        return;
      }

      await ack();
      args.afterChange?.();
      await publishHomeView(
        { client: client as WebClient },
        { slackTeamId, slackUserId, configId },
      );

      if (pendingAdminApproval) {
        try {
          await (client as WebClient).chat.postMessage({
            channel: slackUserId,
            text: `*${preset.displayName}* MCP is awaiting admin approval. You'll see it enabled on Home once it's reviewed.`,
          });
        } catch (err) {
          logger.warn('preset pending-admin DM failed', { err });
        }
        return;
      }

      // Probe in background — preset URL is known, so a probe failure is
      // almost always an auth problem (bad token).
      void (async () => {
        const probe = await probeHttpMcp({
          url: preset.url,
          headers: { Authorization: `Bearer ${token}` },
        });
        if (probe.ok) {
          setSlackUserMcpEnabled(insertedId, true);
          try {
            await (client as WebClient).chat.postMessage({
              channel: slackUserId,
              text: `*${preset.displayName}* connected${probe.toolCount !== null ? ` (${probe.toolCount} tools)` : ''}.`,
            });
          } catch (err) {
            logger.warn('preset probe success DM failed', { err });
          }
        } else {
          deleteSlackUserMcp(insertedId);
          try {
            await (client as WebClient).chat.postMessage({
              channel: slackUserId,
              text: `Could not connect *${preset.displayName}*: ${probe.reason}. Most likely the token is invalid or lacks the required scopes — mint a fresh one at <${preset.tokenUrl}|the provider settings> and try again.`,
            });
          } catch (err) {
            logger.warn('preset probe failure DM failed', { err });
          }
        }
        args.afterChange?.();
        await publishHomeView(
          { client: client as WebClient },
          { slackTeamId, slackUserId, configId },
        );
      })();
    },
  );

  // ── MCP: Add modal ──────────────────────────────────────────────────
  app.action(HOME_ACTION_IDS.MCP_ADD, async ({ ack, body, client }) => {
    await ack();
    const triggerId = (body as { trigger_id?: string }).trigger_id;
    const teamId = (body as { team?: { id?: string } }).team?.id;
    const userId = (body as { user?: { id?: string } }).user?.id;
    if (!triggerId || !teamId || !userId) return;
    if (!getSlackUserLink(teamId, userId)) {
      logger.warn('MCP_ADD pressed by unpaired user', { teamId, userId });
      return;
    }
    try {
      await client.views.open({
        trigger_id: triggerId,
        view: buildMcpAddModal({
          slackTeamId: teamId,
          slackUserId: userId,
        }),
      });
    } catch (err) {
      logger.warn('views.open for MCP add modal failed', { err });
    }
  });

  // ── MCP: Add submission ─────────────────────────────────────────────
  app.view(
    HOME_CALLBACK_IDS.MCP_ADD_MODAL,
    async ({ ack, body, view, client }) => {
      const slackUserId = body.user?.id;
      const slackTeamId = body.team?.id ?? null;
      if (!slackUserId || !slackTeamId) {
        await ack({
          response_action: 'errors',
          errors: {
            [MCP_BLOCK_IDS.NAME]: 'Could not resolve your Slack identity.',
          },
        });
        return;
      }
      const values = view.state.values;
      const name = (
        values[MCP_BLOCK_IDS.NAME]?.[MCP_ACTION_IDS.NAME]?.value ?? ''
      ).trim();
      const transport =
        (values[MCP_BLOCK_IDS.TRANSPORT]?.[MCP_ACTION_IDS.TRANSPORT]
          ?.selected_option?.value as McpTransport | undefined) ?? 'http';
      const url = (
        values[MCP_BLOCK_IDS.URL]?.[MCP_ACTION_IDS.URL]?.value ?? ''
      ).trim();
      const rawHeaders =
        values[MCP_BLOCK_IDS.HEADERS]?.[MCP_ACTION_IDS.HEADERS]?.value ?? '';

      const errors: Record<string, string> = {};
      if (!name) errors[MCP_BLOCK_IDS.NAME] = 'Required.';
      if (!url) errors[MCP_BLOCK_IDS.URL] = 'Required.';
      if (transport !== 'http' && transport !== 'sse') {
        errors[MCP_BLOCK_IDS.TRANSPORT] =
          'Only http and sse transports are supported here.';
      }
      const existing = listSlackUserMcp(slackTeamId, slackUserId);
      if (name && existing.some((s) => s.name === name)) {
        errors[MCP_BLOCK_IDS.NAME] =
          'You already have a server with that name.';
      }
      if (Object.keys(errors).length > 0) {
        await ack({ response_action: 'errors', errors });
        return;
      }

      const headers = parseHeaderLines(rawHeaders);

      const dek = unwrapDekFor(slackTeamId, slackUserId);
      if (!dek) {
        await ack({
          response_action: 'errors',
          errors: {
            [MCP_BLOCK_IDS.NAME]:
              'Your Slack pairing seems broken. Reconnect from Home and try again.',
          },
        });
        return;
      }

      // Honour the per-bot policy. `disabled` should never reach this
      // handler (the Add button isn't rendered), but defend anyway.
      const botCfg = getChannelConfigById(configId);
      const policy = botCfg?.user_mcp_policy ?? 'open';
      if (policy === 'disabled') {
        await ack({
          response_action: 'errors',
          errors: {
            [MCP_BLOCK_IDS.NAME]: 'MCP servers are disabled for this bot.',
          },
        });
        return;
      }
      const pendingAdminApproval = policy === 'admin-approved';

      // Insert the row in *disabled* state and ack immediately. Slack
      // expects `ack()` within 3 seconds; an MCP probe over the network
      // can blow that budget on a slow server, so we run the probe in
      // the background and update the row after.
      //
      // For `admin-approved` workflows we insert with `pending_admin_approval = 1`
      // and skip the probe — the admin runs the probe (manually or via a
      // future review UI) before flipping `enabled`.
      let insertedId: string;
      try {
        insertedId = insertSlackUserMcp({
          slackTeamId,
          slackUserId,
          name,
          transport,
          url,
          env: Object.keys(headers).length > 0 ? headers : null,
          dek,
          enabled: false,
          pendingAdminApproval,
        });
      } catch (err) {
        const isDup = isUniqueViolation(err);
        if (!isDup) logger.warn('insertSlackUserMcp failed', { err });
        await ack({
          response_action: 'errors',
          errors: {
            [MCP_BLOCK_IDS.NAME]: isDup
              ? 'You already have a server with that name.'
              : 'Could not save the server. Try a different name.',
          },
        });
        return;
      }

      await ack();
      args.afterChange?.();
      await publishHomeView(
        { client: client as WebClient },
        { slackTeamId, slackUserId, configId },
      );

      if (pendingAdminApproval) {
        try {
          await (client as WebClient).chat.postMessage({
            channel: slackUserId,
            text: `MCP server *${name}* is awaiting admin approval. You'll see it enabled on Home once it's reviewed.`,
          });
        } catch (err) {
          logger.warn('mcp pending-admin DM failed', { err });
        }
        return;
      }

      void (async () => {
        const probe = await probeHttpMcp({ url, headers });
        if (probe.ok) {
          setSlackUserMcpEnabled(insertedId, true);
          try {
            await (client as WebClient).chat.postMessage({
              channel: slackUserId,
              text: `MCP server *${name}* is connected and enabled${probe.toolCount !== null ? ` (${probe.toolCount} tools)` : ''}.`,
            });
          } catch (err) {
            logger.warn('mcp probe success DM failed', { err });
          }
        } else {
          deleteSlackUserMcp(insertedId);
          try {
            await (client as WebClient).chat.postMessage({
              channel: slackUserId,
              text: `Could not connect MCP server *${name}*: ${probe.reason}. The server was removed — re-add with the corrected URL or auth.`,
            });
          } catch (err) {
            logger.warn('mcp probe failure DM failed', { err });
          }
        }
        args.afterChange?.();
        await publishHomeView(
          { client: client as WebClient },
          { slackTeamId, slackUserId, configId },
        );
      })();
    },
  );

  // ── MCP: Toggle (enable/disable) ────────────────────────────────────
  app.action(/^home:mcp_toggle:/, async ({ ack, body, action, client }) => {
    await ack();
    const teamId = (body as { team?: { id?: string } }).team?.id;
    const userId = (body as { user?: { id?: string } }).user?.id;
    const id = (action as { action_id?: string }).action_id?.slice(
      HOME_ACTION_IDS.MCP_TOGGLE_PREFIX.length,
    );
    if (!teamId || !userId || !id) return;
    const owned = listSlackUserMcp(teamId, userId).find((m) => m.id === id);
    if (!owned) return;
    setSlackUserMcpEnabled(id, !owned.enabled);
    args.afterChange?.();
    await publishHomeView(
      { client: client as WebClient },
      { slackTeamId: teamId, slackUserId: userId, configId },
    );
  });

  // ── MCP: Remove ─────────────────────────────────────────────────────
  app.action(/^home:mcp_remove:/, async ({ ack, body, action, client }) => {
    await ack();
    const teamId = (body as { team?: { id?: string } }).team?.id;
    const userId = (body as { user?: { id?: string } }).user?.id;
    const id = (action as { action_id?: string }).action_id?.slice(
      HOME_ACTION_IDS.MCP_REMOVE_PREFIX.length,
    );
    if (!teamId || !userId || !id) return;
    // Authorise: only delete rows that belong to this user.
    const owned = listSlackUserMcp(teamId, userId).find((m) => m.id === id);
    if (!owned) return;
    deleteSlackUserMcp(id);
    args.afterChange?.();
    await publishHomeView(
      { client: client as WebClient },
      { slackTeamId: teamId, slackUserId: userId, configId },
    );
  });
}
