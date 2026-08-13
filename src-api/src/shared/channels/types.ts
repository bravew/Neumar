import type { ChannelUser } from '@/shared/db/types';

// Re-export for convenience
export type { ChannelUser };

/** Voice/audio metadata for inbound voice messages */
export interface VoiceMessageInfo {
  /** Local file path to the downloaded audio */
  filePath: string;
  /** MIME type of the audio (e.g., 'audio/ogg', 'audio/mpeg') */
  mimeType: string;
  /** Duration in seconds (if known from the platform) */
  durationSecs?: number;
  /** File size in bytes */
  sizeBytes?: number;
}

// Canonical inbound message — all platforms normalize to this
export interface NormalizedMessage {
  platform: string;
  /** UUID of the channel_config row — the unique bot instance identity */
  configId: string;
  messageId: string | null;
  conversationId: string;
  sessionKey: string;
  userId: string;
  text: string;
  attachments?: string[];
  /** Voice/audio message metadata — present when user sends a voice note */
  voice?: VoiceMessageInfo;
  isCommand: boolean;
  commandName?: string;
  commandArgs?: string[];
  metadata?: Record<string, unknown>;
}

// Canonical outbound response
export interface NormalizedResponse {
  text: string;
  editMessageId?: string;
  buttons?: ChannelButton[];
  attachments?: string[];
  /**
   * When false, asks the platform to suppress link/media unfurls. Useful for
   * automation deliveries whose body already contains all relevant context —
   * auto-unfurls otherwise dominate the rendering.
   */
  unfurl?: boolean;
}

export type ChannelRuntimeClass = 'official' | 'bridge' | 'experimental';

// What a platform supports — declared by each plugin
export interface ChannelCapabilities {
  supportsEditMessage: boolean;
  supportsThreads: boolean;
  supportsButtons: boolean;
  supportsSelects: boolean;
  supportsModals: boolean;
  supportsDatePicker: boolean;
  supportsReactions: boolean;
  supportsTyping: boolean;
  supportsUnfurlControl: boolean;
  supportsFileUpload: boolean;
  maxMessageLength: number;
  maxAttachmentBytes: number;
  maxAttachmentsPerMessage: number;
  supportsMarkdown: 'none' | 'basic' | 'full';
  runtimeClass: ChannelRuntimeClass;
}

// Security context built by the pipeline for each message
export interface SecurityContext {
  channelUser: ChannelUser;
  rateLimitOk: boolean;
  budgetOk: boolean;
  guardrailsOk: boolean;
  wrappedText: string;
  nonce: string;
}

export interface ChannelButton {
  text: string;
  data: string;
}

export type PluginLifecycleState =
  | 'created'
  | 'initializing'
  | 'ready'
  | 'running'
  | 'stopping'
  | 'stopped';
export type ChannelPlatform =
  | 'telegram'
  | 'lark'
  | 'discord'
  | 'slack'
  | 'imessage'
  | 'whatsapp';
export type ChannelMode = 'polling' | 'webhook' | 'socket';

export interface BasePluginConfig {
  /** UUID of the channel_config row */
  configId: string;
  platform: ChannelPlatform;
  token: string | null;
  mode: ChannelMode;
  guardrails_provider: 'none' | 'anthropic' | 'llm-guard';
  guardrails_fail_mode: 'open' | 'closed';
  /** When true, only respond to messages that @-mention the bot in guild channels. */
  mention_only: boolean;
  /** 'open' = auto-approve new users on first message; 'gated' = require /pair code. */
  access_mode: 'open' | 'gated';
}

export type ChannelBusEvent =
  | { type: 'approval:requested'; approvalId: string }
  | { type: 'approval:decided'; approvalId: string; decision: string }
  | { type: 'task:created'; taskId: string; platform: string }
  | { type: 'task:completed'; taskId: string; platform: string }
  | { type: 'channel:paired'; platform: string; userId: string }
  | {
      type: 'channel:security_blocked';
      platform: string;
      userId: string;
      reason: string;
    };
