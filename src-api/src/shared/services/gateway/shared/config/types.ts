/**
 * Gateway Configuration Types
 *
 * Zod schemas for gateway.json validation.
 * Note: Zod 4 requires full default values for .default() on object schemas.
 */

import { z } from 'zod';

// ============================================================================
// URL Validation (SSRF protection per CLAUDE.md)
// ============================================================================

const PRIVATE_IP_RANGES = [
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^127\./,
  /^0\./,
  /^fc00:/i,
  /^fe80:/i,
  /^::1$/,
];

const BLOCKED_HOSTNAMES = [
  'metadata.google.internal',
  'metadata.google.internal.',
  'metadata.aws',
  '169.254.169.254',
  'metadata.azure.internal',
];

function isSafeWebhookUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost')
      return false;
    if (BLOCKED_HOSTNAMES.includes(parsed.hostname)) return false;
    // Strip brackets from IPv6 hostnames for regex matching (URL parses [::1] as [::1])
    const bareHostname = parsed.hostname.replace(/^\[|\]$/g, '');
    if (PRIVATE_IP_RANGES.some((re) => re.test(bareHostname))) return false;
    // Block 0.0.0.0 (wildcard bind address)
    if (bareHostname === '0.0.0.0' || bareHostname === '::') return false;
    return true;
  } catch {
    return false;
  }
}

const safeWebhookUrl = z.string().refine(isSafeWebhookUrl, {
  message:
    'Webhook URL must be HTTPS and not point to private/internal addresses',
});

// ============================================================================
// Channel Config Schemas
// ============================================================================

const TelegramConfigSchema = z.object({
  enabled: z.boolean().default(false),
  botToken: z.string().default(''),
  transport: z.enum(['polling', 'webhook']).default('polling'),
  webhookUrl: safeWebhookUrl.optional(),
  agentProfileId: z.string().nullable().default(null),
});

const DiscordConfigSchema = z.object({
  enabled: z.boolean().default(false),
  botToken: z.string().default(''),
  applicationId: z.string().default(''),
  guildIds: z.array(z.string()).optional(),
  agentProfileId: z.string().nullable().default(null),
});

const SlackConfigSchema = z.object({
  enabled: z.boolean().default(false),
  botToken: z.string().default(''),
  appToken: z.string().default(''),
  listenToDMs: z.boolean().default(true),
  listenToMentions: z.boolean().default(true),
  autoStart: z.boolean().default(false),
  agentProfileId: z.string().nullable().default(null),
});

const WhatsAppConfigSchema = z.object({
  enabled: z.boolean().default(false),
  authStorePath: z.string().default('store/whatsapp-auth'),
});

const SmsConfigSchema = z.object({
  enabled: z.boolean().default(false),
  provider: z.literal('twilio').default('twilio'),
  accountSid: z.string().default(''),
  authToken: z.string().default(''),
  fromNumber: z.string().default(''),
  webhookUrl: safeWebhookUrl.nullable().default(null),
});

const FeishuConfigSchema = z.object({
  enabled: z.boolean().default(false),
  appId: z.string().default(''),
  appSecret: z.string().default(''),
  agentProfileId: z.string().nullable().default(null),
});

// ============================================================================
// Security Config
// ============================================================================

const GuardrailsConfigSchema = z.object({
  provider: z.enum(['none', 'anthropic', 'llm-guard']).default('none'),
  failMode: z.enum(['open', 'closed']).default('open'),
  logBlocked: z.boolean().default(true),
});

const RateLimitConfigSchema = z.object({
  messagesPerMinute: z.number().int().min(1).max(1000).default(20),
  authAttemptsPerMinute: z.number().int().min(1).max(100).default(10),
  authLockoutSeconds: z.number().int().min(0).max(3600).default(300),
});

const ConcurrencyConfigSchema = z.object({
  maxAgentRunsPerIdentity: z.number().int().min(1).max(20).default(3),
});

const TokenBudgetConfigSchema = z.object({
  defaultDailyLimit: z.number().int().min(0).default(0),
  resetHourUTC: z.number().int().min(0).max(23).default(0),
  warningThreshold: z.number().min(0).max(1).default(0.8),
  enforcementMode: z.enum(['enforce', 'warn-only']).default('warn-only'),
});

const SecurityConfigSchema = z.object({
  defaultPermissionTier: z
    .enum(['viewer', 'operator', 'admin'])
    .default('viewer'),
  guardrails: GuardrailsConfigSchema.default({
    provider: 'none',
    failMode: 'open',
    logBlocked: true,
  }),
  rateLimiting: RateLimitConfigSchema.default({
    messagesPerMinute: 20,
    authAttemptsPerMinute: 10,
    authLockoutSeconds: 300,
  }),
  concurrency: ConcurrencyConfigSchema.default({ maxAgentRunsPerIdentity: 3 }),
  tokenBudget: TokenBudgetConfigSchema.default({
    defaultDailyLimit: 0,
    resetHourUTC: 0,
    warningThreshold: 0.8,
    enforcementMode: 'warn-only',
  }),
});

// ============================================================================
// Channel Restart Policy
// ============================================================================

const ChannelRestartConfigSchema = z.object({
  maxRetries: z.number().int().min(0).max(100).default(10),
  baseDelayMs: z.number().int().min(1000).max(60000).default(5000),
  maxDelayMs: z.number().int().min(5000).max(600000).default(300000),
  jitterFactor: z.number().min(0).max(1).default(0.3),
  resetAfterMs: z.number().int().min(60000).max(3600000).default(600000),
});

// ============================================================================
// Notifications Config
// ============================================================================

const NotificationsConfigSchema = z.object({
  enabled: z.boolean().default(true),
  defaultEvents: z
    .array(z.string())
    .default(['task_complete', 'task_error', 'tool_approval']),
  toolApprovalTimeoutSeconds: z.number().int().min(30).max(3600).default(300),
});

// ============================================================================
// Media / CDN Config
// ============================================================================

const CdnConfigSchema = z.object({
  enabled: z.boolean().default(false),
  /** S3-compatible endpoint (e.g. https://<account>.r2.cloudflarestorage.com) */
  endpoint: z.string().default(''),
  /** Bucket name */
  bucket: z.string().default(''),
  /** Access key ID */
  accessKeyId: z.string().default(''),
  /** Secret access key */
  secretAccessKey: z.string().default(''),
  /** AWS region (use 'auto' for Cloudflare R2) */
  region: z.string().default('auto'),
  /** Public URL prefix for public buckets (e.g. https://cdn.example.com) */
  publicUrlPrefix: z.string().optional(),
  /** Presigned URL expiry in seconds (default: 7 days) */
  presignedExpirySecs: z.number().int().min(60).default(604800),
  /** Path prefix within bucket */
  pathPrefix: z.string().default('gateway-media/'),
});

const MediaConfigSchema = z.object({
  /** Enable video/audio compression for oversized files */
  compressionEnabled: z.boolean().default(true),
  /** CDN upload for files that can't be compressed to fit */
  cdn: CdnConfigSchema.default({
    enabled: false,
    endpoint: '',
    bucket: '',
    accessKeyId: '',
    secretAccessKey: '',
    region: 'auto',
    presignedExpirySecs: 604800,
    pathPrefix: 'gateway-media/',
  }),
});

// ============================================================================
// Voice Transcription Config
// ============================================================================

const VoiceTranscriptionConfigSchema = z.object({
  /** Enable automatic voice-to-text transcription for inbound voice messages */
  enabled: z.boolean().default(true),
  /** Preferred STT provider name (e.g. 'openai', 'deepgram'). Empty = auto-detect. */
  preferredProvider: z.string().default(''),
  /** BCP-47 language hint for better accuracy (e.g. 'en', 'zh'). Empty = auto-detect. */
  language: z.string().default(''),
  /** Max audio file size in bytes to attempt transcription (default 25 MB) */
  maxFileSizeBytes: z
    .number()
    .int()
    .min(0)
    .default(25 * 1024 * 1024),
});

// ============================================================================
// Full Gateway Config
// ============================================================================

export const GatewayConfigSchema = z.object({
  gateway: z
    .object({
      enabled: z.boolean().default(false),
      logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    })
    .default({ enabled: false, logLevel: 'info' }),
  channels: z
    .object({
      telegram: TelegramConfigSchema.default({
        enabled: false,
        botToken: '',
        transport: 'polling',
        agentProfileId: null,
      }),
      discord: DiscordConfigSchema.default({
        enabled: false,
        botToken: '',
        applicationId: '',
        agentProfileId: null,
      }),
      slack: SlackConfigSchema.default({
        enabled: false,
        botToken: '',
        appToken: '',
        listenToDMs: true,
        listenToMentions: true,
        autoStart: false,
        agentProfileId: null,
      }),
      whatsapp: WhatsAppConfigSchema.default({
        enabled: false,
        authStorePath: 'store/whatsapp-auth',
      }),
      sms: SmsConfigSchema.default({
        enabled: false,
        provider: 'twilio',
        accountSid: '',
        authToken: '',
        fromNumber: '',
        webhookUrl: null,
      }),
      feishu: FeishuConfigSchema.default({
        enabled: false,
        appId: '',
        appSecret: '',
        agentProfileId: null,
      }),
    })
    .default({
      telegram: {
        enabled: false,
        botToken: '',
        transport: 'polling',
        agentProfileId: null,
      },
      discord: {
        enabled: false,
        botToken: '',
        applicationId: '',
        agentProfileId: null,
      },
      slack: {
        enabled: false,
        botToken: '',
        appToken: '',
        listenToDMs: true,
        listenToMentions: true,
        autoStart: false,
        agentProfileId: null,
      },
      whatsapp: { enabled: false, authStorePath: 'store/whatsapp-auth' },
      sms: {
        enabled: false,
        provider: 'twilio',
        accountSid: '',
        authToken: '',
        fromNumber: '',
        webhookUrl: null,
      },
      feishu: {
        enabled: false,
        appId: '',
        appSecret: '',
        agentProfileId: null,
      },
    }),
  security: SecurityConfigSchema.default({
    defaultPermissionTier: 'viewer',
    guardrails: { provider: 'none', failMode: 'open', logBlocked: true },
    rateLimiting: {
      messagesPerMinute: 20,
      authAttemptsPerMinute: 10,
      authLockoutSeconds: 300,
    },
    concurrency: { maxAgentRunsPerIdentity: 3 },
    tokenBudget: {
      defaultDailyLimit: 0,
      resetHourUTC: 0,
      warningThreshold: 0.8,
      enforcementMode: 'warn-only',
    },
  }),
  routing: z
    .object({
      defaultSessionMode: z
        .enum(['per-channel', 'unified'])
        .default('per-channel'),
      commandPrefix: z.string().default('/'),
    })
    .default({ defaultSessionMode: 'per-channel', commandPrefix: '/' }),
  channelRestart: ChannelRestartConfigSchema.default({
    maxRetries: 10,
    baseDelayMs: 5000,
    maxDelayMs: 300000,
    jitterFactor: 0.3,
    resetAfterMs: 600000,
  }),
  notifications: NotificationsConfigSchema.default({
    enabled: true,
    defaultEvents: ['task_complete', 'task_error', 'tool_approval'],
    toolApprovalTimeoutSeconds: 300,
  }),
  media: MediaConfigSchema.default({
    compressionEnabled: true,
    cdn: {
      enabled: false,
      endpoint: '',
      bucket: '',
      accessKeyId: '',
      secretAccessKey: '',
      region: 'auto',
      presignedExpirySecs: 604800,
      pathPrefix: 'gateway-media/',
    },
  }),
  voiceTranscription: VoiceTranscriptionConfigSchema.default({
    enabled: true,
    preferredProvider: '',
    language: '',
    maxFileSizeBytes: 25 * 1024 * 1024,
  }),
});

export type GatewayConfig = z.infer<typeof GatewayConfigSchema>;
export type TelegramConfig = z.infer<typeof TelegramConfigSchema>;
export type DiscordConfig = z.infer<typeof DiscordConfigSchema>;
export type SlackChannelConfig = z.infer<typeof SlackConfigSchema>;
export type WhatsAppConfig = z.infer<typeof WhatsAppConfigSchema>;
export type SmsConfig = z.infer<typeof SmsConfigSchema>;
export type FeishuConfig = z.infer<typeof FeishuConfigSchema>;

/** Per-channel Zod schemas for input validation in admin API */
export const ChannelConfigSchemas = {
  telegram: TelegramConfigSchema,
  discord: DiscordConfigSchema,
  slack: SlackConfigSchema,
  whatsapp: WhatsAppConfigSchema,
  sms: SmsConfigSchema,
  feishu: FeishuConfigSchema,
} as const;
