/**
 * Gateway Channel Types
 *
 * Core interfaces for channel adapters and message types.
 */

import os from 'node:os';

import { z } from 'zod';

// ============================================================================
// Channel Adapter Interface
// ============================================================================

export interface ChannelAdapter {
  readonly id: string;
  readonly name: string;
  readonly capabilities: ChannelCapabilities;

  connect(config: ChannelConfig): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  health(): ChannelHealth;

  sendMessage(chatId: string, content: OutboundContent): Promise<SendResult>;
  editMessage?(
    chatId: string,
    messageId: string,
    content: OutboundContent,
  ): Promise<void>;
  sendTyping?(chatId: string): Promise<void>;

  onMessage: (handler: InboundHandler) => void;
  onError: (handler: ErrorHandler) => void;
  onPresenceChange?: (handler: (health: ChannelHealth) => void) => void;
}

export type ChannelHealth =
  | 'connected'
  | 'degraded'
  | 'quarantined'
  | 'disabled';

export type ChannelRuntimeClass = 'official' | 'bridge' | 'experimental';

export interface ChannelCapabilities {
  maxMessageLength: number;
  supportsMarkdown: boolean;
  supportsThreads: boolean;
  supportsReactions: boolean;
  supportsImages: boolean;
  supportsButtons: boolean;
  supportsCommands: boolean;
  supportsEditMessage: boolean;
  supportsRichCards: boolean;
  runtimeClass: ChannelRuntimeClass;
}

export interface ChannelConfig {
  enabled: boolean;
  [key: string]: unknown;
}

// ============================================================================
// Message Types
// ============================================================================

export interface InboundAttachment {
  /** Remote URL of the attachment (e.g. Discord CDN) */
  url: string;
  /** MIME type (e.g. 'image/png') */
  contentType?: string;
  /** Original filename */
  filename?: string;
}

export interface InboundMessage {
  channelId: string;
  chatId: string;
  senderId: string;
  senderName: string;
  content: string;
  contentType: 'text' | 'command' | 'image' | 'file' | 'voice';
  /** Structured attachments (images, files) from the channel */
  attachments?: InboundAttachment[];
  /** Voice/audio metadata — present when contentType is 'voice' */
  voice?: VoiceMetadata;
  threadId?: string;
  replyToId?: string;
  messageId?: string;
  timestamp: string;
  raw: unknown;
}

/** Metadata for inbound voice/audio messages */
export interface VoiceMetadata {
  /** Local file path to the downloaded audio */
  filePath: string;
  /** MIME type of the audio (e.g., 'audio/ogg', 'audio/mpeg') */
  mimeType: string;
  /** Duration in seconds (if known from the platform) */
  durationSecs?: number;
  /** File size in bytes */
  sizeBytes?: number;
}

export interface OutboundFile {
  /** Absolute path to the file on disk */
  filePath: string;
  /** Optional display name (defaults to basename of filePath) */
  name?: string;
}

export interface OutboundContent {
  text: string;
  format?: 'plain' | 'markdown' | 'html';
  replyToId?: string;
  threadId?: string;
  buttons?: ActionButton[];
  /** File attachments (images, documents, audio, etc.) */
  files?: OutboundFile[];
}

export interface SendResult {
  messageId: string;
  success: boolean;
  error?: string;
}

export interface ActionButton {
  id: string;
  label: string;
  style?: 'primary' | 'danger' | 'default';
  action: string;
  payload?: string;
}

export interface ParsedCommand {
  name: string;
  args: string[];
  flags: Record<string, string>;
  raw: string;
}

// ============================================================================
// Permission Tiers
// ============================================================================

export type PermissionTier = 'viewer' | 'operator' | 'admin';

export const TIER_PERMISSIONS: Record<PermissionTier, string[]> = {
  viewer: ['help', 'status', 'task list', 'task status', 'budget'],
  operator: [
    'help',
    'status',
    'task list',
    'task status',
    'budget',
    'task create',
    'task stop',
    'subscribe',
    'unsubscribe',
    'approve',
    'deny',
    'send_message',
  ],
  admin: ['*'],
};

// ============================================================================
// Handler Types
// ============================================================================

export type InboundHandler = (message: InboundMessage) => Promise<void>;
export type ErrorHandler = (error: Error, context?: string) => void;

// ============================================================================
// Zod Schemas for Runtime Validation
// ============================================================================

export const InboundAttachmentSchema = z.object({
  url: z.string().url().max(2000),
  contentType: z.string().max(100).optional(),
  filename: z.string().max(500).optional(),
});

export const VoiceMetadataSchema = z.object({
  filePath: z
    .string()
    .max(500)
    .refine((p) => p.startsWith(os.tmpdir()), {
      message: 'Voice file path must be within the OS temp directory',
    }),
  mimeType: z.string().max(100),
  durationSecs: z.number().min(0).max(7200).optional(),
  sizeBytes: z.number().int().min(0).optional(),
});

export const InboundMessageSchema = z.object({
  channelId: z.string().min(1).max(50),
  chatId: z.string().min(1).max(200),
  senderId: z.string().min(1).max(200),
  senderName: z.string().max(200).default('Unknown'),
  content: z.string().max(100_000),
  contentType: z.enum(['text', 'command', 'image', 'file', 'voice']),
  attachments: z.array(InboundAttachmentSchema).max(20).optional(),
  voice: VoiceMetadataSchema.optional(),
  threadId: z.string().max(200).optional(),
  replyToId: z.string().max(200).optional(),
  messageId: z.string().max(200).optional(),
  timestamp: z.string(),
});

export const ParsedCommandSchema = z.object({
  name: z.string().min(1).max(50),
  args: z.array(z.string().max(1000)).max(20),
  flags: z.record(z.string(), z.string().max(100)),
  raw: z.string().max(2000),
});

// ============================================================================
// Outbound Pipeline
// ============================================================================

export interface PipelineContext {
  channel: ChannelAdapter;
  session: GatewaySession;
  identity: GatewayIdentity;
}

export interface OutboundPipelineStep {
  name: string;
  process(
    content: OutboundContent,
    ctx: PipelineContext,
  ): Promise<OutboundContent>;
}

// ============================================================================
// Gateway DB Row Types
// ============================================================================

export interface GatewayChannel {
  id: string;
  enabled: number;
  config: string;
  status: ChannelHealth | 'disconnected' | 'error';
  last_error: string | null;
  last_connected_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface GatewayIdentity {
  id: string;
  user_alias: string | null;
  permission_tier: PermissionTier;
  token_budget: number;
  tokens_used_today: number;
  budget_reset_at: string | null;
  created_at: string;
}

export interface GatewayIdentityChannel {
  id: string;
  identity_id: string;
  channel_id: string;
  channel_user_id: string;
  channel_username: string | null;
  metadata: string;
  created_at: string;
}

export interface GatewaySession {
  id: string;
  identity_id: string;
  channel_id: string;
  channel_chat_id: string;
  api_session_id: string | null;
  api_task_id: string | null;
  linked_session_id: string | null;
  status: 'active' | 'idle' | 'archived';
  context_summary: string | null;
  last_message_at: string | null;
  last_error: string | null;
  error_count: number;
  created_at: string;
  updated_at: string;
}

export interface GatewayMessage {
  id: string;
  session_id: string;
  direction: 'inbound' | 'outbound';
  channel_id: string;
  channel_message_id: string | null;
  content: string;
  content_type: string;
  metadata: string;
  token_count: number;
  status: 'pending' | 'delivered' | 'failed';
  created_at: string;
}

export interface GatewaySubscription {
  id: string;
  identity_id: string;
  channel_id: string;
  channel_chat_id: string;
  event_type: string;
  filter: string;
  enabled: number;
  created_at: string;
}

export interface GatewayAuditEntry {
  id: string;
  identity_id: string | null;
  channel_id: string | null;
  action: string;
  details: string;
  created_at: string;
}

export type GatewayIntent =
  | 'code'
  | 'research'
  | 'planning'
  | 'triage'
  | 'support'
  | '*';

export interface RoutingRule {
  id: string;
  workspace_id: string;
  channel_id: string;
  chat_pattern: string;
  intent: GatewayIntent;
  profile_id: string;
  model_override: string | null;
  priority: number;
  enabled: number;
  created_at: string;
  updated_at: string;
}
