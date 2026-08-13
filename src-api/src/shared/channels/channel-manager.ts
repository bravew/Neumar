import crypto from 'node:crypto';
import {
  mkdir,
  readdir,
  readFile,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { RuntimeContext } from '@/core/agent/context-resolver';
import type { ConversationMessage, ImageAttachment } from '@/core/agent/types';

import { getChannelToken } from '@/shared/auth/credential-vault';
import { buildAgentChannelContext } from '@/shared/channels/agent-context';
import { connectorKeyToEnvVar } from '@/shared/channels/slack/home/credentials';
import { getDatabase } from '@/shared/db';
import {
  getApprovedChannelUser,
  getAgentProfile,
  getChannelConfigById,
  getChannelHistory,
  getChannelSession,
  getProfileSkillSlugs,
  getAllChannelConfigs,
  insertChannelMessage,
  recordTokenUsage,
  updateChannelSession,
  updateChannelUserDisplayName,
} from '@/shared/db/operations';
import { loadUserScopedCredentials } from '@/shared/db/operations-slack-home';
import type { ChannelConfig, ChannelUser } from '@/shared/db/types';
import { loadUserScopedMcpServers } from '@/shared/mcp/per-user-loader';
import {
  createSession as createAgentSession,
  deleteSession as deleteAgentSession,
  runAgent,
} from '@/shared/services/agent';
import { deleteMemoriesByScope } from '@/shared/services/memory/store';
import { withSessionContext } from '@/shared/services/session-context';
import { listCapabilities, transcribe } from '@/shared/services/speech';
import { validateImageResponse } from '@/shared/utils/image-validator';
import { createLogger } from '@/shared/utils/logger';
import { validateBaseUrl } from '@/shared/utils/url-validator';

import { getChannelFormatHint } from './_shared/format-hints';
import { NopLeaser, type Leaser, type LeaseHandle } from './_shared/lease';
import { getAuditLog } from './audit-log';
import type { BasePlugin } from './base-plugin';
import { ChannelMessageService } from './message-service';
import { OutboundPipeline } from './outbound-pipeline';
import { getPairingService } from './pairing-service';
import { createGuardrails } from './security/guardrails';
import { SecurityPipeline } from './security/pipeline';
import { RateLimiter } from './security/rate-limiter';
import { TokenBudget } from './security/token-budget';
import { getChannelSessionManager } from './session-manager';
import {
  humanizeToolName,
  loadingMessagesForTool,
} from './slack/progress-message';
import { buildResultBlocks, extractFinalResult } from './slack/result-blocks';
import { searchSlackUsers, formatUserResults } from './slack/search';
import { detectSentiment } from './slack/sentiment-reaction';
import {
  fetchSlackThreadHistory,
  parseSlackConversationId,
} from './slack/thread-history';
import type {
  BasePluginConfig,
  ChannelCapabilities,
  ChannelPlatform,
  ChannelRuntimeClass,
  NormalizedMessage,
} from './types';

// Lazy-loaded plugin constructors to avoid circular imports at module scope.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _pluginCtors: Record<string, new () => BasePlugin> | null = null;
async function getPluginCtors(): Promise<Record<string, new () => BasePlugin>> {
  if (!_pluginCtors) {
    const [tg, dc, sl, lk] = await Promise.all([
      import('./telegram/index'),
      import('./discord/index'),
      import('./slack/index'),
      import('./lark/index'),
    ]);
    _pluginCtors = {
      telegram: tg.TelegramPlugin as unknown as new () => BasePlugin,
      discord: dc.DiscordPlugin as unknown as new () => BasePlugin,
      slack: sl.SlackPlugin as unknown as new () => BasePlugin,
      lark: lk.LarkPlugin as unknown as new () => BasePlugin,
    };
  }
  return _pluginCtors;
}
import {
  buildQualifiedUserId,
  INBOUND_ATTACHMENTS_DIR,
  isInboundAttachmentPath,
  LEGACY_INBOUND_ATTACHMENTS_DIR,
  resolveChannelWorkDir,
} from './workspace';

const logger = createLogger('ChannelManager');

/** Cap file uploads at 50 MB */
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

function estimateTokens(text: string): number {
  // Rough estimate: ~4 chars per token
  return Math.ceil(text.length / 4);
}

/** Max image download size (10 MB) to prevent OOM on huge base64 payloads */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const DEFAULT_CHANNEL_LEASE_TTL_MS = 30_000;
const DEFAULT_CHANNEL_LEASE_RENEW_MS = 10_000;
const MAX_LEASE_RENEW_FAILURES = 3;

/** Allowed CDN hostnames for inbound attachment downloads (SSRF protection) */
const ALLOWED_ATTACHMENT_HOSTS = new Set([
  'cdn.discordapp.com',
  'media.discordapp.net',
  'api.telegram.org',
  'files.slack.com',
]);

/** Map an image MIME type to a file extension for disk staging. */
function mimeTypeToExtension(mimeType: string): string {
  const m = mimeType.toLowerCase();
  if (m.includes('jpeg') || m.includes('jpg')) return '.jpg';
  if (m.includes('webp')) return '.webp';
  if (m.includes('gif')) return '.gif';
  if (m.includes('bmp')) return '.bmp';
  return '.png';
}

/**
 * Download image URLs from channel CDNs and convert to base64 ImageAttachment[].
 * Respects SSRF allowlist and size limits; gracefully skips failures.
 * Pass authToken for platforms that require auth (e.g. Slack url_private_download).
 */
async function downloadImageAttachments(
  urls: string[],
  authToken?: string,
): Promise<ImageAttachment[]> {
  const images: ImageAttachment[] = [];

  for (const url of urls) {
    // Local file paths (e.g. Slack plugin pre-downloads to /tmp)
    if (url.startsWith('/')) {
      try {
        const fileStat = await stat(url);
        if (!fileStat.isFile() || fileStat.size > MAX_IMAGE_BYTES) continue;
        const buffer = await readFile(url);
        // Detect mime from extension
        const ext = path.extname(url).toLowerCase();
        const mimeMap: Record<string, string> = {
          '.png': 'image/png',
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.gif': 'image/gif',
          '.webp': 'image/webp',
          '.bmp': 'image/bmp',
          '.svg': 'image/svg+xml',
        };
        const mimeType = mimeMap[ext] ?? 'image/png';
        images.push({ data: buffer.toString('base64'), mimeType });
        logger.info(
          `Loaded local image attachment (${buffer.byteLength} bytes): ${path.basename(url)}`,
        );
      } catch {
        // File doesn't exist or not readable
      }
      continue;
    }

    // SSRF: only fetch from known CDN hosts
    let hostname: string;
    try {
      hostname = new URL(url).hostname;
    } catch {
      continue;
    }
    if (!ALLOWED_ATTACHMENT_HOSTS.has(hostname)) {
      logger.warn(
        `Skipping attachment download from untrusted host: ${hostname}`,
      );
      continue;
    }

    // Only download image URLs (by extension heuristic or known image paths)
    const hasImageExt = /\.(png|jpe?g|gif|webp|bmp|svg|avif|heic)(\?|$)/i.test(
      url,
    );
    // Telegram photo paths (e.g. /photos/file_123.jpg) may not always have a standard extension
    const isTelegramPhoto =
      hostname === 'api.telegram.org' && /\/photos\//.test(url);
    // Slack private file URLs don't have extensions in the URL path
    const isSlackFile = hostname === 'files.slack.com';
    if (!hasImageExt && !isTelegramPhoto && !isSlackFile) continue;

    try {
      const headers: Record<string, string> = {};
      if (isSlackFile) {
        if (authToken) {
          headers['Authorization'] = `Bearer ${authToken}`;
        } else {
          logger.warn('Slack file download: no auth token available');
        }
      }

      // Slack url_private_download redirects cross-origin; Node.js fetch strips
      // Authorization on cross-origin redirects. Handle manually: get redirect
      // URL with auth, then follow the pre-signed URL without auth.
      let res: Response;
      if (isSlackFile && authToken) {
        const initialRes = await fetch(url, {
          signal: AbortSignal.timeout(15_000),
          headers,
          redirect: 'manual',
        });
        if (initialRes.status >= 300 && initialRes.status < 400) {
          const redirectUrl = initialRes.headers.get('location');
          if (redirectUrl) {
            res = await fetch(redirectUrl, {
              signal: AbortSignal.timeout(15_000),
            });
          } else {
            res = initialRes;
          }
        } else {
          res = initialRes;
        }
      } else {
        res = await fetch(url, {
          signal: AbortSignal.timeout(15_000),
          headers,
        });
      }
      logger.debug(
        `Attachment fetch: ${hostname} → ${res.status} ${res.headers.get('content-type')}`,
      );
      if (!res.ok) {
        logger.warn(`Attachment download failed (${res.status}): ${hostname}`);
        continue;
      }

      // Verify content is actually an image — reject HTML login pages
      const contentType = res.headers.get('content-type')?.split(';')[0] ?? '';
      if (contentType.includes('text/html')) {
        logger.warn(
          `Attachment returned HTML instead of image (possible auth issue): ${hostname}`,
        );
        continue;
      }
      if (!contentType.startsWith('image/')) {
        // Reject non-image content — Slack files (voice clips, documents) report
        // video/* or audio/* MIME types and should not be treated as images.
        if (!hasImageExt) {
          logger.warn(
            `Skipping non-image content (${contentType}): ${hostname}`,
          );
          continue;
        }
      }

      const contentLength = Number(res.headers.get('content-length') ?? '0');
      if (contentLength > MAX_IMAGE_BYTES) {
        logger.warn(
          `Image too large (${contentLength} bytes), skipping: ${hostname}`,
        );
        continue;
      }

      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.byteLength > MAX_IMAGE_BYTES) {
        logger.warn(
          `Image body too large (${buffer.byteLength} bytes), skipping`,
        );
        continue;
      }

      const mimeType =
        res.headers.get('content-type')?.split(';')[0] ?? 'image/jpeg';

      images.push({
        data: buffer.toString('base64'),
        mimeType,
      });
      logger.info(
        `Downloaded inbound image (${buffer.byteLength} bytes) from ${hostname}`,
      );
    } catch (err) {
      logger.warn(
        `Failed to download image: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return images;
}

export class ChannelManager {
  private plugins = new Map<string, BasePlugin>();
  private configs = new Map<string, BasePluginConfig>();
  private securityPipeline: SecurityPipeline;
  private messageService: ChannelMessageService;
  private outboundPipeline: OutboundPipeline;
  private readonly leaser: Leaser;
  private readonly leaseTtlMs: number;
  private readonly leaseRenewMs: number;
  private leaseRecords = new Map<
    string,
    {
      handle: LeaseHandle;
      renewTimer: ReturnType<typeof setInterval>;
      failures: number;
    }
  >();

  /**
   * Tracks the currently running agent session per conversation.
   * Key: conversationId (e.g. "C1234:1234567890.123456")
   * Used for: cancel/stop commands, and queuing new messages while busy.
   */
  private activeRuns = new Map<
    string,
    { sessionId: string; abortController: AbortController }
  >();

  /**
   * Queued message per conversation — only the latest one is kept (newer replaces older).
   * Processed automatically after the current run completes.
   */
  private queuedMessages = new Map<string, NormalizedMessage>();

  constructor(
    options: {
      leaser?: Leaser;
      leaseTtlMs?: number;
      leaseRenewMs?: number;
    } = {},
  ) {
    const rateLimiter = new RateLimiter(20);
    const tokenBudget = new TokenBudget();
    const guardrails = createGuardrails('none', 'open');
    const auditLog = getAuditLog();
    this.securityPipeline = new SecurityPipeline(
      rateLimiter,
      tokenBudget,
      guardrails,
      auditLog,
    );
    this.messageService = new ChannelMessageService();
    this.outboundPipeline = new OutboundPipeline();
    this.leaser = options.leaser ?? new NopLeaser();
    this.leaseTtlMs = options.leaseTtlMs ?? DEFAULT_CHANNEL_LEASE_TTL_MS;
    this.leaseRenewMs = options.leaseRenewMs ?? DEFAULT_CHANNEL_LEASE_RENEW_MS;
  }

  registerPlugin(configId: string, plugin: BasePlugin): void {
    this.plugins.set(configId, plugin);
    plugin.registerMessageHandler((msg) => this.handleIncomingMessage(msg));
    logger.info(
      `Registered channel plugin: ${plugin.platform}:${configId.slice(0, 8)}`,
    );
  }

  private async acquirePluginLease(
    configId: string,
    platform: string,
  ): Promise<LeaseHandle | null> {
    const existing = this.leaseRecords.get(configId);
    if (existing) {
      if (existing.handle.expiresAt > Date.now()) {
        return existing.handle;
      }
      // Cached handle expired — drop it and re-acquire so we don't run
      // against a phantom lease (e.g. after DB wipe between calls).
      await this.releasePluginLease(configId);
    }

    const key = `channel:${platform}:${configId}`;
    const handle = await this.leaser.acquire(key, this.leaseTtlMs);
    if (!handle) return null;

    const renewTimer = setInterval(() => {
      this.renewPluginLease(configId).catch((err) => {
        logger.warn(
          `Lease renew failed for ${platform}:${configId.slice(0, 8)}`,
          {
            err: err instanceof Error ? err.message : String(err),
          },
        );
      });
    }, this.leaseRenewMs);

    this.leaseRecords.set(configId, {
      handle,
      renewTimer,
      failures: 0,
    });
    return handle;
  }

  private async renewPluginLease(configId: string): Promise<void> {
    const record = this.leaseRecords.get(configId);
    if (!record) return;

    const renewed = await this.leaser.renew(record.handle);
    if (renewed) {
      record.failures = 0;
      return;
    }

    record.failures++;
    if (record.failures < MAX_LEASE_RENEW_FAILURES) return;

    const plugin = this.plugins.get(configId);
    logger.warn(`Lease lost for plugin ${configId.slice(0, 8)}; stopping`);
    if (plugin) await plugin.stop();
    await this.releasePluginLease(configId);
  }

  private async releasePluginLease(configId: string): Promise<void> {
    const record = this.leaseRecords.get(configId);
    if (!record) return;

    clearInterval(record.renewTimer);
    this.leaseRecords.delete(configId);
    await this.leaser.release(record.handle);
  }

  /**
   * Load all enabled configs from DB, instantiate plugins, register, and start.
   * Replaces the old hardcoded 4-plugin registration.
   */
  async loadAndStartAll(): Promise<void> {
    const allConfigs = getAllChannelConfigs();
    const ctors = await getPluginCtors();
    for (const config of allConfigs) {
      const Ctor = ctors[config.platform];
      if (!Ctor) {
        logger.warn(`No plugin constructor for platform: ${config.platform}`);
        continue;
      }
      const plugin = new Ctor();
      this.registerPlugin(config.id, plugin);
    }
    await this.startAll();
  }

  async startAll(): Promise<void> {
    for (const [configId, plugin] of this.plugins) {
      try {
        const config = getChannelConfigById(configId);
        const token = getChannelToken(configId);
        if (!config?.enabled || !token) {
          logger.info(
            `Skipping ${plugin.platform}:${configId.slice(0, 8)}: not enabled or no credential`,
          );
          continue;
        }
        const pluginConfig = {
          ...this.toPluginConfig(config),
          configId,
          token,
        };
        this.configs.set(configId, pluginConfig);
        const lease = await this.acquirePluginLease(configId, plugin.platform);
        if (!lease) {
          logger.info(
            `Skipping ${plugin.platform}:${configId.slice(0, 8)}: lease held by another instance`,
          );
          continue;
        }
        await plugin.start(pluginConfig);
        await getAuditLog().write('plugin_started', null, plugin.platform, {
          configId,
        });
        logger.info(
          `Started channel plugin: ${plugin.platform}:${configId.slice(0, 8)}`,
        );
      } catch (err) {
        await this.releasePluginLease(configId).catch(() => {});
        logger.warn(
          `Failed to start plugin ${plugin.platform}:${configId.slice(0, 8)}:`,
          err instanceof Error ? err.message : String(err),
        );
        await getAuditLog().write('plugin_error', null, plugin.platform, {
          configId,
          error: String(err),
        });
      }
    }
  }

  async stopAll(): Promise<void> {
    for (const [configId, plugin] of this.plugins) {
      try {
        await plugin.stop();
        await this.releasePluginLease(configId);
        await getAuditLog().write('plugin_stopped', null, plugin.platform, {
          configId,
        });
      } catch (err) {
        logger.warn(
          `Failed to stop plugin ${plugin.platform}:${configId.slice(0, 8)}:`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }
  }

  /** Create, register, and start a new plugin at runtime (e.g., after POST /channels/configs). */
  async addConfig(configId: string, platform: ChannelPlatform): Promise<void> {
    const ctors = await getPluginCtors();
    const Ctor = ctors[platform];
    if (!Ctor) {
      // Some platforms (imessage, whatsapp) ship with a gateway-side adapter
      // only — there is no legacy BasePlugin. The config row is still
      // persisted; the gateway adapter reads credentials from the same vault
      // entry. Skip plugin instantiation rather than fail the save.
      logger.warn(
        `No legacy plugin constructor for platform '${platform}'; config will be saved but managed via gateway adapter`,
      );
      return;
    }
    const plugin = new Ctor();
    this.registerPlugin(configId, plugin);
    // startAll will skip if not enabled or no credential, so safe to call for just this one:
    const config = getChannelConfigById(configId);
    const token = getChannelToken(configId);
    if (config?.enabled && token) {
      const pluginConfig = { ...this.toPluginConfig(config), configId, token };
      this.configs.set(configId, pluginConfig);
      const lease = await this.acquirePluginLease(configId, plugin.platform);
      if (!lease) return;
      try {
        await plugin.start(pluginConfig);
      } catch (err) {
        await this.releasePluginLease(configId).catch(() => {});
        throw err;
      }
    }
  }

  /** Stop and deregister a plugin at runtime (e.g., after DELETE /channels/configs/:configId). */
  async removeConfig(configId: string): Promise<void> {
    const plugin = this.plugins.get(configId);
    if (plugin) {
      await plugin.stop();
      await this.releasePluginLease(configId);
      this.plugins.delete(configId);
      this.configs.delete(configId);
    }
  }

  async handleIncomingMessage(msg: NormalizedMessage): Promise<void> {
    const plugin = this.plugins.get(msg.configId);
    if (!plugin) return;
    const config = this.configs.get(msg.configId);
    if (!config) return;

    // Handle /pair before security pipeline (user not yet approved)
    if (msg.isCommand && msg.commandName === 'pair') {
      await this.handlePairCommand(plugin, msg);
      return;
    }

    // Handle /start welcome (also before approval check)
    if (msg.isCommand && msg.commandName === 'start') {
      const welcomeText =
        config.access_mode === 'open'
          ? 'Welcome! You can start chatting right away.'
          : 'Welcome! Use /pair <code> to authorize your account, or ask your admin for a pairing code.';
      await plugin.sendMessage(msg.conversationId, { text: welcomeText });
      return;
    }

    // Voice transcription — convert voice messages to text via STT.
    // Runs after command checks and with a quick auth pre-check so
    // unauthenticated users don't consume STT API tokens.
    if (msg.voice) {
      const approvedUser = getApprovedChannelUser(msg.configId, msg.userId);
      if (!approvedUser && config.access_mode !== 'open') {
        // User not paired in gated mode — clean up temp voice file before security pipeline rejects
        if (msg.voice?.filePath) {
          try {
            await unlink(msg.voice.filePath);
          } catch {
            // Non-critical: OS temp purge will clean up
          }
        }
      } else {
        const transcribedText = await this.transcribeVoiceMessage(msg);
        if (transcribedText) {
          msg.text = transcribedText;
        } else {
          await plugin.sendMessage(msg.conversationId, {
            text: 'Voice message received but could not be transcribed. Please configure an STT model in Settings → Models, or send a text message instead.',
          });
          return;
        }
      }
    }

    // Run security pipeline
    const result = await this.securityPipeline.run(msg, config);
    if (!result.allowed) {
      await this.sendSecurityResponse(plugin, msg, result.blockedReason!);
      return;
    }

    const { channelUser, wrappedText } = result.securityContext!;

    // Resolve user profile — display name (DB-persisted) + timezone (in-memory cached).
    // The API is called at most once per user per hour (cache TTL).
    const profile = await this.resolveUserProfile(plugin, msg);
    if (profile.displayName && !channelUser.display_name) {
      channelUser.display_name = profile.displayName;
      updateChannelUserDisplayName(channelUser.id, profile.displayName);
    }
    const userTimezone = profile.timezone;

    // Handle other bot commands for approved users
    if (msg.isCommand) {
      await this.handleCommand(plugin, msg, channelUser);
      return;
    }

    // Get or create channel session (with agent session)
    const sessionManager = getChannelSessionManager();
    const { sessionId } = await sessionManager.getOrCreate(
      msg.configId,
      msg.platform,
      msg.sessionKey,
      channelUser.id,
    );

    // Build conversation history for context.
    // When the current message has images, shorten history to reduce confusion
    // with old image-related context (the agent can't see previous images in history).
    const hasAttachments = msg.attachments && msg.attachments.length > 0;
    const historyLimit = hasAttachments ? 4 : 20;
    let conversation: ConversationMessage[] = [];

    // Local channel DB only contains messages the bot has processed, so for
    // Slack threads we prefer conversations.replies — the only source that
    // returns the parent post plus non-bot replies.
    if (msg.platform === 'slack') {
      const { channel: channelId, threadTs } = parseSlackConversationId(
        msg.conversationId,
      );
      const slackClient = plugin.getClient?.() as
        | import('@slack/web-api').WebClient
        | null
        | undefined;
      if (slackClient && channelId && threadTs) {
        const teamId =
          (msg.metadata?.teamId as string | undefined) ?? undefined;
        const threadHistory = await fetchSlackThreadHistory(
          slackClient,
          channelId,
          threadTs,
          msg.messageId,
          teamId,
        );
        conversation =
          hasAttachments && threadHistory.length > historyLimit
            ? threadHistory.slice(-historyLimit)
            : threadHistory;
      }
    }

    // Fallback: DB history for DMs, other platforms, or when Slack fetch fails.
    if (conversation.length === 0) {
      const history = getChannelHistory(sessionId, historyLimit);
      conversation = history.map((m) => ({
        role: m.direction === 'inbound' ? 'user' : 'assistant',
        content: m.content,
      }));
    }

    // Log inbound message — annotate when attachments are present so history
    // readers know an image was involved even though it's not in the text.
    const hasImages = hasAttachments;
    const logContent =
      hasImages && msg.text
        ? `[image attached] ${msg.text}`
        : hasImages
          ? '[image attached]'
          : msg.text;

    if (msg.messageId) {
      insertChannelMessage({
        id: crypto.randomUUID(),
        session_id: sessionId,
        platform: msg.platform,
        config_id: msg.configId,
        platform_message_id: msg.messageId,
        direction: 'inbound',
        content: logContent,
        content_type: hasImages ? 'image' : 'text',
        token_count: 0,
        metadata: '{}',
      });
    }
    await getAuditLog().write(
      'message_received',
      channelUser.id,
      msg.platform,
      {
        chars: msg.text.length,
        hasImages,
      },
    );

    const taskId = crypto.randomUUID();
    sessionManager.updateTask(sessionId, taskId);

    const ackChannel = (msg.metadata?.channel as string) || '';
    const ackMessageTs = msg.messageId;

    // ── Sentiment-aware reactions ───────────────────────────────────────
    // Detect simple acks, compliments, and frustration from the user's
    // message. For short acks ("ok", "thanks") react-only and skip the
    // agent to save LLM cost and reduce noise.
    // Slack-only: other platforms don't have compatible reaction semantics.
    const sentiment =
      !hasImages && msg.platform === 'slack' ? detectSentiment(msg.text) : null;

    // ── Stop / cancel ──────────────────────────────────────────────────
    // If user sends "stop" or "cancel", abort the current run and confirm.
    if (sentiment?.sentiment === 'stop') {
      const active = this.activeRuns.get(msg.conversationId);
      if (active) {
        active.abortController.abort();
        deleteAgentSession(active.sessionId);
        this.activeRuns.delete(msg.conversationId);
        this.queuedMessages.delete(msg.conversationId);
        await plugin.sendMessage(msg.conversationId, {
          text: 'Cancelled.',
        });
      } else {
        await plugin.sendMessage(msg.conversationId, {
          text: 'Nothing running right now. What can I help with?',
        });
      }
      return;
    }

    // ── Sentiment react-only (greetings, terminal acks) ────────────────
    if (sentiment?.reactOnly && ackChannel && ackMessageTs) {
      if (sentiment.emoji && plugin.addNamedReaction) {
        await plugin.addNamedReaction(
          ackChannel,
          ackMessageTs,
          sentiment.emoji,
        );
      }
      if (sentiment.cannedResponse) {
        await plugin.sendMessage(msg.conversationId, {
          text: sentiment.cannedResponse,
        });
        insertChannelMessage({
          id: crypto.randomUUID(),
          session_id: sessionId,
          platform: msg.platform,
          config_id: msg.configId,
          platform_message_id: null,
          direction: 'outbound',
          content: sentiment.cannedResponse,
          content_type: 'text',
          token_count: 0,
          metadata: '{}',
        });
      }
      return;
    }

    // ── Busy check — queue message if agent is already running ─────────
    // Only the latest queued message is kept (newer replaces older).
    // Claim the slot BEFORE any await to prevent a concurrent-message race.
    if (this.activeRuns.has(msg.conversationId)) {
      this.queuedMessages.set(msg.conversationId, msg);
      // :eyes: is left in place as a persistent "was queued" indicator —
      // the processing reaction cleanup in `finally` only targets the
      // active run's ackMessageTs, not queued messages.
      if (plugin.addNamedReaction && ackChannel && ackMessageTs) {
        await plugin.addNamedReaction(ackChannel, ackMessageTs, 'eyes');
      }
      return;
    }
    const placeholderAbort = new AbortController();
    this.activeRuns.set(msg.conversationId, {
      sessionId: '',
      abortController: placeholderAbort,
    });

    // For soft acks (👍) and frustration (🙇), add sentiment reaction
    // immediately — user sees it before the agent even starts processing.
    // Compliments (❤️) are added after reply so the reaction feels like
    // a response to the user's kind words, not a premature acknowledgment.
    if (
      sentiment &&
      !sentiment.reactOnly &&
      sentiment.emoji &&
      sentiment.sentiment !== 'compliment' &&
      plugin.addNamedReaction &&
      ackChannel &&
      ackMessageTs
    ) {
      await plugin.addNamedReaction(ackChannel, ackMessageTs, sentiment.emoji);
    }

    // Add a processing reaction (⏳ or custom :loading:) to acknowledge
    // receipt while the bot is working. Removed in finally block.
    if (plugin.addReaction && ackChannel && ackMessageTs) {
      await plugin.addReaction(ackChannel, ackMessageTs);
    }

    // Declared here so `finally` can still clear the shimmer when the
    // agent throws inside the streaming loop.
    let clearShimmer: (() => Promise<void>) | undefined;

    // Inbound CDN attachments staged to disk for the agent's
    // reference_image_url path. Tracked outside the try so we can unlink
    // them in `finally` even when the agent run throws — otherwise
    // os.tmpdir()/neuma-inbound/ accumulates on busy channels.
    const stagedInboundPaths: string[] = [];

    try {
      // Create a fresh agent session for each message to avoid SDK session
      // resume conflicts. Conversation context is carried via getChannelHistory,
      // not via SDK session persistence — so each message gets a clean subprocess.
      const agentSession = createAgentSession('execute');
      updateChannelSession(sessionId, { agent_session_id: agentSession.id });

      // Register this run so concurrent messages are queued, not duplicated.
      this.activeRuns.set(msg.conversationId, {
        sessionId: agentSession.id,
        abortController: agentSession.abortController,
      });

      // Use conversationId (not sessionKey) so each conversation gets its own
      // folder — sessionKey groups all top-level DMs into one, causing collisions.
      const threadId = msg.conversationId.includes(':')
        ? msg.conversationId.split(':')[1]
        : undefined;
      const workDir = resolveChannelWorkDir(
        msg.platform,
        msg.userId,
        threadId,
        msg.configId,
      );

      // Output directory lives in the persistent channel workDir so files
      // survive across messages within the same thread. Each agent session is
      // ephemeral, but the channel workspace persists per thread — enabling
      // multi-turn workflows like "convert this image" → "now animate it".
      const outputDir = path.join(workDir, 'output');
      await mkdir(outputDir, { recursive: true });

      // Build channel-specific formatting hint for the system context.
      // Include output directory so agent saves files there (persistent).
      const baseHint = getChannelFormatHint(msg.platform);

      // Agent `ls`/Glob doesn't surface prior uploads on its own, so we
      // list them in the system context. Read the current + legacy dirs
      // in parallel so threads predating the rename keep working.
      const attachmentDirs = [
        path.join(workDir, INBOUND_ATTACHMENTS_DIR),
        path.join(workDir, LEGACY_INBOUND_ATTACHMENTS_DIR),
      ];
      const dirListings = await Promise.all(
        attachmentDirs.map((dir) =>
          readdir(dir)
            .then((entries) =>
              entries
                .filter((e) => !e.startsWith('.'))
                .map((e) => path.join(dir, e)),
            )
            .catch(() => [] as string[]),
        ),
      );
      // Sort by mtime (most recent first) so the hint surfaces the just-uploaded
      // attachment — lexicographic sort would alphabetise and miss fresh files.
      const allPaths = dirListings.flat();
      const withMtime = await Promise.all(
        allPaths.map(async (p) => ({
          p,
          mtime: await stat(p)
            .then((s) => s.mtimeMs)
            .catch(() => 0),
        })),
      );
      const recentAttachmentPaths = withMtime
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, 10)
        .map((x) => x.p);
      const attachmentsHint =
        recentAttachmentPaths.length > 0
          ? `\n\nPrior user attachments (images/files sent earlier in this thread):\n` +
            recentAttachmentPaths.map((p) => `- ${p}`).join('\n') +
            `\n- Use these paths directly with Read, media_generate_image (reference_image_url),` +
            ` or media_generate_video when the user says "the photo/image I sent" — do NOT ask them to re-upload.`
          : '';

      const outputHint =
        `\n\nFile handling:` +
        `\n- Output directory (for files you create/convert/generate): ${outputDir}` +
        `\n- Files saved there will be automatically sent to the user.` +
        `\n- Previous output files are also in this directory — you can reference them for follow-up tasks.` +
        `\n- Do NOT save output files to other directories.` +
        attachmentsHint +
        `\n\nIterative editing rules:` +
        `\n- Video content (text, price, layout) comes from the REFERENCE IMAGE — the video prompt controls MOTION/ANIMATION only.` +
        `\n- To change text/price in a video: (1) update the image with media_generate_image, (2) generate video with prompt="__reuse__" to keep the same motion + updated content from the new image.` +
        `\n- Only regenerate images when the user explicitly asks for image changes or when the video content needs updating.` +
        `\n- When editing images, write a SHORT prompt describing ONLY what to change — do not re-describe the entire scene.`;

      // Resolve conversation environment — channel name/topic for @mentions in channels.
      // Gives the agent context about where the conversation is happening.
      const channelInfo = await this.resolveChannelInfo(plugin, msg);
      const channelType = (msg.metadata?.channelType as string) ?? '';
      const envParts: string[] = [];
      if (channelType) {
        const typeLabel =
          channelType === 'im'
            ? 'direct message'
            : channelType === 'mpim'
              ? 'group direct message'
              : channelType === 'group'
                ? 'private channel'
                : 'public channel';
        envParts.push(`Conversation type: ${typeLabel}`);
      }
      const channelId = (msg.metadata?.channel as string) || '';
      if (channelInfo.name) {
        envParts.push(`Channel: #${channelInfo.name}`);
      }
      if (channelId && channelType !== 'im' && channelType !== 'mpim') {
        envParts.push(`Channel ID: ${channelId}`);
      }
      if (channelInfo.topic) {
        envParts.push(`Channel topic: ${channelInfo.topic}`);
      }
      const envHint =
        envParts.length > 0
          ? `\n\nConversation environment:\n${envParts.map((p) => `- ${p}`).join('\n')}`
          : '';

      let channelHint = baseHint + outputHint + envHint;
      const runtimeContext: RuntimeContext = {
        channelContext: channelHint,
        timezone: userTimezone ?? undefined,
      };

      // Model resolution priority: channel override → agent profile default.
      // Codex model IDs (codex:*) must be routed to agentType 'codex'.
      const dbCfg = getChannelConfigById(msg.configId);
      const channelProfile = dbCfg?.agent_profile_id
        ? getAgentProfile(dbCfg.agent_profile_id)
        : null;
      const rawModel = dbCfg?.model ?? channelProfile?.default_model ?? null;
      const modelConfig = rawModel
        ? {
            model: rawModel,
            agentType: (rawModel.startsWith('codex:') || rawModel === 'codex'
              ? 'codex'
              : undefined) as 'codex' | undefined,
          }
        : undefined;

      // Download image attachments from channel CDNs (Discord, Telegram, Slack)
      let inboundImages: ImageAttachment[] | undefined;
      // Local file paths for attachments on the CURRENT message — surfaced to
      // the agent so it can pass them as `reference_image_url` for image edits
      // (transparent background, restyle, etc.) instead of generating from
      // scratch off a vision-only description.
      const currentMessageImagePaths: string[] = [];
      if (msg.attachments && msg.attachments.length > 0) {
        // Slack private URLs require bot token auth
        const authToken =
          msg.platform === 'slack' ? plugin.getAuthToken?.() : undefined;
        const images = await downloadImageAttachments(
          msg.attachments,
          authToken,
        );
        if (images.length > 0) {
          inboundImages = images;
          logger.debug(
            `Downloaded ${images.length} inbound image(s) for agent vision`,
          );

          // Stage downloaded bytes to disk so CDN-sourced attachments (Slack
          // url_private, Discord cdn, Telegram api) yield a local path the
          // agent can hand to media_generate_image as reference_image_url.
          // Without this, only pre-downloaded `/`-prefixed attachments would
          // surface and the edit-routing feature would be dead for every
          // channel that uses CDN URLs.
          const inboundDir = path.join(os.tmpdir(), 'neuma-inbound');
          try {
            await mkdir(inboundDir, { recursive: true });
            for (const img of images) {
              const ext = mimeTypeToExtension(img.mimeType);
              const filePath = path.join(
                inboundDir,
                `inbound-${crypto.randomUUID()}${ext}`,
              );
              try {
                await writeFile(filePath, Buffer.from(img.data, 'base64'));
                currentMessageImagePaths.push(filePath);
                stagedInboundPaths.push(filePath);
              } catch (err) {
                logger.warn(
                  `Failed to stage inbound image: ${err instanceof Error ? err.message : String(err)}`,
                );
              }
            }
          } catch (err) {
            logger.warn(
              `Failed to create inbound staging dir: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
        for (const att of msg.attachments) {
          // Reject paths containing control chars (newlines, escapes) so a
          // crafted attachment can't break out of the bracketed hint and
          // inject routing instructions into the agent prompt below.
          if (
            att.startsWith('/') &&
            /\.(png|jpe?g|gif|webp|bmp)$/i.test(att) &&
            !/[\x00-\x1f\x7f]/.test(att) &&
            !currentMessageImagePaths.includes(att)
          ) {
            currentMessageImagePaths.push(att);
          }
        }
      }

      const channelProfileId = dbCfg?.agent_profile_id ?? undefined;

      // Extract profile-level skills so they are passed to the agent as pinnedSkills
      const profilePinnedSkills = channelProfileId
        ? getProfileSkillSlugs(channelProfileId)
        : undefined;

      // Build workspace-qualified userId for memory scope isolation.
      // Slack/Lark IDs are workspace-scoped — without the qualifier,
      // users with the same ID in different workspaces would share memories.
      const qualifiedUserId = buildQualifiedUserId(
        msg.platform,
        msg.userId,
        msg.metadata,
      );

      // Resolve Slack <@U...> mentions to display names in a single parallel batch.
      let resolvedText = wrappedText;
      if (msg.platform === 'slack') {
        const botToken = plugin.getAuthToken?.();
        const actionToken = (msg.metadata?.actionToken as string) ?? undefined;
        if (botToken) {
          const mentionIds = [
            ...new Set(
              [...wrappedText.matchAll(/<@([A-Z0-9]+)>/gi)].map((m) => m[1]!),
            ),
          ].slice(0, 10);

          if (mentionIds.length > 0) {
            // Single parallel batch — each call returns full profile (name + title + tz)
            const results = await Promise.all(
              mentionIds.map((uid) =>
                searchSlackUsers(botToken, actionToken, uid, 1).catch(() => []),
              ),
            );
            const resolved = new Map(
              mentionIds
                .map((uid, i) => [uid, results[i]?.[0]] as const)
                .filter(
                  (entry): entry is [string, NonNullable<(typeof entry)[1]>] =>
                    !!entry[1],
                ),
            );

            // Replace <@U123> → @DisplayName
            resolvedText = wrappedText.replace(
              /<@([A-Z0-9]+)>/gi,
              (_, uid: string) => {
                const user = resolved.get(uid);
                return user ? `@${user.name}` : `<@${uid}>`;
              },
            );

            // Inject mentioned user context (reuse already-fetched profiles)
            if (resolved.size > 0) {
              runtimeContext.channelContext =
                (runtimeContext.channelContext ?? '') +
                `\n\nMentioned users:\n${formatUserResults([...resolved.values()])}`;
            }
          }
        }
      }

      if (msg.platform === 'slack') {
        const hasBotToken = !!plugin.getAuthToken?.();
        logger.debug(
          `Slack channel agent run: botToken=${hasBotToken ? 'present' : 'MISSING'}`,
        );
      }

      // Prepend sender attribution OUTSIDE the prompt-injection wrap. Without
      // this, the wrapped "treat as data" block is opaque to the agent, so in
      // multi-user threads it defaults to the most-recent named speaker in
      // history (e.g. the thread starter) and addresses the wrong person.
      // Display names are user-controlled via Slack's users.profile.set — a
      // name containing CR/LF or `]` could break out of the attribution line
      // and inject instructions before the nonce wrap, so neutralize those.
      const rawSenderName =
        channelUser.display_name?.trim() ||
        profile.displayName?.trim() ||
        msg.userId;
      const senderName = rawSenderName.replace(/[\r\n\]]/g, ' ');

      // For image-only messages, synthesize an analyze-this prompt — otherwise
      // the empty body produces a generic greeting instead of acting on the image.
      const isEmptyText = resolvedText.trim().length === 0;
      const promptBody =
        isEmptyText && inboundImages && inboundImages.length > 0
          ? `[The user shared ${inboundImages.length === 1 ? 'an image' : `${inboundImages.length} images`} with no caption. Decide whether to describe, edit/transform with media_generate_image, or ask a clarifying question — do not always default to describing.]`
          : resolvedText;
      // Surface the local file path of any attachment on THIS message so the
      // agent can pass it as `reference_image_url` to media_generate_image.
      // Without this, image-edit requests ("make it transparent", "use as
      // greeter on the slide") collapse into vision-analysis → text-to-image,
      // and the output looks nothing like the source.
      const currentAttachmentsHint =
        currentMessageImagePaths.length > 0
          ? `\n\n[Current message attachments — local file paths]\n` +
            currentMessageImagePaths.map((p) => `- ${p}`).join('\n') +
            `\n[Routing rule: if the user's request transforms, restyles, edits, or otherwise builds on this image (e.g. "make it transparent", "use as a greeter", "remove background", "make it waving", "create a PNG of this"), call media_generate_image with this path as reference_image_url and a SHORT prompt describing only the change. Generate from scratch (no reference) ONLY when the user explicitly says to ignore the image.]`
          : '';
      const attributedText = `[Current message from ${senderName}]\n${promptBody}${currentAttachmentsHint}`;

      // Per-Slack-user PATs from App Home → env-var overrides for this
      // run. Off-platform messages and unpaired users fall through to
      // global config.
      let userCredentials: Record<string, string> | undefined;
      let userMcpOverlay: Record<string, unknown> | undefined;
      if (msg.platform === 'slack') {
        const slackTeamId = msg.metadata?.teamId as string | undefined;
        if (slackTeamId && msg.userId) {
          try {
            const resolved = loadUserScopedCredentials({
              slackTeamId,
              slackUserId: msg.userId,
              connectorKeyToEnvVar,
            });
            if (Object.keys(resolved).length > 0) userCredentials = resolved;
          } catch (err) {
            logger.warn('Slack user-scoped credential resolution failed', {
              err,
            });
          }
          try {
            const overlay = loadUserScopedMcpServers({
              slackTeamId,
              slackUserId: msg.userId,
            });
            if (Object.keys(overlay.servers).length > 0) {
              userMcpOverlay = overlay.servers;
              logger.info('Slack user-scoped MCP overlay loaded', {
                names: Object.keys(overlay.servers),
                skipped: overlay.skipped,
              });
            }
          } catch (err) {
            logger.warn('Slack user-scoped MCP overlay resolution failed', {
              err,
            });
          }
        }
      }

      const agentGen = withSessionContext(
        { workDir, sessionId: agentSession.id, userCredentials },
        runAgent(attributedText, {
          session: agentSession,
          conversation: conversation.length > 0 ? conversation : undefined,
          workDir,
          taskId,
          modelConfig,
          images: inboundImages,
          runtimeContext,
          agentProfileId: channelProfileId,
          pinnedSkills: profilePinnedSkills,
          userCredentials,
          userMcpOverlay,
          // Channel-driven runs auto-approve tools — pairing already
          // authorized the user, and per-tool approval prompts in Slack
          // produce 5-minute "Permission request expired" hangs because
          // there's no convenient approval UI inline.
          autoApprove: true,
          channelContext: buildAgentChannelContext({
            platform: msg.platform,
            conversationId: msg.conversationId,
            configId: msg.configId,
            qualifiedUserId,
            channelUser,
            botToken:
              msg.platform === 'slack'
                ? (plugin.getAuthToken?.() ?? undefined)
                : undefined,
            actionToken:
              msg.platform === 'slack'
                ? ((msg.metadata?.actionToken as string) ?? undefined)
                : undefined,
          }),
        }),
      );

      // Snapshot output dir before agent runs — only send NEW or MODIFIED files.
      // Record modification times so we can detect overwrites (same filename, new content).
      const preExistingOutputFiles: Map<string, number> = new Map();
      try {
        const entries = await readdir(outputDir);
        for (const e of entries) {
          const fp = path.join(outputDir, e);
          try {
            const s = await stat(fp);
            preExistingOutputFiles.set(fp, s.mtimeMs);
          } catch {
            preExistingOutputFiles.set(fp, 0);
          }
        }
      } catch {
        // dir empty or just created
      }

      // Files with mtime before this belong to a prior session and must
      // never be attached as "new" — guards against orphan background
      // writers from a crashed earlier turn.
      const sessionStartMs = Date.now();

      const useBlockKitProgress = dbCfg?.block_kit_progress ?? true;
      const createdFiles: string[] = [];
      const collectedImageUrls: string[] = [];
      let finalText = '';
      let extractedResultText: string | undefined;

      if (useBlockKitProgress && msg.platform === 'slack') {
        // ── Block Kit progress mode ───────────────────────────────────────
        // Process agent stream directly with Block Kit progress updates.
        // chat.update with blocks does NOT show "(edited)" tag.
        const slackClient = plugin.getClient?.() as
          | import('@slack/web-api').WebClient
          | null;

        if (slackClient) {
          const [channel, threadTs] = msg.conversationId.includes(':')
            ? (msg.conversationId.split(':') as [string, string])
            : [msg.conversationId, undefined];

          // Wire up assistant thread status for shimmer + "is typing..."
          // indicator. SlackPlugin.setThreadStatus is Slack-specific, so we
          // check for it dynamically to stay decoupled from the plugin type.
          const setStatus =
            'setThreadStatus' in plugin
              ? (status: string, loadingMessages?: string[]) =>
                  (
                    plugin as {
                      setThreadStatus: (
                        id: string,
                        s: string,
                        lm?: string[],
                      ) => Promise<void>;
                    }
                  ).setThreadStatus(msg.conversationId, status, loadingMessages)
              : undefined;
          if (setStatus) {
            clearShimmer = () => setStatus('').catch(() => {});
          }

          // Set initial thread status with rotating loading messages.
          // Slack rotates loading_messages as a shimmer animation.
          const progressStartTime = Date.now();
          await setStatus?.('Thinking...', [
            'Analyzing your request\u2026',
            'Gathering information\u2026',
            'Preparing a response\u2026',
          ]).catch(() => {});

          const toolNames = new Map<string, string>();
          let hasReceivedText = false;
          // Track the start of the most recent video render so the shimmer
          // for each subsequent media_check_video poll can surface elapsed
          // time ("Rendering video (1m 20s)…") instead of a static label.
          let videoRenderStartedAt: number | undefined;

          for await (const ev of agentGen) {
            if (ev.type === 'text' && ev.content) {
              finalText += ev.content;
              if (!hasReceivedText) {
                hasReceivedText = true;
                await setStatus?.('Writing response...').catch(() => {});
              }
            }

            if (ev.type === 'tool_use' && ev.name && ev.id) {
              toolNames.set(ev.id, ev.name);

              const stripped = ev.name.replace(/^mcp__[^_]+__/, '');
              if (stripped === 'media_generate_video') {
                videoRenderStartedAt = Date.now();
              }

              // Default status = humanized tool label.
              // For video polling we rewrite to include elapsed time so the
              // shimmer stays informative across 2-3 min renders instead of
              // sitting on the same "Rendering video…" for minutes.
              let statusText = `${humanizeToolName(ev.name)}...`;
              if (stripped === 'media_check_video' && videoRenderStartedAt) {
                const elapsedMs = Date.now() - videoRenderStartedAt;
                const elapsed = Math.max(0, Math.round(elapsedMs / 1000));
                const mm = Math.floor(elapsed / 60);
                const ss = elapsed % 60;
                const fmt = mm > 0 ? `${mm}m ${ss}s` : `${ss}s`;
                statusText = `Rendering video (${fmt} / ~2-3 min)...`;
              }

              // Push step-level status to the assistant thread indicator,
              // with rotating loading messages for long-running media tools.
              await setStatus?.(
                statusText,
                loadingMessagesForTool(ev.name),
              ).catch(() => {});

              // Track Write tool file paths
              if (ev.name === 'Write' || ev.name === 'write') {
                const input = ev.input as { file_path?: string } | undefined;
                if (input?.file_path && typeof input.file_path === 'string') {
                  const ext = path.extname(input.file_path).toLowerCase();
                  if (
                    ChannelManager.SENDABLE_EXTENSIONS.has(ext) &&
                    input.file_path.startsWith(workDir)
                  ) {
                    createdFiles.push(input.file_path);
                  }
                }
              }
            }

            if (ev.type === 'tool_result' && ev.toolUseId) {
              // Collect image URLs + file paths from tool output.
              // URLs are collected for later delivery via plugin.sendPhotoUrls
              // (which handles download + upload safely). No direct fetch here
              // to avoid SSRF — only the plugin's upload methods are trusted.
              if (ev.output) {
                const urlMatches = ev.output.match(
                  /URL:\s*(https?:\/\/[^\s"'<>]+)/gi,
                );
                if (urlMatches) {
                  for (const m of urlMatches) {
                    const url = m.replace(/^URL:\s*/i, '').trim();
                    if (!collectedImageUrls.includes(url)) {
                      collectedImageUrls.push(url);
                    }
                  }
                }

                const pathMatches = ev.output.match(
                  /(?:\/[\w./-]+\.(?:png|jpg|jpeg|gif|webp|bmp|svg|pdf|mp3|wav|ogg|mp4|mov))\b/gi,
                );
                if (pathMatches) {
                  for (const fp of new Set(pathMatches)) {
                    const ext = path.extname(fp).toLowerCase();
                    if (
                      ChannelManager.SENDABLE_EXTENSIONS.has(ext) &&
                      fp.startsWith(workDir) &&
                      !isInboundAttachmentPath(fp) &&
                      !createdFiles.includes(fp)
                    ) {
                      createdFiles.push(fp);
                    }
                  }
                }
              }
            }
          }

          // Clear thread status and post final result as a clean message
          await setStatus?.('').catch(() => {});

          const elapsed = Math.round((Date.now() - progressStartTime) / 1000);
          extractedResultText = extractFinalResult(finalText);
          const resultBlocks = buildResultBlocks(extractedResultText, {
            elapsed,
            preExtracted: true,
          });

          // Post result directly — no progress message to replace
          try {
            await slackClient.chat.postMessage({
              channel,
              thread_ts: threadTs,
              text: extractedResultText || 'Done',
              blocks: resultBlocks,
            });
          } catch (err) {
            logger.error('Failed to post Slack result message', { err });
          }
        } else {
          // Fallback: no Slack client, use standard streaming
          const textStream = this.toTextStreamWithFiles(
            agentGen,
            createdFiles,
            workDir,
            collectedImageUrls,
            sessionStartMs,
          );
          const result = await this.messageService.streamToChannel(
            plugin,
            msg.conversationId,
            textStream,
            this.outboundPipeline,
          );
          finalText = result.text;
        }
      } else {
        // ── Standard streaming mode (Mode OFF or non-Slack) ───────────────
        const textStream = this.toTextStreamWithFiles(
          agentGen,
          createdFiles,
          workDir,
          collectedImageUrls,
          sessionStartMs,
        );
        const { text, messageId: streamedMessageId } =
          await this.messageService.streamToChannel(
            plugin,
            msg.conversationId,
            textStream,
            this.outboundPipeline,
          );
        finalText = text;

        // Post-processing cleanup for Slack Mode OFF
        if (
          msg.platform === 'slack' &&
          streamedMessageId &&
          plugin.editMessage
        ) {
          extractedResultText = extractFinalResult(finalText);
          if (
            extractedResultText !== finalText &&
            extractedResultText.length > 20
          ) {
            await plugin
              .editMessage(
                msg.conversationId,
                streamedMessageId,
                extractedResultText,
              )
              .catch(() => {});
          }
        }
      }

      // Extract markdown image references from agent text
      const { localPaths, remoteUrls } =
        this.outboundPipeline.extractMarkdownImages(finalText);
      for (const lp of localPaths) {
        if (
          lp.startsWith(workDir) &&
          !isInboundAttachmentPath(lp) &&
          !createdFiles.includes(lp)
        ) {
          createdFiles.push(lp);
        }
      }
      // Merge collected CDN URLs into remoteUrls for delivery.
      // These are URLs extracted from tool results (e.g. media_generate_image)
      // that the agent may or may not have downloaded to disk.
      for (const url of collectedImageUrls) {
        if (!remoteUrls.includes(url)) {
          remoteUrls.push(url);
        }
      }

      // Scan the output dir for new sendable files created this turn.
      // Only include files referenced in the agent's response text (by filename).
      // This prevents sending intermediate/failed files (e.g. a 5s video that was
      // later trimmed to 3s — only the 3s version is mentioned in the response).
      try {
        const dirEntries = await readdir(outputDir);
        const newOutputFiles: Array<{ path: string; name: string }> = [];
        for (const entry of dirEntries) {
          const ext = path.extname(entry).toLowerCase();
          if (!ChannelManager.SENDABLE_EXTENSIONS.has(ext)) continue;
          const fullPath = path.join(outputDir, entry);
          if (createdFiles.includes(fullPath)) continue;
          try {
            const fileStat = await stat(fullPath);
            if (!fileStat.isFile() || fileStat.size === 0) continue;
            // Must be written/modified during this turn — ignore snapshots
            // of files from earlier runs and orphan background writers.
            const prevMtime = preExistingOutputFiles.get(fullPath);
            if (prevMtime !== undefined && fileStat.mtimeMs <= prevMtime)
              continue;
            if (fileStat.mtimeMs < sessionStartMs) continue;
            newOutputFiles.push({ path: fullPath, name: entry });
          } catch {
            // skip
          }
        }

        if (newOutputFiles.length > 0) {
          // Try to match files mentioned in the agent's response text.
          // This prevents sending intermediate files when multiple exist.
          const resultForMatch =
            extractedResultText ?? extractFinalResult(finalText);
          const mentioned = newOutputFiles.filter((f) =>
            resultForMatch.includes(f.name),
          );
          if (mentioned.length > 0) {
            for (const f of mentioned) createdFiles.push(f.path);
          } else {
            // Fallback 1: check full text (includes intermediate output)
            const mentionedFull = newOutputFiles.filter((f) =>
              finalText.includes(f.name),
            );
            if (mentionedFull.length > 0) {
              for (const f of mentionedFull) createdFiles.push(f.path);
            } else {
              // Fallback 2: agent didn't mention filenames but DID create
              // files in the output dir — send them all. This covers media
              // generation where the agent saves a file but only describes
              // the result without mentioning the exact filename.
              for (const f of newOutputFiles) createdFiles.push(f.path);
            }
          }
        }
      } catch {
        // dir might not exist
      }

      // Only send files actually created or overwritten during this turn —
      // tool-output regex and markdown extraction can pick up old paths.
      const filesToSend: string[] = [];
      for (const fp of createdFiles) {
        const prevMtime = preExistingOutputFiles.get(fp);
        if (prevMtime === undefined) {
          try {
            const s = await stat(fp);
            if (s.mtimeMs < sessionStartMs) {
              logger.debug(
                `Skipping stale file (mtime < session start): ${path.basename(fp)}`,
              );
              continue;
            }
            filesToSend.push(fp);
          } catch {
            logger.debug(
              `File referenced but not found on disk: ${path.basename(fp)}`,
            );
          }
        } else {
          try {
            const s = await stat(fp);
            if (s.mtimeMs > prevMtime && s.mtimeMs >= sessionStartMs) {
              filesToSend.push(fp); // modified during this run
            }
          } catch {
            // file removed, skip
          }
        }
      }

      // Send any files created by the agent (images, documents, etc.)
      if (filesToSend.length > 0 && plugin.sendFiles) {
        // Re-check plugin is still running — long agent runs (minutes) can
        // outlast a dev-server hot-reload or Socket Mode reconnect, leaving
        // the plugin reference stale (this.app = null).
        if (plugin.state !== 'running') {
          logger.warn(
            `Plugin ${msg.platform} is ${plugin.state} — file upload may fail. ` +
              `Attempting with current plugin for ${filesToSend.length} file(s).`,
          );
          // Try the active plugin instance instead if the original went stale
          const activePlugin = this.plugins.get(msg.configId);
          if (activePlugin?.sendFiles && activePlugin.state === 'running') {
            logger.info('Using active plugin instance for file upload');
            try {
              await activePlugin.sendFiles(msg.conversationId, filesToSend);
              logger.info(
                `File upload complete for ${msg.platform} (via active plugin)`,
              );
            } catch (err) {
              logger.error('File upload failed (active plugin)', { err });
            }
          } else {
            logger.error(
              `No running plugin available for ${msg.platform} file upload`,
            );
          }
        } else {
          logger.info(
            `Sending ${filesToSend.length} file(s) to ${msg.platform}: ${filesToSend.join(', ')}`,
          );
          try {
            await plugin.sendFiles(msg.conversationId, filesToSend);
            logger.info(`File upload complete for ${msg.platform}`);
          } catch (err) {
            logger.error('File upload failed', { err });
          }
        }
      }

      // Send remote image URLs (best-effort — CDN URLs may have expired)
      if (remoteUrls.length > 0 && plugin.sendPhotoUrls) {
        // Use active plugin if original went stale (same hot-reload guard as sendFiles)
        const photoPlugin =
          plugin.state === 'running'
            ? plugin
            : (this.plugins.get(msg.configId) ?? plugin);
        if (photoPlugin.sendPhotoUrls) {
          logger.info(
            `Sending ${remoteUrls.length} remote image URL(s) to ${msg.platform}`,
          );
          try {
            await photoPlugin.sendPhotoUrls(msg.conversationId, remoteUrls);
          } catch (err) {
            logger.warn('Remote image URL send failed (URL may have expired)', {
              err,
            });
          }
        }
      }

      // Log outbound message + record token usage
      const tokens = estimateTokens(finalText);
      insertChannelMessage({
        id: crypto.randomUUID(),
        session_id: sessionId,
        platform: msg.platform,
        config_id: msg.configId,
        platform_message_id: null,
        direction: 'outbound',
        content: finalText,
        content_type: 'text',
        token_count: tokens,
        metadata: '{}',
      });
      recordTokenUsage(channelUser.id, tokens);

      // Tag all usage_logs entries for this task as channel-originated so they
      // appear in the channel source filter in UsageSettings.
      try {
        getDatabase()
          .prepare(`UPDATE usage_logs SET billing_scope = ? WHERE task_id = ?`)
          .run(`channel:${msg.configId}`, taskId);
      } catch {
        // Non-fatal — usage tracking still works, just won't be tagged
      }

      // Add ❤️ for compliments after reply — feels like a warm response
      // to the user's kind words. (Soft acks and frustration were already
      // reacted before the agent run for immediate feedback.)
      if (
        sentiment?.sentiment === 'compliment' &&
        sentiment.emoji &&
        plugin.addNamedReaction &&
        ackChannel &&
        ackMessageTs
      ) {
        await plugin.addNamedReaction(
          ackChannel,
          ackMessageTs,
          sentiment.emoji,
        );
      }

      await getAuditLog().write('message_sent', channelUser.id, msg.platform, {
        tokens,
        chars: finalText.length,
      });
    } catch (err) {
      sessionManager.recordError(sessionId);
      logger.error('Agent run failed', {
        err,
        platform: msg.platform,
        userId: msg.userId,
      });
      await getAuditLog().write('agent_error', channelUser.id, msg.platform, {
        error: err instanceof Error ? err.message : String(err),
      });
      await plugin.sendMessage(msg.conversationId, {
        text: 'An error occurred. Please try again.',
      });
    } finally {
      // Always clear the thread-status shimmer, even on error.
      if (clearShimmer) {
        await clearShimmer();
      }

      // Delete staged inbound attachment files — only needed for the
      // duration of this turn's agent run.
      for (const p of stagedInboundPaths) {
        try {
          await unlink(p);
        } catch (err) {
          logger.debug(
            `Failed to unlink staged inbound image ${p}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      // Clear the processing reaction now that the bot has replied
      if (plugin.removeReaction && ackChannel && ackMessageTs) {
        await plugin.removeReaction(ackChannel, ackMessageTs);
      }

      // Clear active run tracking
      this.activeRuns.delete(msg.conversationId);

      // Process queued message if one was received while busy
      const queued = this.queuedMessages.get(msg.conversationId);
      if (queued) {
        this.queuedMessages.delete(msg.conversationId);
        // Fire-and-forget — don't await to avoid recursive stack buildup
        this.handleIncomingMessage(queued).catch((err) => {
          logger.error('Failed to process queued message', { err });
        });
      }
    }
  }

  /**
   * Transcribe a voice message using the configured STT provider.
   * Returns the transcribed text, or null if transcription fails or no STT is available.
   */
  private async transcribeVoiceMessage(
    msg: NormalizedMessage,
  ): Promise<string | null> {
    if (!msg.voice) return null;

    const { filePath, mimeType, sizeBytes } = msg.voice;

    // Check if any STT provider is available
    const caps = listCapabilities();
    if (caps.sttProviders.length === 0) {
      logger.warn(
        'No STT provider configured — voice message cannot be transcribed. ' +
          'Configure an STT model (e.g., OpenAI Whisper, Deepgram) in Settings → Models.',
      );
      return null;
    }

    // Check file exists and read audio data
    let fileStat: Awaited<ReturnType<typeof stat>>;
    try {
      fileStat = await stat(filePath);
    } catch {
      logger.error(`Voice file not found: ${filePath}`);
      return null;
    }

    if (fileStat.size === 0) {
      logger.warn('Voice file is empty');
      return null;
    }

    // Max 25 MB
    if (fileStat.size > 25 * 1024 * 1024) {
      logger.warn(
        `Voice file too large (${fileStat.size} bytes), skipping transcription`,
      );
      return null;
    }

    logger.info(
      `Transcribing voice message: ${filePath} (${sizeBytes ?? fileStat.size} bytes, ${mimeType})`,
    );

    try {
      const audioData = await readFile(filePath);
      const result = await transcribe({ audioData, mimeType });

      if (!result.success || !result.text) {
        logger.warn(
          `STT transcription failed: ${result.error ?? 'no text returned'}`,
        );
        return null;
      }

      logger.info(
        `Voice transcription complete: "${result.text.slice(0, 100)}${result.text.length > 100 ? '…' : ''}" ` +
          `(provider=${result.provider}, lang=${result.detectedLanguage ?? 'unknown'})`,
      );

      return result.text;
    } catch (err) {
      logger.error(
        `STT transcription error: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    } finally {
      // Clean up temp voice file
      try {
        await unlink(filePath);
        logger.debug(`Cleaned up voice temp file: ${filePath}`);
      } catch {
        // Non-critical
      }
    }
  }

  /** File extensions worth sending back to the channel as attachments. */
  private static readonly SENDABLE_EXTENSIONS = new Set([
    '.png',
    '.jpg',
    '.jpeg',
    '.gif',
    '.webp',
    '.bmp',
    '.svg',
    '.pdf',
    '.mp3',
    '.wav',
    '.ogg',
    '.mp4',
    '.mov',
  ]);

  /**
   * Stream text from agent events while collecting file paths and image URLs
   * created by tool calls. Detects:
   *   - Write tool inputs (file_path)
   *   - Bash tool outputs (local file paths)
   *   - MCP tool results with "URL: https://..." (e.g. media_generate_image)
   */
  private async *toTextStreamWithFiles(
    agentGen: AsyncGenerator<{
      type: string;
      content?: string;
      name?: string;
      input?: unknown;
      output?: string;
    }>,
    createdFiles: string[],
    workDir: string,
    collectedImageUrls?: string[],
    sessionStartMs?: number,
  ): AsyncIterable<string> {
    for await (const msg of agentGen) {
      if (msg.type === 'text' && msg.content) {
        yield msg.content;
      }

      // Collect candidate file paths from Write tool (file may not exist yet at
      // tool_use time — existence is verified by sendFiles after streaming completes)
      if (
        msg.type === 'tool_use' &&
        (msg.name === 'Write' || msg.name === 'write')
      ) {
        const input = msg.input as { file_path?: string } | undefined;
        if (input?.file_path && typeof input.file_path === 'string') {
          const ext = path.extname(input.file_path).toLowerCase();
          if (
            ChannelManager.SENDABLE_EXTENSIONS.has(ext) &&
            input.file_path.startsWith(workDir)
          ) {
            createdFiles.push(input.file_path);
          }
        }
      }

      // Detect files and image URLs from tool results
      if (msg.type === 'tool_result' && msg.output) {
        // Local file paths from Bash/tool output
        const pathMatches = msg.output.match(
          /(?:\/[\w./-]+\.(?:png|jpg|jpeg|gif|webp|bmp|svg|pdf|mp3|wav|ogg|mp4|mov))\b/gi,
        );
        if (pathMatches) {
          for (const fp of new Set(pathMatches)) {
            const ext = path.extname(fp).toLowerCase();
            if (
              !ChannelManager.SENDABLE_EXTENSIONS.has(ext) ||
              !fp.startsWith(workDir) ||
              isInboundAttachmentPath(fp) ||
              createdFiles.includes(fp)
            ) {
              continue;
            }
            // Regex-extracted paths can match files the agent merely
            // listed (`ls`) but didn't write this turn. Require an mtime
            // newer than sessionStart; if the file doesn't exist yet, let
            // the end-of-turn output-dir scan pick it up instead.
            if (sessionStartMs !== undefined) {
              try {
                const s = await stat(fp);
                if (s.mtimeMs < sessionStartMs) continue;
              } catch {
                continue;
              }
            }
            createdFiles.push(fp);
          }
        }

        // Image URLs from MCP tool results (e.g. "URL: https://cdn.../image")
        // Download immediately — CDN URLs (BytePlus etc.) expire within seconds
        const urlMatches = msg.output.match(/URL:\s*(https?:\/\/[^\s"'<>]+)/gi);
        if (urlMatches) {
          for (const m of urlMatches) {
            const url = m.replace(/^URL:\s*/i, '').trim();
            // Defense-in-depth SSRF check — URL comes from MCP tool output, not
            // directly from user input, but prompt injection could inject arbitrary URLs.
            const urlCheck = validateBaseUrl(url);
            if (!urlCheck.valid) {
              logger.warn('Blocked tool-result image URL (SSRF)', {
                url: url.slice(0, 80),
                reason: urlCheck.reason,
              });
              continue;
            }
            try {
              const imgRes = await fetch(url, {
                signal: AbortSignal.timeout(30_000),
              });
              if (imgRes.ok) {
                const buf = Buffer.from(await imgRes.arrayBuffer());
                if (buf.byteLength <= MAX_UPLOAD_BYTES) {
                  const imgCheck = validateImageResponse(imgRes, buf);
                  if (!imgCheck.valid) {
                    logger.warn(
                      'Tool-result URL did not return valid image data',
                      { reason: imgCheck.reason, url: url.slice(0, 80) },
                    );
                    continue;
                  }
                  const tmpDir = path.join(os.tmpdir(), 'neuma-channel-media');
                  await mkdir(tmpDir, { recursive: true });
                  const tmpFile = path.join(
                    tmpDir,
                    `img-${crypto.randomUUID().slice(0, 8)}${imgCheck.ext}`,
                  );
                  await writeFile(tmpFile, buf);
                  createdFiles.push(tmpFile);
                  logger.info(
                    `Downloaded tool-result image to ${path.basename(tmpFile)} (${buf.byteLength} bytes)`,
                  );
                }
              } else {
                logger.warn(
                  `Tool-result image download failed: ${imgRes.status}`,
                );
                // Still collect URL as fallback for delayed retry
                collectedImageUrls?.push(url);
              }
            } catch (dlErr) {
              logger.warn('Tool-result image download error', { err: dlErr });
              collectedImageUrls?.push(url);
            }
          }
        }
      }
    }
  }

  private async handlePairCommand(
    plugin: BasePlugin,
    msg: NormalizedMessage,
  ): Promise<void> {
    const code = msg.commandArgs?.[0];
    if (!code) {
      await plugin.sendMessage(msg.conversationId, {
        text: 'Usage: /pair <code>\nGet your code from the desktop app Settings → Channels.',
      });
      return;
    }
    const result = getPairingService().verifyAndPair(
      code,
      msg.configId,
      msg.platform,
      msg.userId,
      '',
    );
    if (result.success) {
      await plugin.sendMessage(msg.conversationId, {
        text: '✅ Paired successfully! You can now chat with the agent.',
      });
      await getAuditLog().write(
        'user_paired',
        result.user?.id ?? null,
        msg.platform,
        {},
      );
    } else {
      await plugin.sendMessage(msg.conversationId, {
        text: '❌ Invalid or expired code. Please try again.',
      });
    }
  }

  private async handleCommand(
    plugin: BasePlugin,
    msg: NormalizedMessage,
    user: ChannelUser,
  ): Promise<void> {
    switch (msg.commandName) {
      case 'new': {
        const session = getChannelSession(msg.configId, msg.sessionKey);
        if (session) {
          updateChannelSession(session.id, {
            status: 'archived',
            agent_session_id: null,
            agent_task_id: null,
          });
        }
        await plugin.sendMessage(msg.conversationId, {
          text: '🆕 New session started. Send your next message to begin.',
        });
        break;
      }
      case 'status': {
        const userWorkDir = resolveChannelWorkDir(
          msg.platform,
          msg.userId,
          undefined,
          msg.configId,
        );
        await plugin.sendMessage(msg.conversationId, {
          text: `Status: running ✅\nPlatform: ${msg.platform}\nUser: ${user.display_name ?? msg.userId}\nTier: ${user.permission_tier}\nWorkspace: ${userWorkDir}`,
        });
        break;
      }
      case 'budget': {
        const used = user.tokens_used_today;
        const limit =
          user.token_budget === 0 ? 'unlimited' : String(user.token_budget);
        await plugin.sendMessage(msg.conversationId, {
          text: `💰 Token budget\nUsed today: ${used.toLocaleString()}\nDaily limit: ${limit}`,
        });
        break;
      }
      case 'forget': {
        const qualifiedId = buildQualifiedUserId(
          msg.platform,
          msg.userId,
          msg.metadata,
        );
        const scopeId = `${msg.platform}:${qualifiedId}`;
        deleteMemoriesByScope('profile', scopeId);
        await plugin.sendMessage(msg.conversationId, {
          text: 'Your saved memories have been cleared.',
        });
        break;
      }
      case 'stop': {
        const active = this.activeRuns.get(msg.conversationId);
        if (active) {
          active.abortController.abort();
          deleteAgentSession(active.sessionId);
          this.activeRuns.delete(msg.conversationId);
          this.queuedMessages.delete(msg.conversationId);
          await plugin.sendMessage(msg.conversationId, {
            text: 'Cancelled.',
          });
        } else {
          await plugin.sendMessage(msg.conversationId, {
            text: 'Nothing running right now.',
          });
        }
        break;
      }
      default:
        await plugin.sendMessage(msg.conversationId, {
          text: 'Available commands: /new, /status, /budget, /forget, /stop',
        });
    }
  }

  /** In-memory cache for user profiles (display name + timezone). TTL: 1 hour. */
  private userProfileCache = new Map<
    string,
    { displayName: string | null; timezone: string | null; fetchedAt: number }
  >();

  private static readonly USER_PROFILE_TTL_MS = 3_600_000;
  private static readonly CACHE_MAX_SIZE = 2000;

  private missingScopeAPIs = new Set<string>();

  /** Evict oldest entries when a cache exceeds max size. */
  private evictCache<V extends { fetchedAt: number }>(
    cache: Map<string, V>,
  ): void {
    if (cache.size <= ChannelManager.CACHE_MAX_SIZE) return;
    // Delete the oldest 25% by insertion order (Map iterates in insertion order)
    const toDelete = Math.floor(cache.size / 4);
    const iter = cache.keys();
    for (let i = 0; i < toDelete; i++) {
      const key = iter.next().value;
      if (key) cache.delete(key);
    }
  }

  /**
   * Resolve user profile from the platform API (cached, 1h TTL).
   * Slack: calls users.info for real_name, display_name, and timezone.
   * Discord: reads authorName from message metadata (already resolved by discord.js).
   * Telegram: reads first_name + last_name from message metadata.
   */
  private async resolveUserProfile(
    plugin: BasePlugin,
    msg: NormalizedMessage,
  ): Promise<{ displayName: string | null; timezone: string | null }> {
    const cacheKey = `${msg.platform}:${msg.userId}`;
    const cached = this.userProfileCache.get(cacheKey);
    if (
      cached &&
      Date.now() - cached.fetchedAt < ChannelManager.USER_PROFILE_TTL_MS
    ) {
      return { displayName: cached.displayName, timezone: cached.timezone };
    }

    let displayName: string | null = null;
    let timezone: string | null = null;

    try {
      if (msg.platform === 'slack') {
        const scopeKey = `${msg.platform}:${msg.configId}:users.info`;
        if (this.missingScopeAPIs.has(scopeKey)) {
          return { displayName: null, timezone: null };
        }
        const client = plugin.getClient?.() as
          | import('@slack/web-api').WebClient
          | null;
        if (!client) return { displayName: null, timezone: null };
        const result = await client.users.info({ user: msg.userId });
        const user = result.user as
          | {
              real_name?: string;
              tz?: string;
              profile?: { display_name?: string };
            }
          | undefined;
        displayName = user?.profile?.display_name || user?.real_name || null;
        timezone = user?.tz || null;
      } else if (msg.platform === 'discord') {
        displayName = (msg.metadata?.authorName as string) || null;
      } else if (msg.platform === 'telegram') {
        const first = msg.metadata?.firstName as string | undefined;
        const last = msg.metadata?.lastName as string | undefined;
        displayName = first
          ? last
            ? `${first} ${last}`
            : first
          : (msg.metadata?.username as string) || null;
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : '';
      if (errMsg.includes('missing_scope')) {
        const scopeKey = `${msg.platform}:${msg.configId}:users.info`;
        if (!this.missingScopeAPIs.has(scopeKey)) {
          this.missingScopeAPIs.add(scopeKey);
          logger.warn(
            'Slack bot token is missing "users:read" scope — user display names and timezones will not be available. ' +
              'Add the scope in your Slack app settings and reinstall.',
          );
        }
      } else {
        logger.warn('Failed to resolve user profile', {
          platform: msg.platform,
          err,
        });
      }
    }

    this.evictCache(this.userProfileCache);
    this.userProfileCache.set(cacheKey, {
      displayName,
      timezone,
      fetchedAt: Date.now(),
    });
    return { displayName, timezone };
  }

  /** In-memory cache for channel info (name, topic, purpose). TTL: 1 hour. */
  private channelInfoCache = new Map<
    string,
    { name: string | null; topic: string | null; fetchedAt: number }
  >();

  private static readonly CHANNEL_INFO_TTL_MS = 3_600_000;

  /**
   * Resolve channel name and topic from the platform API.
   * Slack: calls conversations.info (cached per channel ID, 1h TTL).
   * Only useful for channel/group mentions — DMs have no meaningful name.
   */
  private async resolveChannelInfo(
    plugin: BasePlugin,
    msg: NormalizedMessage,
  ): Promise<{ name: string | null; topic: string | null }> {
    const channelType = msg.metadata?.channelType as string | undefined;
    // DMs and group DMs don't have meaningful channel names — skip the API call.
    if (channelType === 'im' || channelType === 'mpim') {
      return { name: null, topic: null };
    }

    const channelId = (msg.metadata?.channel as string) || '';
    if (!channelId) return { name: null, topic: null };

    // Check cache
    const cached = this.channelInfoCache.get(channelId);
    if (
      cached &&
      Date.now() - cached.fetchedAt < ChannelManager.CHANNEL_INFO_TTL_MS
    ) {
      return { name: cached.name, topic: cached.topic };
    }

    // Skip if we already know the scope is missing for this config.
    const scopeKey = `${msg.platform}:${msg.configId}:conversations.info`;
    if (this.missingScopeAPIs.has(scopeKey)) {
      return { name: null, topic: null };
    }

    try {
      if (msg.platform === 'slack') {
        const client = plugin.getClient?.() as
          | import('@slack/web-api').WebClient
          | null;
        if (!client) return { name: null, topic: null };
        const result = await client.conversations.info({ channel: channelId });
        const ch = result.channel as
          | {
              name?: string;
              topic?: { value?: string };
              purpose?: { value?: string };
            }
          | undefined;
        const name = ch?.name || null;
        const topic = ch?.topic?.value || ch?.purpose?.value || null;
        this.evictCache(this.channelInfoCache);
        this.channelInfoCache.set(channelId, {
          name,
          topic,
          fetchedAt: Date.now(),
        });
        return { name, topic };
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : '';
      if (errMsg.includes('missing_scope')) {
        if (!this.missingScopeAPIs.has(scopeKey)) {
          this.missingScopeAPIs.add(scopeKey);
          logger.warn(
            'Slack bot token is missing channel read scopes (channels:read, groups:read) — ' +
              'channel names and topics will not be available. ' +
              'Add the scopes in your Slack app settings and reinstall.',
          );
        }
        return { name: null, topic: null };
      }
      logger.warn('Failed to resolve channel info', {
        platform: msg.platform,
        channelId,
        err,
      });
    }
    return { name: null, topic: null };
  }

  private async sendSecurityResponse(
    plugin: BasePlugin,
    msg: NormalizedMessage,
    reason: string,
  ): Promise<void> {
    const messages: Record<string, string> = {
      not_paired:
        'You need to pair this account first. Ask your admin for a pairing code, then use /pair <code>.',
      permission_denied:
        'Your account has viewer-only access and cannot send messages to the agent.',
      rate_limited:
        'You are sending messages too quickly. Please wait a moment.',
      budget_exceeded:
        'Your daily token budget has been reached. Contact your admin.',
      guardrail_blocked: 'Your message was blocked by content policy.',
      duplicate: '',
    };
    const text = messages[reason];
    if (text) {
      await plugin.sendMessage(msg.conversationId, { text });
    }
  }

  private toPluginConfig(config: {
    id: string;
    platform: string;
    token: string | null;
    mode: string;
    guardrails_provider?: string;
    guardrails_fail_mode?: string;
    mention_only?: boolean;
    access_mode?: string;
  }): BasePluginConfig {
    return {
      configId: config.id,
      platform: config.platform as ChannelPlatform,
      token: config.token,
      mode: (config.mode ?? 'polling') as BasePluginConfig['mode'],
      guardrails_provider: (config.guardrails_provider ??
        'none') as BasePluginConfig['guardrails_provider'],
      guardrails_fail_mode: (config.guardrails_fail_mode ??
        'open') as BasePluginConfig['guardrails_fail_mode'],
      mention_only: config.mention_only ?? false,
      access_mode: (config.access_mode ??
        'open') as BasePluginConfig['access_mode'],
    };
  }

  /** Refresh (or create) the in-memory config for a plugin.
   *  Called after PUT /channels/config and before POST /start.
   *  Must handle first-time setup where no config entry exists yet,
   *  otherwise handleIncomingMessage() silently drops messages.
   *  Always resolves the real token from the vault — the DB token field
   *  is a VAULT_SENTINEL placeholder and must never be used at runtime. */
  refreshConfig(configId: string, dbConfig: ChannelConfig): void {
    const token = getChannelToken(configId);
    const existing = this.configs.get(configId);
    // Build the new non-token fields from DB config
    const updated = this.toPluginConfig({ ...dbConfig, token: null });
    // Preserve the real token: prefer vault, then existing in-memory token
    const realToken = token ?? existing?.token ?? null;
    this.configs.set(configId, { ...existing, ...updated, token: realToken });
  }

  getPlugin(configId: string): BasePlugin | undefined {
    return this.plugins.get(configId);
  }

  getCapabilities(configId: string): ChannelCapabilities | undefined {
    return this.plugins.get(configId)?.capabilities;
  }

  getRuntimeClass(configId: string): ChannelRuntimeClass | undefined {
    return this.getCapabilities(configId)?.runtimeClass;
  }

  /** Find the first running plugin for a given platform name (backward compat for automation delivery). */
  getPluginByPlatform(platform: string): BasePlugin | undefined {
    for (const plugin of this.plugins.values()) {
      if (plugin.platform === platform && plugin.state === 'running') {
        return plugin;
      }
    }
    return undefined;
  }

  getStatus(): Record<
    string,
    {
      platform: string;
      name: string | null;
      state: string;
      capabilities: ChannelCapabilities;
      runtimeClass: ChannelRuntimeClass;
    }
  > {
    const allConfigs = getAllChannelConfigs();
    const configMap = new Map(allConfigs.map((c) => [c.id, c]));
    return Object.fromEntries(
      [...this.plugins.entries()].map(([configId, v]) => {
        const cfg = configMap.get(configId);
        return [
          configId,
          {
            platform: v.platform,
            name: cfg?.name ?? null,
            state: v.state,
            capabilities: v.capabilities,
            runtimeClass: v.capabilities.runtimeClass,
          },
        ];
      }),
    );
  }
}

let channelManager: ChannelManager | null = null;

export function getChannelManager(): ChannelManager {
  if (!channelManager) {
    channelManager = new ChannelManager();
  }
  return channelManager;
}
