// Settings types and storage for AI provider configuration

// ============================================================================
// Backend Sync
// ============================================================================

import { useSyncExternalStore } from 'react';

import { API_BASE_URL } from '@/config';
import { APP_DB_NAME, APP_SLUG, branding } from '@/config/branding';

import { getAppDataDir, getMcpConfigPath } from '../lib/paths';
import { mergeProviderKeys, persistProviderKeys } from '../lib/stronghold';
import type { FolderPermission } from '../types/folder-permissions';

/** Provider category for UI grouping */
export type ProviderCategory =
  | 'main'
  | 'cloud'
  | 'inference'
  | 'local'
  | 'gateway'
  | 'specialized';

export interface AIProvider {
  id: string;
  name: string;
  apiKey: string;
  baseUrl: string;
  enabled: boolean;
  models: string[];
  /** Explicit backend wire contract for OpenAI-compatible providers. */
  dialect?: 'standard' | 'kimi-k3';
  // Extended fields for UI
  icon?: string;
  apiKeyUrl?: string;
  canDelete?: boolean;
  /** Agent type override (e.g., 'openai-compat' for OpenAI-compatible providers).
   *  Local CLI runtime ids (`cursor-agent`, `qwen`, `copilot`) are canonical
   *  `/agent-runtimes` ids and must match the backend agent plugin ids. */
  agentType?:
    | 'claude'
    | 'codex'
    | 'open-agent-sdk'
    | 'openai-compat'
    | 'gemini'
    | 'cursor-agent'
    | 'qwen'
    | 'copilot'
    | 'kimi'
    | 'atomcode';
  /** Billing classification: api (pay-per-use), subscription (covered by plan), free */
  billingType?: 'api' | 'subscription' | 'free';
  /** Plan name when billingType is 'subscription' (e.g., 'claude-max', 'chatgpt-pro') */
  billingScope?: string;
  /** Maps model name → model_pricing.model_id. Survives model renames. */
  modelPricingIds?: Record<string, string>;
  /** UI grouping category */
  category?: ProviderCategory;
  /**
   * Default model IDs already seeded by {@link migrateProviders}. Tracked so
   * user-deleted defaults are not silently re-added on subsequent loads;
   * each default is inserted at most once per installation.
   */
  introducedDefaultModels?: string[];
}

/**
 * Whether a provider is ready to use (has credentials or doesn't need them).
 * Used for sidebar indicators, sort order, and model-routing dropdowns.
 */
export function isProviderReady(p: AIProvider): boolean {
  // Subscription/free providers are always ready
  if (p.billingType === 'subscription' || p.billingType === 'free') return true;
  // Cloud/inference providers need an API key
  if (p.apiKey) return true;
  // Local providers are ready if enabled (user has opted in)
  if (p.category === 'local' && p.enabled) return true;
  return false;
}

export interface MCPServer {
  id: string;
  name: string;
  type: 'stdio' | 'http';
  command?: string;
  args?: string[];
  url?: string;
  enabled: boolean;
}

// ============================================================================
// Sandbox Provider Settings
// ============================================================================

export type SandboxProviderType =
  | 'docker'
  | 'native'
  | 'e2b'
  | 'codex'
  | 'claude'
  | 'custom';

export interface SandboxProviderSetting {
  id: string;
  type: SandboxProviderType;
  name: string;
  enabled: boolean;
  config: Record<string, unknown>;
}

export const defaultSandboxProviders: SandboxProviderSetting[] = [
  {
    id: 'codex',
    type: 'codex',
    name: 'OpenAI Codex Sandbox',
    enabled: true,
    config: {
      defaultTimeout: 120000,
    },
  },
  {
    id: 'native',
    type: 'native',
    name: 'Native (No Isolation)',
    enabled: true,
    config: {
      shell: '/bin/bash',
      defaultTimeout: 120000,
    },
  },
];

// ============================================================================
// Agent Runtime Settings
// ============================================================================

export type AgentRuntimeType = 'claude' | 'codex' | 'custom';

export interface AgentRuntimeSetting {
  id: string;
  type: AgentRuntimeType;
  name: string;
  enabled: boolean;
  config: {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    executablePath?: string;
    [key: string]: unknown;
  };
}

export const defaultAgentRuntimes: AgentRuntimeSetting[] = [
  {
    id: 'claude',
    type: 'claude',
    name: 'Claude Code',
    enabled: true,
    config: {
      model: 'claude-sonnet-5',
    },
  },
  {
    id: 'codex',
    type: 'codex',
    name: 'OpenAI Codex CLI',
    enabled: false,
    config: {
      model: 'codex',
    },
  },
];

// ============================================================================
// Model Routing Configuration
// ============================================================================

/**
 * Task types that can have dedicated model assignments.
 *
 * Based on industry best practices for multi-model agentic AI systems:
 * - Different task phases have different quality/cost/latency needs
 * - Frontier models for reasoning-heavy tasks, fast models for simple tasks
 * - Users can optimize cost by routing only hard tasks to expensive models
 */
export type TaskType =
  | 'planning'
  | 'execution'
  | 'titleGeneration'
  | 'research'
  | 'codeReview';

/** Human-readable labels for each task type */
export const TASK_TYPE_LABELS: Record<TaskType, string> = {
  planning: 'Planning',
  execution: 'Execution',
  titleGeneration: 'Title Generation',
  research: 'Research',
  codeReview: 'Code Review',
};

/** Descriptions explaining what each task type does */
export const TASK_TYPE_DESCRIPTIONS: Record<TaskType, string> = {
  planning:
    'Analyzes tasks and generates step-by-step plans. Benefits from strong reasoning models.',
  execution:
    'Carries out plan steps with tool use and code generation. Needs balanced speed and capability.',
  titleGeneration:
    'Creates short conversation titles. A fast, cheap model is ideal.',
  research:
    'Gathers information, searches the web, and synthesizes findings. Benefits from large context windows.',
  codeReview:
    'Reviews code for bugs, security issues, and best practices. Benefits from code-specialized models.',
};

/** Recommended model tiers for each task type */
export const TASK_TYPE_RECOMMENDED_TIER: Record<
  TaskType,
  'frontier' | 'balanced' | 'fast'
> = {
  planning: 'frontier',
  execution: 'balanced',
  titleGeneration: 'fast',
  research: 'frontier',
  codeReview: 'balanced',
};

/**
 * A specific provider + model assignment for a task type.
 * When `provider` is 'default', uses the global default provider/model.
 */
export interface ModelRouteConfig {
  provider: string; // Provider ID (e.g., 'openrouter', 'ollama') or 'default'
  model: string; // Model name (e.g., 'anthropic/claude-sonnet-4.5') or empty for default
}

/**
 * Model routing configuration — assigns different provider+model combos
 * to different task types for optimal cost/quality/latency balance.
 *
 * Each field is optional; when undefined or set to provider='default',
 * the global defaultProvider + defaultModel is used (backward compatible).
 */
export interface ModelRoutingConfig {
  planning?: ModelRouteConfig;
  execution?: ModelRouteConfig;
  titleGeneration?: ModelRouteConfig;
  research?: ModelRouteConfig;
  codeReview?: ModelRouteConfig;
}

// ============================================================================
// Model Capability Detection — Re-exported from shared utility
// ============================================================================

export type { ModelCapability } from '../lib/model-capabilities';
export {
  MODEL_CAPABILITY_META,
  CAPABILITY_DISPLAY_ORDER,
  detectModelCapabilities,
  isAgentCapableModel,
  isNonChatModel,
  getPrimaryCapability,
} from '../lib/model-capabilities';

export interface UserProfile {
  nickname: string;
  avatar: string; // URL or base64 data
  /** Free-text custom instructions applied to every conversation (like Claude Desktop) */
  customInstructions: string;
  /** Preferred response style: 'concise' | 'detailed' | 'auto' */
  responseStyle: 'concise' | 'detailed' | 'auto';
  /** Preferred tone: 'professional' | 'casual' | 'friendly' | 'auto' */
  tone: 'professional' | 'casual' | 'friendly' | 'auto';
  /** Whether to enable proactive suggestions in responses */
  proactiveSuggestions: boolean;
  /** Preferred coding style when generating code: 'commented' | 'minimal' | 'auto' */
  codeStyle: 'commented' | 'minimal' | 'auto';
}

/**
 * Preset accent color identifiers.
 *
 * The first value ('brand') must match branding.json's theme.accentColorId.
 * If you rebrand and change the accentColorId, update this union accordingly.
 *
 * NOTE: We use explicit literal types instead of `typeof branding.theme.accentColorId`
 * because BrandingConfig types accentColorId as `string`, which would collapse
 * the entire union to `string` and defeat type safety.
 */
export type AccentColor =
  | 'brand'
  | 'purple'
  | 'orange'
  | 'blue'
  | 'green'
  | 'pink'
  | 'red'
  | 'sage';

// Runtime validation: ensure branding.json's accentColorId is a valid AccentColor.
// This logs an error immediately on module load if the brand config doesn't match.
const VALID_ACCENT_IDS: ReadonlySet<string> = new Set<AccentColor>([
  'brand',
  'purple',
  'orange',
  'blue',
  'green',
  'pink',
  'red',
  'sage',
]);
if (!VALID_ACCENT_IDS.has(branding.theme.accentColorId)) {
  if (import.meta.env.DEV) {
    console.error(
      `[Settings] branding.json accentColorId "${branding.theme.accentColorId}" ` +
        `is not in the AccentColor union. Add it to the AccentColor type in settings.ts.`,
    );
  }
}

export const accentColors: {
  id: AccentColor;
  name: string;
  color: string;
  darkColor: string;
}[] = [
  {
    id: branding.theme.accentColorId as AccentColor,
    name: branding.theme.accentColorName,
    color: branding.theme.primaryColor,
    darkColor: branding.theme.primaryColorDark,
  },
  {
    id: 'blue',
    name: 'Blue',
    color: 'oklch(0.5469 0.1914 262.881)',
    darkColor: 'oklch(0.6232 0.1914 262.881)',
  },
  {
    id: 'purple',
    name: 'Purple',
    color: 'oklch(0.5412 0.1879 293.541)',
    darkColor: 'oklch(0.6135 0.1879 293.541)',
  },
  {
    id: 'orange',
    name: 'Orange',
    color: 'oklch(0.6716 0.1368 48.513)',
    darkColor: 'oklch(0.7214 0.1337 49.9802)',
  },
  {
    id: 'green',
    name: 'Green',
    color: 'oklch(0.5966 0.1397 149.214)',
    darkColor: 'oklch(0.6489 0.1397 149.214)',
  },
  {
    id: 'pink',
    name: 'Pink',
    color: 'oklch(0.6171 0.1762 349.761)',
    darkColor: 'oklch(0.6894 0.1762 349.761)',
  },
  {
    id: 'red',
    name: 'Red',
    color: 'oklch(0.5772 0.2077 27.325)',
    darkColor: 'oklch(0.6495 0.2077 27.325)',
  },
  {
    id: 'sage',
    name: 'Sage',
    color: 'oklch(0.4531 0.0891 152.535)', // Dark forest green
    darkColor: 'oklch(0.5654 0.1091 152.535)',
  },
];

// Background style presets
export type BackgroundStyle = 'default' | 'warm' | 'cool';

export const backgroundStyles: {
  id: BackgroundStyle;
  name: string;
  description: string;
}[] = [
  { id: 'default', name: 'Default', description: 'Clean neutral background' },
  { id: 'warm', name: 'Warm', description: 'Cozy cream and beige tones' },
  { id: 'cool', name: 'Cool', description: 'Crisp blue-gray tones' },
];

// ============================================================================
// Speech Settings
// ============================================================================

export interface SpeechConfig {
  // TTS
  ttsEnabled: boolean; // Master TTS toggle
  ttsProvider: string; // 'auto', 'local', or provider ID
  ttsVoice: string; // Default voice ID (e.g., 'alloy', 'kokoro-0')
  ttsSpeed: number; // 0.5 - 2.0 (default: 1.0)
  ttsFormat: 'mp3' | 'opus' | 'wav' | 'pcm'; // pcm = lowest latency for streaming
  ttsAutoRead: 'off' | 'always'; // Auto-read assistant messages
  ttsStreaming: boolean; // Play as LLM generates (sentence-by-sentence POST)

  // STT
  sttEnabled: boolean; // Master STT toggle
  sttProvider: string; // 'auto', 'local', or provider ID
  sttLanguage: string; // BCP-47 language hint ('' = auto-detect)
  sttStreaming: boolean; // Live transcription via WebSocket
  sttVadEnabled: boolean; // Stop/finalize capture automatically on speech end
  sttPttKey: string; // KeyboardEvent.code used for push-to-talk
  sttPartialDebounceMs: number; // Debounce partial transcript rendering

  // Conversation mode (Phase 7)
  conversationMode: boolean; // Enable full-duplex voice conversation
  vadSensitivity: number; // 0.0-1.0 speech detection threshold (default: 0.5)
  silenceThreshold: number; // ms before end-of-turn (default: 600)
  bargeInEnabled: boolean; // Allow interrupting agent mid-speech (default: true)
  fillerAudioEnabled: boolean; // Play thinking sounds during LLM processing
  echoCancellationMode: 'auto' | 'half-duplex'; // AEC fallback strategy

  // Voice cloning
  voiceCloningEnabled: boolean; // Enable voice cloning sub-section in TTS

  // Audio capture
  inputFormat: 'pcm-16k' | 'webm-opus'; // AudioWorklet PCM (primary) or MediaRecorder (fallback)
}

// ============================================================================
// Media Generation Configuration
// ============================================================================

/**
 * Controls which adapter the media-generation router picks when no caller
 * passes an explicit `provider`. Mirrors the `SpeechConfig` sentinel pattern:
 * `'auto'` (or empty) means "let the router decide".
 *
 * Optional `defaultImage/VideoModel` fields are reserved for a future iteration
 * that lets users pin a specific model (e.g. `gpt-image-2`); they are not read
 * by the router in v1 but are accepted to keep the schema forward-compatible.
 */
export interface MediaConfig {
  /** Preferred image adapter name or alias (e.g. 'codex', 'byteplus', 'auto') */
  defaultImageProvider: string;
  /** Optional explicit image model (reserved for future use) */
  defaultImageModel: string;
  /** Preferred video adapter name or alias */
  defaultVideoProvider: string;
  /** Optional explicit video model (reserved for future use) */
  defaultVideoModel: string;
}

export const DEFAULT_MEDIA_CONFIG: MediaConfig = {
  defaultImageProvider: 'auto',
  defaultImageModel: '',
  defaultVideoProvider: 'auto',
  defaultVideoModel: '',
};

// ============================================================================
// Search Service Configuration
// ============================================================================

/** A single configured search provider entry. */
export interface SearchProviderEntry {
  id: string;
  name: string;
  enabled: boolean;
  apiKey: string;
  baseUrl?: string;
  config?: Record<string, string>;
  priority: number;
}

/** Search service configuration (mirrors backend SearchConfig). */
export interface SearchConfig {
  enabled: boolean;
  mode: 'auto' | 'always' | 'manual';
  providers: SearchProviderEntry[];
  maxResults: number;
  timeoutSeconds: number;
  cacheTtlMinutes: number;
  defaultCountry?: string;
  defaultLanguage?: string;
  safeSearch: 'off' | 'moderate' | 'strict';
}

export interface DesignModeSettingsConfig {
  enabled: boolean;
  /**
   * Route the design composer through the conversational agent chat loop
   * (Fix-sync Phase 02) for agentic surfaces instead of the one-shot media
   * dispatcher. On by default; an absent value is treated as enabled so the
   * chat creates real artifacts. Set to `false` to fall back to the media
   * dispatcher. Pure media surfaces (image/video/audio) ignore this — they are
   * not chat surfaces and always use the dispatcher.
   */
  chatLoop?: boolean;
  defaultDesignSystemId: string;
  defaultSkillId: string;
  customInstructions: string;
  tokenChannelEnabled: boolean;
  aiDisclosureDefault: boolean;
  strictProviderMode: boolean;
  routineSchedulerEnabled: boolean;
  media: {
    aliases: Record<string, string>;
  };
  ui: {
    commentRailCollapsed: Record<string, boolean>;
    viewMode: Record<string, string>;
  };
  critique: {
    rolloutPhase: 'M0' | 'M1' | 'M2' | 'M3' | 'GA';
    userOverride: 'auto' | 'on' | 'off';
    promotedAt: Partial<Record<'M0' | 'M1' | 'M2' | 'M3' | 'GA', string>>;
  };
  telemetry: {
    enabled: boolean;
    sendIdentity: boolean;
    sendAssistantText: boolean;
    sendArtifactManifests: boolean;
    categories: {
      runs: boolean;
      schedules: boolean;
      errors: boolean;
    };
  };
  budgets: {
    maxImageGenerations: number;
    maxVideoJobs: number;
    maxVideoSeconds: number;
    maxAudioSeconds: number;
    maxRetryCount: number;
    maxStorageBytes: number;
  };
}

export const DEFAULT_SEARCH_CONFIG: SearchConfig = {
  enabled: false,
  mode: 'auto',
  providers: [],
  maxResults: 5,
  timeoutSeconds: 10,
  cacheTtlMinutes: 15,
  safeSearch: 'moderate',
};

export const DEFAULT_DESIGN_MODE_SETTINGS: DesignModeSettingsConfig = {
  enabled: true,
  chatLoop: true,
  defaultDesignSystemId: '',
  defaultSkillId: '',
  customInstructions: '',
  tokenChannelEnabled: true,
  aiDisclosureDefault: true,
  strictProviderMode: false,
  routineSchedulerEnabled: false,
  media: {
    aliases: {},
  },
  ui: {
    commentRailCollapsed: {},
    viewMode: {},
  },
  critique: {
    rolloutPhase: 'M0',
    userOverride: 'auto',
    promotedAt: { M0: new Date(0).toISOString() },
  },
  telemetry: {
    enabled: false,
    sendIdentity: false,
    sendAssistantText: false,
    sendArtifactManifests: false,
    categories: {
      runs: true,
      schedules: true,
      errors: true,
    },
  },
  budgets: {
    maxImageGenerations: 25,
    maxVideoJobs: 5,
    maxVideoSeconds: 60,
    maxAudioSeconds: 300,
    maxRetryCount: 3,
    maxStorageBytes: 1024 * 1024 * 1024,
  },
};

export type PublishVersioningMode =
  | 'provider-native'
  | 'content-addressable'
  | 'timestamped-folder'
  | 'overwrite';

export interface PublishDestinationDefaults {
  autoPublish: boolean;
  versioningMode: PublishVersioningMode;
  schedule: string;
  disclosure: string;
}

export interface PublishSettingsConfig {
  enabled: boolean;
  rcloneBridgeEnabled: boolean;
  c2paSignerMode: 'test' | 'workspace' | 'cloud';
  workspaceConnectionsOnly: boolean;
  destinations: Record<string, PublishDestinationDefaults>;
}

export const DEFAULT_PUBLISH_DESTINATIONS: Record<
  string,
  PublishDestinationDefaults
> = {
  'local-archive': {
    autoPublish: true,
    versioningMode: 'content-addressable',
    schedule: '',
    disclosure: '',
  },
  gdrive: {
    autoPublish: true,
    versioningMode: 'provider-native',
    schedule: '',
    disclosure: '',
  },
  immich: {
    autoPublish: true,
    versioningMode: 'content-addressable',
    schedule: '',
    disclosure: '',
  },
  webdav: {
    autoPublish: true,
    versioningMode: 'timestamped-folder',
    schedule: '',
    disclosure: '',
  },
  youtube: {
    autoPublish: false,
    versioningMode: 'provider-native',
    schedule: '',
    disclosure: 'Created with AI assistance in Neuma.',
  },
  tiktok: {
    autoPublish: false,
    versioningMode: 'provider-native',
    schedule: '',
    disclosure: 'Created with AI assistance in Neuma.',
  },
};

export const DEFAULT_PUBLISH_SETTINGS: PublishSettingsConfig = {
  enabled: false,
  rcloneBridgeEnabled: false,
  c2paSignerMode: 'test',
  workspaceConnectionsOnly: true,
  destinations: DEFAULT_PUBLISH_DESTINATIONS,
};

export interface ModesSettingsConfig {
  automateEnabled: boolean;
  chatEnabled: boolean;
  videoEnabled: boolean;
  order: string[];
}

export const DEFAULT_MODES_SETTINGS: ModesSettingsConfig = {
  automateEnabled: true,
  chatEnabled: false,
  videoEnabled: true,
  order: ['tasks', 'design', 'video', 'automate', 'chat'],
};

export interface PetPosition {
  right: number;
  bottom: number;
}

export interface PetWindowPosition {
  x: number;
  y: number;
}

export type PetSource = 'builtin' | 'custom';

export interface PetCustomSelection {
  id: string;
  name: string;
  description: string;
  accent: string;
  glyph: string;
  greeting: string;
  sourceUrl?: string;
}

export interface PetSettingsConfig {
  enabled: boolean;
  activePetId: string;
  activePetSource: PetSource;
  customPet: PetCustomSelection | null;
  showAgentActivity: boolean;
  position: PetPosition;
  windowPosition: PetWindowPosition;
}

export const DEFAULT_PET_SETTINGS: PetSettingsConfig = {
  enabled: false,
  activePetId: 'clippit',
  activePetSource: 'builtin',
  customPet: null,
  showAgentActivity: true,
  position: { right: 24, bottom: 24 },
  windowPosition: { x: 64, y: 64 },
};

export interface Settings {
  // User profile
  profile: UserProfile;

  // AI Provider settings
  providers: AIProvider[];
  defaultProvider: string;
  defaultModel: string;

  // MCP settings - path to mcp.json config file
  mcpConfigPath: string;
  mcpEnabled: boolean; // Enable MCP mounting during agent conversations
  mcpUserDirEnabled: boolean; // Enable loading MCP servers from user directory (claude config)
  mcpAppDirEnabled: boolean; // Enable loading MCP servers from app directory
  /** Let other apps call Neumar over the inbound MCP server */
  externalMcpEnabled: boolean;
  externalMcpWritesEnabled: boolean;
  externalMcpAgentRunsEnabled: boolean;
  externalMcpResultLimit: number;

  // Skills settings
  skillsPath: string;
  skillsEnabled: boolean; // Enable skills mounting during agent conversations
  skillsUserDirEnabled: boolean; // Enable loading skills from user directory (~/.claude/skills)
  skillsAppDirEnabled: boolean; // Enable loading skills from app directory (workspace/skills)

  // Workspace settings
  workDir: string; // Working directory for sessions and outputs
  allowedFolders: FolderPermission[]; // Per-folder permissions (Cowork-style consent)

  // Sandbox settings
  sandboxEnabled: boolean; // Enable sandbox mode for script execution
  sandboxProviders: SandboxProviderSetting[]; // Available sandbox providers
  defaultSandboxProvider: string; // Default sandbox provider ID

  // Agent Runtime settings
  agentRuntimes: AgentRuntimeSetting[]; // Available agent runtimes
  defaultAgentRuntime: string; // Default agent runtime ID

  // Model Routing — per-task-type model assignments
  modelRouting: ModelRoutingConfig;

  // Conversation History settings
  maxConversationTurns: number; // Maximum conversation turns to keep in history (default: 20)
  maxHistoryTokens: number; // Maximum tokens for conversation history (default: 2000)

  // Connector settings
  linearEnabled: boolean;
  slackEnabled: boolean;
  connectors: {
    showDuplicateComposioAdapters: boolean;
  };

  // Auth / Integration settings
  googleAuthEnabled: boolean;
  slackAuthEnabled: boolean;
  notionAuthEnabled: boolean;
  autoRefreshTokens: boolean;

  // System permission preferences (tracked for UI state; actual grants are OS-level)
  microphoneEnabled: boolean;
  screenRecordingEnabled: boolean;
  accessibilityEnabled: boolean;

  // Agent behavior
  planMode: 'off' | 'auto' | 'on'; // Plan mode: off=skip planning, auto=auto-approve, on=wait for approval
  autoPlayMedia: boolean; // Automatically play media (video/audio) when selected in workspace
  ptcEnabled: boolean; // Enable Programmatic Tool Calling for batch operations
  runOnStartup: boolean; // Launch the app automatically when the computer starts
  notifyOnCompletion: boolean; // Send OS notification when agent finishes a response
  notifySoundEnabled: boolean; // Play synthesized completion sounds
  notifySuccessSoundId: string; // Selected synthesized success sound
  notifyFailureSoundId: string; // Selected synthesized failure sound
  notifyWhileFocused: boolean; // Show success OS notifications while focused

  // General settings
  theme: 'light' | 'dark' | 'system';
  accentColor: AccentColor;
  backgroundStyle: BackgroundStyle;
  language: string;

  // Accessibility
  uiZoom: number; // 50–200 (percentage), controls root font-size for rem scaling

  // Speech settings (TTS + STT)
  speech: SpeechConfig;

  // Media generation settings (image/video adapter defaults)
  media: MediaConfig;

  // Search service settings
  search: SearchConfig;

  // DesignMode settings
  designMode: DesignModeSettingsConfig;

  // Publish pipeline settings
  publish: PublishSettingsConfig;

  // UI preferences (local-only, not synced to backend)
  lastSelectedChatModel: string;
  modes: ModesSettingsConfig;
  pets: PetSettingsConfig;

  // Feature flags
  advancedMode: boolean; // Enable advanced/experimental features (Org View, etc.)
  artifactsV2: boolean; // Enable Phase-3 live artifacts + generative-UI pipeline
}

// ============================================================================
// AI Provider Configuration
// ============================================================================

// BytePlus ModelArk model list — single source of truth for frontend
// IMPORTANT: Model IDs must include the date suffix (e.g., -251215) to match the API.
// See https://docs.byteplus.com/en/docs/ModelArk/model_id for the full list.
export const BYTEPLUS_MODELS = [
  // Text / reasoning models
  'seed-1-8-251228',
  'deepseek-v3-2-251201',
  'kimi-k2-250905',
  'deepseek-r1-250528',
  'seed-1-6-flash-250715',
  'glm-4-7-251222',
  // Image generation (Seedream) — newest last so pickModel defaults to it
  'seedream-4-5-251128',
  'seedream-5-0-lite-260128',
  'seedream-5-0-260128',
  // Video generation (Seedance) — IDs include date suffix as required by the API
  'seedance-1-0-lite-250328',
  'seedance-1-0-pro-250626',
  'dreamina-seedance-2-0-fast-260128',
] as const;

// Google Gemini model list — single source of truth for frontend
// Covers text/reasoning, image generation, audio/TTS, video generation, and embeddings.
// See https://ai.google.dev/gemini-api/docs/models for the full list.
export const GEMINI_MODELS = [
  // Text / reasoning models (GA)
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  // Text / reasoning models (Preview)
  'gemini-3-flash-preview',
  'gemini-3-pro-preview',
  'gemini-3.1-pro-preview',
  'gemini-3.1-pro-preview-customtools',
  // Image generation
  'gemini-2.5-flash-preview-image-generation',
  'gemini-3-pro-image-preview',
  'imagen-3.0-generate-002',
  // Audio / TTS
  'gemini-2.5-flash-native-audio-preview',
  'gemini-2.5-flash-preview-tts',
  'gemini-2.5-pro-preview-tts',
  // Video generation
  'veo-3.1-generate-preview',
  // Embeddings
  'gemini-embedding-001',
] as const;

// Default providers with full configuration
export const defaultProviders: AIProvider[] = [
  // ── Main Agents (native SDK integrations) ──
  {
    id: 'claude',
    name: 'Anthropic Claude',
    apiKey: '',
    baseUrl: '',
    enabled: true,
    models: [
      'claude-sonnet-5',
      'claude-opus-5',
      'claude-opus-4-8',
      'claude-opus-4-7',
      'claude-opus-4-6',
      'claude-sonnet-4-6',
      'claude-haiku-4-5-20251001',
      'claude-sonnet-4-5-20250929',
      'claude-3-5-sonnet-20241022',
      'claude-3-5-haiku-20241022',
    ],
    icon: 'A',
    canDelete: false,
    agentType: 'claude',
    billingType: 'subscription',
    billingScope: 'claude-max',
    category: 'main',
  },
  {
    id: 'codex',
    name: 'OpenAI Codex',
    apiKey: '',
    baseUrl: '',
    enabled: true,
    models: [
      'codex:gpt-5.5',
      'codex:gpt-5.4',
      'codex:gpt-5.4-mini',
      'codex:gpt-5.3-codex',
      'codex:gpt-5.3-codex-spark',
    ],
    icon: 'C',
    canDelete: false,
    agentType: 'codex',
    billingType: 'subscription',
    billingScope: 'chatgpt-pro',
    category: 'main',
  },
  {
    id: 'google-gemini',
    name: 'Google Gemini',
    apiKey: '',
    baseUrl: 'https://generativelanguage.googleapis.com',
    enabled: true,
    models: [...GEMINI_MODELS],
    icon: 'G',
    apiKeyUrl: 'https://aistudio.google.com/apikey',
    canDelete: true,
    agentType: 'gemini',
    category: 'main',
  },

  // ── Cloud Providers (Tier 1: Frontier) ──
  {
    id: 'openai',
    name: 'OpenAI',
    apiKey: '',
    baseUrl: 'https://api.openai.com/v1',
    enabled: false,
    models: [
      'gpt-5.5-pro',
      'gpt-5.5',
      'gpt-5.4',
      'gpt-5.4-mini',
      'gpt-5.4-nano',
      'o3',
      'o3-pro',
    ],
    icon: 'O',
    apiKeyUrl: 'https://platform.openai.com/api-keys',
    canDelete: true,
    agentType: 'openai-compat',
    category: 'cloud',
  },
  {
    id: 'azure-openai',
    name: 'Azure OpenAI',
    apiKey: '',
    baseUrl: 'https://{your-resource}.openai.azure.com/openai/v1',
    enabled: false,
    models: ['gpt-4o', 'gpt-4o-mini', 'o3-mini'],
    icon: 'A',
    apiKeyUrl:
      'https://portal.azure.com/#view/Microsoft_Azure_ProjectOxford/CognitiveServicesHub',
    canDelete: true,
    agentType: 'openai-compat',
    category: 'cloud',
  },
  {
    id: 'azure-foundry',
    name: 'Azure AI Foundry',
    apiKey: '',
    baseUrl: 'https://{your-resource}.services.ai.azure.com/openai/v1',
    enabled: false,
    models: ['DeepSeek-R1', 'Meta-Llama-3.1-405B-Instruct', 'Mistral-large'],
    icon: 'A',
    apiKeyUrl: 'https://ai.azure.com',
    canDelete: true,
    agentType: 'openai-compat',
    category: 'cloud',
  },
  {
    id: 'bedrock',
    name: 'Amazon Bedrock',
    apiKey: '',
    baseUrl: 'https://bedrock-mantle.us-east-1.api.aws/v1',
    enabled: false,
    models: [
      'mistral.mistral-large-3-675b-instruct',
      'qwen.qwen3-235b-a22b-2507',
      'deepseek.v3.1',
    ],
    icon: 'B',
    apiKeyUrl: 'https://console.aws.amazon.com/bedrock',
    canDelete: true,
    agentType: 'openai-compat',
    category: 'cloud',
  },
  {
    id: 'xai',
    name: 'xAI (Grok)',
    apiKey: '',
    baseUrl: 'https://api.x.ai/v1',
    enabled: false,
    models: [
      'grok-4-1-fast-reasoning',
      'grok-4-1-fast-non-reasoning',
      'grok-3',
      'grok-3-mini',
      'grok-2-vision',
    ],
    icon: 'X',
    apiKeyUrl: 'https://console.x.ai',
    canDelete: true,
    agentType: 'openai-compat',
    category: 'cloud',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    apiKey: '',
    baseUrl: 'https://api.deepseek.com/v1',
    enabled: false,
    models: ['deepseek-chat', 'deepseek-reasoner'],
    icon: 'D',
    apiKeyUrl: 'https://platform.deepseek.com/api_keys',
    canDelete: true,
    agentType: 'openai-compat',
    category: 'cloud',
  },
  {
    id: 'mistral',
    name: 'Mistral AI',
    apiKey: '',
    baseUrl: 'https://api.mistral.ai/v1',
    enabled: false,
    models: [
      'mistral-large-latest',
      'mistral-small-latest',
      'codestral-latest',
      'ministral-8b-latest',
    ],
    icon: 'M',
    apiKeyUrl: 'https://console.mistral.ai/api-keys',
    canDelete: true,
    agentType: 'openai-compat',
    category: 'cloud',
  },
  {
    id: 'moonshot-global',
    name: 'Kimi API (K3)',
    apiKey: '',
    baseUrl: 'https://api.moonshot.ai/v1',
    enabled: false,
    models: ['kimi-k3'],
    icon: 'K',
    apiKeyUrl: 'https://platform.moonshot.ai/console/api-keys',
    canDelete: true,
    agentType: 'openai-compat',
    dialect: 'kimi-k3',
    category: 'cloud',
  },

  // ── Inference Providers (Tier 2: Fast/Cheap) ──
  {
    id: 'groq',
    name: 'Groq',
    apiKey: '',
    baseUrl: 'https://api.groq.com/openai/v1',
    enabled: false,
    models: [
      'gpt-oss-120b',
      'llama-4-scout-17b-16e',
      'qwen3-32b',
      'llama-3.3-70b',
    ],
    icon: 'G',
    apiKeyUrl: 'https://console.groq.com/keys',
    canDelete: true,
    agentType: 'openai-compat',
    category: 'inference',
  },
  {
    id: 'together',
    name: 'Together AI',
    apiKey: '',
    baseUrl: 'https://api.together.xyz/v1',
    enabled: false,
    models: [
      'meta-llama/Llama-4-Maverick-17B-128E-Instruct',
      'deepseek-ai/DeepSeek-R1',
    ],
    icon: 'T',
    apiKeyUrl: 'https://api.together.xyz/settings/api-keys',
    canDelete: true,
    agentType: 'openai-compat',
    category: 'inference',
  },
  {
    id: 'fireworks',
    name: 'Fireworks AI',
    apiKey: '',
    baseUrl: 'https://api.fireworks.ai/inference/v1',
    enabled: false,
    models: ['accounts/fireworks/models/llama-4-maverick-instruct-basic'],
    icon: 'F',
    apiKeyUrl: 'https://fireworks.ai/account/api-keys',
    canDelete: true,
    agentType: 'openai-compat',
    category: 'inference',
  },
  {
    id: 'cerebras',
    name: 'Cerebras',
    apiKey: '',
    baseUrl: 'https://api.cerebras.ai/v1',
    enabled: false,
    models: ['qwen3-235b', 'llama-3.3-70b', 'gpt-oss-120b'],
    icon: 'C',
    apiKeyUrl: 'https://cloud.cerebras.ai/platform',
    canDelete: true,
    agentType: 'openai-compat',
    category: 'inference',
  },
  {
    id: 'perplexity',
    name: 'Perplexity',
    apiKey: '',
    baseUrl: 'https://api.perplexity.ai',
    enabled: false,
    models: ['sonar', 'sonar-pro', 'sonar-reasoning-pro'],
    icon: 'P',
    apiKeyUrl: 'https://www.perplexity.ai/settings/api',
    canDelete: true,
    agentType: 'openai-compat',
    category: 'inference',
  },
  {
    id: 'sambanova',
    name: 'SambaNova',
    apiKey: '',
    baseUrl: 'https://api.sambanova.ai/v1',
    enabled: false,
    models: ['Llama-4-Maverick-17B-128E-Instruct', 'DeepSeek-R1-0528'],
    icon: 'S',
    apiKeyUrl: 'https://cloud.sambanova.ai/apis',
    canDelete: true,
    agentType: 'openai-compat',
    category: 'inference',
  },

  // ── Gateways ──
  {
    id: 'openrouter',
    name: 'OpenRouter',
    apiKey: '',
    baseUrl: 'https://openrouter.ai/api',
    enabled: true,
    models: [
      'openai/gpt-4o-mini',
      'qwen/qwen-2.5-72b-instruct',
      'google/gemini-2.5-flash',
    ],
    icon: 'O',
    apiKeyUrl: 'https://openrouter.ai/keys',
    canDelete: true,
    agentType: 'openai-compat',
    category: 'gateway',
  },

  // ── Local Models ──
  {
    id: 'ollama',
    name: 'Ollama',
    apiKey: '',
    baseUrl: 'http://localhost:11434',
    enabled: true,
    models: ['glm-4.7-flash'],
    icon: 'O',
    apiKeyUrl: 'https://docs.ollama.com/integrations/claude-code',
    canDelete: true,
    category: 'local',
  },
  {
    id: 'lmstudio',
    name: 'LM Studio',
    apiKey: '',
    baseUrl: 'http://localhost:1234',
    enabled: false,
    models: [],
    icon: 'L',
    apiKeyUrl: 'https://lmstudio.ai/docs',
    canDelete: true,
    agentType: 'openai-compat',
    category: 'local',
  },
  {
    id: 'vllm',
    name: 'vLLM',
    apiKey: '',
    baseUrl: 'http://localhost:8000',
    enabled: false,
    models: [],
    icon: 'V',
    canDelete: true,
    agentType: 'openai-compat',
    category: 'local',
  },
  {
    id: 'jan',
    name: 'Jan.ai',
    apiKey: '',
    baseUrl: 'http://localhost:1337',
    enabled: false,
    models: [],
    icon: 'J',
    apiKeyUrl: 'https://jan.ai/docs',
    canDelete: true,
    agentType: 'openai-compat',
    category: 'local',
  },
  {
    id: 'gpt4all',
    name: 'GPT4All',
    apiKey: '',
    baseUrl: 'http://localhost:4891',
    enabled: false,
    models: [],
    icon: '4',
    canDelete: true,
    agentType: 'openai-compat',
    category: 'local',
  },
  {
    id: 'localai',
    name: 'LocalAI',
    apiKey: '',
    baseUrl: 'http://localhost:8080',
    enabled: false,
    models: [],
    icon: 'L',
    canDelete: true,
    agentType: 'openai-compat',
    category: 'local',
  },
  {
    id: 'llamacpp',
    name: 'llama-server',
    apiKey: '',
    baseUrl: 'http://localhost:8080',
    enabled: false,
    models: [],
    icon: 'C',
    canDelete: true,
    agentType: 'openai-compat',
    category: 'local',
  },
  {
    id: 'koboldcpp',
    name: 'KoboldCpp',
    apiKey: '',
    baseUrl: 'http://localhost:5001',
    enabled: false,
    models: [],
    icon: 'K',
    canDelete: true,
    agentType: 'openai-compat',
    category: 'local',
  },
  {
    id: 'tgi',
    name: 'TGI (HuggingFace)',
    apiKey: '',
    baseUrl: 'http://localhost:8080',
    enabled: false,
    models: [],
    icon: 'H',
    canDelete: true,
    agentType: 'openai-compat',
    category: 'local',
  },

  // ── Specialized ──
  {
    id: 'byteplus',
    name: 'BytePlus ModelArk',
    apiKey: '',
    baseUrl: 'https://ark.ap-southeast.bytepluses.com/api/v3',
    enabled: true,
    models: [...BYTEPLUS_MODELS],
    icon: 'B',
    apiKeyUrl: 'https://console.byteplus.com/en/model-ark/api-key',
    canDelete: true,
    agentType: 'openai-compat',
    category: 'cloud',
  },
  {
    id: 'hedra',
    name: 'Hedra',
    apiKey: '',
    baseUrl: 'https://api.hedra.com/web-app/public',
    enabled: false,
    models: ['hedra:character-3'],
    icon: 'H',
    apiKeyUrl: 'https://www.hedra.com/api',
    canDelete: true,
    category: 'specialized',
  },
  {
    id: 'heygen',
    name: 'HeyGen',
    apiKey: '',
    baseUrl: 'https://api.heygen.com/v2',
    enabled: false,
    models: ['heygen:avatar-iv'],
    icon: 'H',
    apiKeyUrl: 'https://app.heygen.com/settings?nav=API',
    canDelete: true,
    category: 'specialized',
  },
  {
    id: 'omnihuman',
    name: 'BytePlus OmniHuman',
    apiKey: '',
    baseUrl: 'https://ark.ap-southeast.bytepluses.com/api/v3',
    enabled: false,
    models: ['omnihuman-v1-5'],
    icon: 'O',
    apiKeyUrl: 'https://console.byteplus.com/en/model-ark/api-key',
    canDelete: true,
    category: 'specialized',
  },
  {
    id: 'veed-fabric',
    name: 'VEED Fabric',
    apiKey: '',
    baseUrl: 'https://api.veed.io',
    enabled: false,
    models: ['veed-fabric-1-0'],
    icon: 'V',
    apiKeyUrl: 'https://www.veed.io/api',
    canDelete: true,
    category: 'specialized',
  },
  {
    id: 'elevenlabs',
    name: 'ElevenLabs',
    apiKey: '',
    baseUrl: 'https://api.elevenlabs.io',
    enabled: true,
    models: ['eleven_flash_v2_5', 'eleven_multilingual_v2', 'scribe_v2'],
    icon: 'E',
    apiKeyUrl: 'https://elevenlabs.io/app/settings/api-keys',
    canDelete: true,
    category: 'specialized',
  },
];

// Default provider IDs that cannot be deleted (derived from defaultProviders)
export const defaultProviderIds = defaultProviders
  .filter((p) => p.canDelete === false)
  .map((p) => p.id);

// Popular models for each provider (derived from defaultProviders + extra providers)
export const providerDefaultModels: Record<string, string[]> = {
  // Auto-generate from defaultProviders
  ...Object.fromEntries(defaultProviders.map((p) => [p.id, p.models])),
  // Extra providers not in defaultProviders but known
  anthropic: [
    'claude-sonnet-5',
    'claude-opus-5',
    'claude-opus-4-8',
    'claude-opus-4-7',
    'claude-opus-4-6',
    'claude-sonnet-4-6',
    'claude-haiku-4-5-20251001',
    'claude-sonnet-4-5-20250929',
  ],
  // Tier 2 inference extras (not in defaultProviders)
  deepinfra: ['meta-llama/Llama-4-Maverick-17B-128E-Instruct'],
  nebius: ['deepseek-ai/DeepSeek-V3-0324'],
  cohere: ['command-r-plus', 'command-r'],
  // Fallback for unknown providers
  default: [],
};

// Model suggestions for custom providers (matched by name pattern)
export const customProviderModels: Record<string, string[]> = {
  deepseek: ['deepseek-chat', 'deepseek-coder', 'deepseek-reasoner'],
  moonshot: ['kimi-k3'],
  kimi: ['kimi-k3'],
  qwen: ['qwen-max', 'qwen-plus', 'qwen-turbo'],
  byteplus: [...BYTEPLUS_MODELS],
  gemini: [...GEMINI_MODELS],
  groq: ['gpt-oss-120b', 'llama-4-scout-17b-16e', 'qwen3-32b', 'llama-3.3-70b'],
  together: [
    'meta-llama/Llama-4-Maverick-17B-128E-Instruct',
    'deepseek-ai/DeepSeek-R1',
    'Qwen/Qwen3-235B-A22B',
  ],
  fireworks: ['accounts/fireworks/models/llama-4-maverick-instruct-basic'],
  cerebras: ['qwen3-235b', 'llama-3.3-70b', 'gpt-oss-120b'],
  perplexity: ['sonar', 'sonar-pro', 'sonar-reasoning-pro'],
  sambanova: ['Llama-4-Maverick-17B-128E-Instruct', 'DeepSeek-R1-0528'],
  xai: [
    'grok-4-1-fast-reasoning',
    'grok-4-1-fast-non-reasoning',
    'grok-3',
    'grok-3-mini',
  ],
  mistral: [
    'mistral-large-latest',
    'mistral-small-latest',
    'codestral-latest',
    'ministral-8b-latest',
  ],
};

// Default settings
// Note: Path values are placeholders that get resolved at initialization
// to platform-specific paths (e.g., ~/Library/Application Support/ on macOS)
export const defaultSettings: Settings = {
  profile: {
    nickname: 'Guest',
    avatar: '',
    customInstructions: '',
    responseStyle: 'auto',
    tone: 'auto',
    proactiveSuggestions: true,
    codeStyle: 'auto',
  },
  providers: defaultProviders,
  defaultProvider: 'default', // Use environment variables by default
  defaultModel: '',
  mcpConfigPath: '', // Will be resolved to app data dir at init
  mcpEnabled: true, // Enable MCP by default
  mcpUserDirEnabled: true, // Enable user directory MCP by default
  mcpAppDirEnabled: true, // Enable app directory MCP by default
  externalMcpEnabled: false,
  externalMcpWritesEnabled: false,
  externalMcpAgentRunsEnabled: false,
  externalMcpResultLimit: 50,
  skillsPath: '', // Will be resolved to app data dir at init
  skillsEnabled: true, // Enable skills by default
  skillsUserDirEnabled: true, // Enable user directory skills by default
  skillsAppDirEnabled: true, // Enable app directory skills by default
  workDir: '', // Will be resolved to app data dir at init
  allowedFolders: [], // No folders allowed by default
  sandboxEnabled: true,
  sandboxProviders: defaultSandboxProviders,
  defaultSandboxProvider: 'codex', // Default to Codex sandbox, fallback to native
  agentRuntimes: defaultAgentRuntimes,
  defaultAgentRuntime: 'claude', // Default to Claude Code
  modelRouting: {}, // Empty = all task types use the global defaultProvider + defaultModel
  maxConversationTurns: 20, // Default: 20 conversation turns
  maxHistoryTokens: 2000, // Default: 2000 tokens for history
  linearEnabled: false,
  slackEnabled: false,
  connectors: {
    showDuplicateComposioAdapters: false,
  },
  googleAuthEnabled: false,
  slackAuthEnabled: false,
  notionAuthEnabled: false,
  autoRefreshTokens: true,
  microphoneEnabled: false,
  screenRecordingEnabled: false,
  accessibilityEnabled: false,
  planMode: 'on',
  autoPlayMedia: false,
  ptcEnabled: false,
  runOnStartup: false,
  notifyOnCompletion: true,
  notifySoundEnabled: false,
  notifySuccessSoundId: 'ding',
  notifyFailureSoundId: 'buzz',
  notifyWhileFocused: false,
  speech: {
    ttsEnabled: false,
    ttsProvider: 'auto',
    ttsVoice: 'alloy',
    ttsSpeed: 1.0,
    ttsFormat: 'pcm',
    ttsAutoRead: 'off',
    ttsStreaming: true,
    sttEnabled: false,
    sttProvider: 'auto',
    sttLanguage: '',
    sttStreaming: true,
    sttVadEnabled: true,
    sttPttKey: 'Space',
    sttPartialDebounceMs: 80,
    conversationMode: false,
    vadSensitivity: 0.5,
    silenceThreshold: 600,
    bargeInEnabled: true,
    fillerAudioEnabled: true,
    echoCancellationMode: 'auto',
    voiceCloningEnabled: false,
    inputFormat: 'pcm-16k',
  },
  media: { ...DEFAULT_MEDIA_CONFIG },
  search: {
    enabled: false,
    mode: 'auto',
    providers: [],
    maxResults: 5,
    timeoutSeconds: 10,
    cacheTtlMinutes: 15,
    safeSearch: 'moderate',
  },
  designMode: { ...DEFAULT_DESIGN_MODE_SETTINGS },
  publish: {
    ...DEFAULT_PUBLISH_SETTINGS,
    destinations: { ...DEFAULT_PUBLISH_DESTINATIONS },
  },
  theme: 'system',
  accentColor: branding.theme.accentColorId as AccentColor,
  backgroundStyle: 'default',
  language: '', // Empty string triggers system language detection on first run
  uiZoom: 100,
  lastSelectedChatModel: '', // Empty = use DEFAULT_MODEL_ID
  modes: { ...DEFAULT_MODES_SETTINGS },
  pets: {
    ...DEFAULT_PET_SETTINGS,
    position: { ...DEFAULT_PET_SETTINGS.position },
    windowPosition: { ...DEFAULT_PET_SETTINGS.windowPosition },
  },
  advancedMode: false,
  artifactsV2: false,
};

const DB_NAME = `sqlite:${APP_DB_NAME}`;

// ============================================================================
// Backend-Synced Settings
// ============================================================================

/**
 * Settings keys that are synced to the backend API for cross-runtime consistency.
 * UI-only preferences (theme, accentColor, backgroundStyle, language) stay local.
 */
const BACKEND_SYNCED_KEYS: (keyof Settings)[] = [
  'workDir',
  'providers',
  'defaultProvider',
  'defaultModel',
  'modelRouting',
  'sandboxEnabled',
  'sandboxProviders',
  'defaultSandboxProvider',
  'agentRuntimes',
  'defaultAgentRuntime',
  'maxConversationTurns',
  'maxHistoryTokens',
  'mcpEnabled',
  'mcpUserDirEnabled',
  'mcpAppDirEnabled',
  'externalMcpEnabled',
  'externalMcpWritesEnabled',
  'externalMcpAgentRunsEnabled',
  'externalMcpResultLimit',
  'skillsEnabled',
  'skillsUserDirEnabled',
  'skillsAppDirEnabled',
  'linearEnabled',
  'slackEnabled',
  'connectors',
  'googleAuthEnabled',
  'slackAuthEnabled',
  'notionAuthEnabled',
  'autoRefreshTokens',
  'planMode',
  'ptcEnabled',
  'speech',
  'media',
  'designMode',
  'publish',
];

/**
 * Sync critical settings to the backend API (fire-and-forget).
 * Uses the existing /db/settings/:key endpoints. Failures are silently
 * logged — the backend may not be running in browser-only mode.
 */
async function syncCriticalSettingsToBackend(
  settings: Settings,
): Promise<void> {
  try {
    const syncedSettings = sanitizeSettings(settings);
    const entries = BACKEND_SYNCED_KEYS.map((key) => ({
      key,
      value: JSON.stringify(syncedSettings[key]),
    }));

    // Send all settings in parallel for speed
    await Promise.allSettled(
      entries.map(({ key, value }) =>
        fetch(`${API_BASE_URL}/db/settings/${key}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ value }),
        }),
      ),
    );
  } catch {
    // Backend may not be available — this is expected in some environments
  }
}

/**
 * Load settings from the backend API.
 * Returns a partial settings object with only the keys the backend has,
 * or null if the backend is unreachable.
 */
async function loadSettingsFromBackend(): Promise<Partial<Settings> | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/db/settings`);
    if (!response.ok) return null;

    const data = (await response.json()) as Record<string, string>;
    const partial: Partial<Settings> = {};

    for (const [key, value] of Object.entries(data)) {
      try {
        (partial as Record<string, unknown>)[key] = JSON.parse(value);
      } catch {
        // Skip invalid JSON values
      }
    }

    return partial;
  } catch {
    // Backend unavailable
    return null;
  }
}

function sanitizeSettings(settings: Settings): Settings {
  const connectors = {
    ...defaultSettings.connectors,
    ...((settings as { connectors?: Settings['connectors'] }).connectors ?? {}),
  } as Settings['connectors'] & { platformV2?: unknown };
  delete connectors.platformV2;

  return {
    ...settings,
    connectors,
  };
}

/**
 * Strip API keys from providers before writing to localStorage.
 * Keys are sensitive and should only persist in SQLite (Tauri) or the
 * backend process — never in the WebView's localStorage.
 */
function stripApiKeysForStorage(settings: Settings): Settings {
  const sanitized = sanitizeSettings(settings);
  return {
    ...sanitized,
    providers: sanitized.providers.map((p) => ({ ...p, apiKey: '' })),
  };
}

// Check if running in Tauri environment synchronously
function isTauriSync(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  const hasTauriInternals = '__TAURI_INTERNALS__' in window;
  const hasTauri = '__TAURI__' in window;
  return hasTauriInternals || hasTauri;
}

// In-memory cache for settings
let settingsCache: Settings | null = null;

// Tauri database instance
let db: Awaited<
  ReturnType<typeof import('@tauri-apps/plugin-sql').default.load>
> | null = null;

// Initialize database connection (only in Tauri)
async function getDatabase() {
  if (!isTauriSync()) {
    return null;
  }

  if (!db) {
    try {
      const Database = (await import('@tauri-apps/plugin-sql')).default;
      db = await Database.load(DB_NAME);
    } catch (error) {
      console.error('[Settings] Failed to connect to SQLite:', error);
      return null;
    }
  }
  return db;
}

/**
 * Apply provider migrations to a loaded settings object:
 * 1. Add any missing default providers.
 * 2. Sync the `name` of non-deletable default providers (keeps display names
 *    up-to-date when they are renamed in code, e.g. "Codex" → "OpenAI Codex").
 * 3. Additively merge new default models into existing providers so upgrades
 *    surface newly-released models (e.g. dreamina-seedance-2-0-fast-260128)
 *    without wiping user-added models.
 */
function migrateProviders(providers: AIProvider[]): AIProvider[] {
  const result = [...providers];
  for (const def of defaultProviders) {
    const idx = result.findIndex((p) => p.id === def.id);
    if (idx === -1) {
      // New providers that can be deleted start disabled to avoid UI clutter.
      // Non-deletable (main agent) providers keep their default enabled state.
      const added = def.canDelete !== false ? { ...def, enabled: false } : def;
      result.push(added);
      continue;
    }

    let updated = result[idx]!;

    if (def.canDelete === false && updated.name !== def.name) {
      updated = { ...updated, name: def.name };
    }

    if (updated.agentType === undefined && def.agentType !== undefined) {
      updated = { ...updated, agentType: def.agentType };
    }
    if (updated.dialect === undefined && def.dialect !== undefined) {
      updated = { ...updated, dialect: def.dialect };
    }
    if (updated.category === undefined && def.category !== undefined) {
      updated = { ...updated, category: def.category };
    }
    if (updated.icon === undefined && def.icon !== undefined) {
      updated = { ...updated, icon: def.icon };
    }
    if (updated.apiKeyUrl === undefined && def.apiKeyUrl !== undefined) {
      updated = { ...updated, apiKeyUrl: def.apiKeyUrl };
    }
    if (updated.canDelete === undefined && def.canDelete !== undefined) {
      updated = { ...updated, canDelete: def.canDelete };
    }

    // Additive: seed any new default model exactly once per installation.
    // Tracks previously-introduced IDs in `introducedDefaultModels` so a user
    // who deletes a default model won't find it silently re-added next load.
    if (def.models?.length) {
      const introduced = new Set(updated.introducedDefaultModels ?? []);
      const existing = new Set(updated.models ?? []);
      const toAdd = def.models.filter(
        (m) => !introduced.has(m) && !existing.has(m),
      );
      const toRecord = def.models.filter((m) => !introduced.has(m));
      if (toAdd.length > 0 || toRecord.length > 0) {
        updated = {
          ...updated,
          models:
            toAdd.length > 0
              ? [...(updated.models ?? []), ...toAdd]
              : updated.models,
          introducedDefaultModels: [
            ...(updated.introducedDefaultModels ?? []),
            ...toRecord,
          ],
        };
      }
    }

    if (updated !== result[idx]) {
      result[idx] = updated;
    }
  }
  return result;
}

/**
 * Supplement provider API keys from the backend settings DB.
 * Called after vault merge when some enabled API providers still have no key.
 * The backend receives the full providers array (including API keys) via
 * syncCriticalSettingsToBackend(), so it acts as a reliable key recovery
 * source when the Stronghold vault is unavailable or corrupted.
 */
async function supplementProviderKeysFromBackend(
  providers: AIProvider[],
): Promise<AIProvider[]> {
  const hasMissingKey = providers.some((p) => !p.apiKey);
  if (!hasMissingKey) return providers;

  const backendSettings = await loadSettingsFromBackend();
  const backendProviders = backendSettings?.providers as
    | AIProvider[]
    | undefined;
  if (!backendProviders?.length) return providers;

  const backendKeyMap = new Map(
    backendProviders.filter((p) => p.apiKey).map((p) => [p.id, p.apiKey]),
  );
  if (backendKeyMap.size === 0) return providers;

  return providers.map((p) => {
    if (p.apiKey) return p;
    const backendKey = backendKeyMap.get(p.id);
    return backendKey ? { ...p, apiKey: backendKey } : p;
  });
}

// Get settings from database (async version)
export async function getSettingsAsync(): Promise<Settings> {
  // Return cached settings if available
  if (settingsCache) {
    return settingsCache;
  }

  const database = await getDatabase();

  if (database) {
    try {
      const result = await database.select<{ key: string; value: string }[]>(
        'SELECT key, value FROM settings',
      );

      if (result.length > 0) {
        // Build settings object from key-value pairs
        const settings = { ...defaultSettings };
        for (const row of result) {
          try {
            const value = JSON.parse(row.value);
            (settings as Record<string, unknown>)[row.key] = value;
          } catch {
            // Skip invalid JSON values
          }
        }
        const loadedSettings = sanitizeSettings(settings);
        loadedSettings.providers = migrateProviders(loadedSettings.providers);
        // Merge API keys from stronghold vault (stored separately, not in SQLite)
        loadedSettings.providers = await mergeProviderKeys(
          loadedSettings.providers,
        );
        // Vault may be unavailable (e.g. corrupted or wrong password after
        // keychain failure). Fall back to keys stored in the backend DB, which
        // receives the full providers array via syncCriticalSettingsToBackend.
        loadedSettings.providers = await supplementProviderKeysFromBackend(
          loadedSettings.providers,
        );
        settingsCache = loadedSettings;
        return loadedSettings;
      }
    } catch (error) {
      console.error('[Settings] Failed to load from database:', error);
    }
  }

  // Fallback to localStorage for browser mode
  try {
    const stored = localStorage.getItem(`${APP_SLUG}_settings`);
    if (stored) {
      const loadedSettings = sanitizeSettings({
        ...defaultSettings,
        ...JSON.parse(stored),
      });
      loadedSettings.providers = migrateProviders(loadedSettings.providers);
      loadedSettings.providers = await mergeProviderKeys(
        loadedSettings.providers,
      );
      loadedSettings.providers = await supplementProviderKeysFromBackend(
        loadedSettings.providers,
      );
      settingsCache = loadedSettings;
      return loadedSettings;
    }
  } catch (error) {
    console.error('[Settings] Failed to load from localStorage:', error);
  }

  // Try loading from backend API as a final fallback (useful in browser mode
  // when localStorage was cleared but backend still has the critical settings)
  const backendSettings = await loadSettingsFromBackend();
  if (backendSettings && Object.keys(backendSettings).length > 0) {
    const merged = sanitizeSettings({ ...defaultSettings, ...backendSettings });
    merged.providers = migrateProviders(merged.providers);
    merged.providers = await mergeProviderKeys(merged.providers);
    settingsCache = merged;
    // Persist locally so next load is instant — strip API keys (sensitive)
    try {
      localStorage.setItem(
        `${APP_SLUG}_settings`,
        JSON.stringify(stripApiKeysForStorage(merged)),
      );
    } catch {
      // Ignore
    }
    return merged;
  }

  // No saved settings found anywhere — use defaults
  console.warn(
    '[Settings] No saved settings found in database, localStorage, or backend. Using defaults.',
  );
  settingsCache = defaultSettings;
  return defaultSettings;
}

/**
 * Get settings synchronously.
 * Returns a shallow clone to prevent callers from accidentally mutating the cache.
 * Prefer getSettingsAsync() when possible — this is a convenience fallback
 * for code that cannot be async (e.g. React state initializers).
 */
export function getSettings(): Settings {
  if (settingsCache) {
    return { ...settingsCache };
  }

  // Try localStorage first for immediate sync access
  try {
    const stored = localStorage.getItem(`${APP_SLUG}_settings`);
    if (stored) {
      const loadedSettings = sanitizeSettings({
        ...defaultSettings,
        ...JSON.parse(stored),
      });
      loadedSettings.providers = migrateProviders(loadedSettings.providers);
      settingsCache = loadedSettings;
      return { ...loadedSettings };
    }
  } catch (error) {
    console.error('[Settings] Failed to load from localStorage:', error);
  }

  return { ...defaultSettings };
}

// Save settings to database (async version)
export async function saveSettingsAsync(settings: Settings): Promise<void> {
  const sanitizedSettings = sanitizeSettings(settings);
  settingsCache = sanitizedSettings;

  // Persist API keys to stronghold vault (fire-and-forget)
  persistProviderKeys(sanitizedSettings.providers);

  // Strip API keys before writing to any persistent store
  const storedSettings = stripApiKeysForStorage(sanitizedSettings);

  const database = await getDatabase();

  if (database) {
    try {
      // Save each setting key individually using REPLACE
      const keys = Object.keys(storedSettings) as (keyof Settings)[];
      for (const key of keys) {
        const value = JSON.stringify(storedSettings[key]);
        await database.execute(
          `INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ($1, $2, datetime('now'))`,
          [key, value],
        );
      }
    } catch (error) {
      console.error('[Settings] Failed to save to database:', error);
    }
  }

  // Also save to localStorage as fallback — strip API keys (sensitive)
  try {
    localStorage.setItem(
      `${APP_SLUG}_settings`,
      JSON.stringify(storedSettings),
    );
  } catch (error) {
    console.error('[Settings] Failed to save to localStorage:', error);
  }

  // Sync critical settings to backend API (fire-and-forget)
  syncCriticalSettingsToBackend(sanitizedSettings).catch(() => {
    // Silently ignore — backend may not be available
  });
}

// Sync version that triggers async save
export function saveSettings(settings: Settings): void {
  const sanitizedSettings = sanitizeSettings(settings);
  settingsCache = sanitizedSettings;

  // Persist API keys to stronghold vault (fire-and-forget)
  persistProviderKeys(sanitizedSettings.providers);

  // Save to localStorage immediately for sync access — strip API keys (sensitive)
  try {
    localStorage.setItem(
      `${APP_SLUG}_settings`,
      JSON.stringify(stripApiKeysForStorage(sanitizedSettings)),
    );
  } catch (error) {
    console.error('[Settings] Failed to save to localStorage:', error);
  }

  // Notify subscribers so other components (e.g. SettingsModal) re-render
  notifySettingsListeners();

  // Also save to database asynchronously
  saveSettingsAsync(sanitizedSettings).catch((error) => {
    console.error('[Settings] Failed to save settings async:', error);
  });
}

// Initialize settings - call this on app startup
export async function initializeSettings(): Promise<Settings> {
  // Resolve platform-specific paths
  const [appDataDir, mcpConfigPath] = await Promise.all([
    getAppDataDir(),
    getMcpConfigPath(),
  ]);

  const settings = await getSettingsAsync();

  // Track whether any values changed so we only write back when needed
  let dirty = false;

  // If paths are empty (first run or migration), set them to platform defaults
  if (!settings.workDir) {
    settings.workDir = appDataDir;
    dirty = true;
  }
  if (!settings.mcpConfigPath) {
    settings.mcpConfigPath = mcpConfigPath;
    dirty = true;
  }
  // Default skillsPath to workDir/skills (not system default)
  if (!settings.skillsPath) {
    settings.skillsPath = `${settings.workDir}/skills`;
    dirty = true;
  }

  // Migration: If a sandbox provider is selected but sandboxEnabled is not true, enable it
  // This fixes a bug where selecting a sandbox provider didn't enable sandbox mode
  if (settings.defaultSandboxProvider && settings.sandboxEnabled !== true) {
    settings.sandboxEnabled = true;
    dirty = true;
  }

  // Migration: Ensure allowedFolders is always an array (handles pre-existing installs)
  if (!Array.isArray(settings.allowedFolders)) {
    settings.allowedFolders = [];
    dirty = true;
  }

  // Session-scoped permission reset: remove non-"alwaysAllow" folder entries on startup.
  // This matches Cowork's security model where temporary permissions don't survive restarts.
  // Rather than leaving dead entries (all perms false, alwaysAllow false) in the list,
  // we remove them entirely to keep the recent folders list clean.
  if (settings.allowedFolders && settings.allowedFolders.length > 0) {
    const before = settings.allowedFolders.length;
    settings.allowedFolders = settings.allowedFolders.filter(
      (f) => f.alwaysAllow,
    );
    if (settings.allowedFolders.length !== before) {
      dirty = true;
    }
  }

  settingsCache = settings;

  // Persist to DB if any settings were migrated/fixed
  if (dirty) {
    await saveSettingsAsync(settings);
  } else {
    // Even when no local changes, always sync critical settings to the backend
    // API on startup. This ensures the backend DB has the latest provider
    // configs (API keys, model lists) even if it was cleared or restarted.
    syncCriticalSettingsToBackend(settings).catch(() => {
      // Backend may not be available yet — will be synced on next settings save
    });
  }

  return settings;
}

// Update a single AI provider (immutable — clones before mutating)
export function updateProvider(
  providerId: string,
  updates: Partial<AIProvider>,
): Settings {
  const settings = getSettings();
  const providerIndex = settings.providers.findIndex(
    (p) => p.id === providerId,
  );
  if (providerIndex !== -1) {
    // Clone the providers array to avoid mutating the cached copy
    const updatedProviders = [...settings.providers];
    updatedProviders[providerIndex] = {
      ...updatedProviders[providerIndex],
      ...updates,
    };
    const updatedSettings = { ...settings, providers: updatedProviders };
    saveSettings(updatedSettings);
    return updatedSettings;
  }
  return settings;
}

// ============================================================================
// Sandbox Provider Management
// ============================================================================

// Update a sandbox provider (immutable — clones before mutating)
export function updateSandboxProvider(
  providerId: string,
  updates: Partial<SandboxProviderSetting>,
): Settings {
  const settings = getSettings();
  const providerIndex = settings.sandboxProviders.findIndex(
    (p) => p.id === providerId,
  );
  if (providerIndex !== -1) {
    const updatedProviders = [...settings.sandboxProviders];
    updatedProviders[providerIndex] = {
      ...updatedProviders[providerIndex],
      ...updates,
    };
    const updatedSettings = {
      ...settings,
      sandboxProviders: updatedProviders,
    };
    saveSettings(updatedSettings);
    return updatedSettings;
  }
  return settings;
}

// Set default sandbox provider (immutable)
export function setDefaultSandboxProvider(providerId: string): Settings {
  const settings = getSettings();
  const updatedSettings = { ...settings, defaultSandboxProvider: providerId };
  saveSettings(updatedSettings);
  return updatedSettings;
}

// Get the current default sandbox provider
export function getDefaultSandboxProvider():
  | SandboxProviderSetting
  | undefined {
  const settings = getSettings();
  return settings.sandboxProviders.find(
    (p) => p.id === settings.defaultSandboxProvider,
  );
}

// ============================================================================
// Agent Runtime Management
// ============================================================================

// Update an agent runtime (immutable — clones before mutating)
export function updateAgentRuntime(
  runtimeId: string,
  updates: Partial<AgentRuntimeSetting>,
): Settings {
  const settings = getSettings();
  const runtimeIndex = settings.agentRuntimes.findIndex(
    (r) => r.id === runtimeId,
  );
  if (runtimeIndex !== -1) {
    const updatedRuntimes = [...settings.agentRuntimes];
    updatedRuntimes[runtimeIndex] = {
      ...updatedRuntimes[runtimeIndex],
      ...updates,
    };
    const updatedSettings = { ...settings, agentRuntimes: updatedRuntimes };
    saveSettings(updatedSettings);
    return updatedSettings;
  }
  return settings;
}

// Set default agent runtime (immutable)
export function setDefaultAgentRuntime(runtimeId: string): Settings {
  const settings = getSettings();
  const updatedSettings = { ...settings, defaultAgentRuntime: runtimeId };
  saveSettings(updatedSettings);
  return updatedSettings;
}

// Get the current default agent runtime
export function getDefaultAgentRuntime(): AgentRuntimeSetting | undefined {
  const settings = getSettings();
  return settings.agentRuntimes.find(
    (r) => r.id === settings.defaultAgentRuntime,
  );
}

/**
 * Get the current default AI provider (for model configuration)
 */
export function getDefaultAIProvider(): AIProvider | undefined {
  const settings = getSettings();
  return settings.providers.find((p) => p.id === settings.defaultProvider);
}

/**
 * Resolve the effective model configuration for a specific task type.
 *
 * Priority chain:
 *   1. Task-specific routing override (modelRouting[taskType])
 *   2. Global default (defaultProvider + defaultModel)
 *   3. Environment variables (when defaultProvider is 'default')
 *
 * @returns Model config with apiKey, baseUrl, model, agentType — or undefined for env fallback
 */
export function getModelConfigForTaskType(taskType: TaskType):
  | {
      providerId?: string;
      dialect?: 'standard' | 'kimi-k3';
      apiKey?: string;
      baseUrl?: string;
      model?: string;
      agentType?: string;
    }
  | undefined {
  const settings = getSettings();
  const route = settings.modelRouting?.[taskType];

  // If a task-specific route is set and it's not 'default', use it
  if (route && route.provider && route.provider !== 'default') {
    const provider = settings.providers.find((p) => p.id === route.provider);
    if (provider) {
      return {
        providerId: provider.id,
        dialect: provider.dialect,
        apiKey: provider.apiKey || undefined,
        baseUrl: provider.baseUrl || undefined,
        model: route.model || provider.models[0] || undefined,
        agentType: provider.agentType || undefined,
      };
    }
  }

  // Fall back to the global default provider
  if (settings.defaultProvider === 'default') {
    return undefined; // Use environment variables
  }

  const defaultProvider = settings.providers.find(
    (p) => p.id === settings.defaultProvider,
  );
  if (!defaultProvider) return undefined;

  return {
    providerId: defaultProvider.id,
    dialect: defaultProvider.dialect,
    apiKey: defaultProvider.apiKey || undefined,
    baseUrl: defaultProvider.baseUrl || undefined,
    model: settings.defaultModel || undefined,
    agentType: defaultProvider.agentType || undefined,
  };
}

/**
 * Sync settings with the backend API
 * This ensures the backend uses the same provider configuration as the frontend
 */
export async function syncSettingsWithBackend(): Promise<void> {
  const settings = getSettings();

  // Get the selected AI provider's configuration
  const aiProvider = getDefaultAIProvider();

  // Build agent config with model information and user preferences
  const agentConfig: Record<string, unknown> = {
    ...getDefaultAgentRuntime()?.config,
  };

  // Include user preferences for system prompt injection
  const profile = settings.profile;
  const userPreferences: Record<string, unknown> = {
    customInstructions: profile.customInstructions || '',
    responseStyle: profile.responseStyle || 'auto',
    tone: profile.tone || 'auto',
    proactiveSuggestions: profile.proactiveSuggestions ?? true,
    codeStyle: profile.codeStyle || 'auto',
    nickname: profile.nickname || '',
  };

  // If a custom AI provider is selected (not 'default'), use its configuration
  if (settings.defaultProvider !== 'default' && aiProvider) {
    if (aiProvider.apiKey) {
      agentConfig.apiKey = aiProvider.apiKey;
    }
    if (aiProvider.baseUrl) {
      agentConfig.baseUrl = aiProvider.baseUrl;
    }
    if (settings.defaultModel) {
      agentConfig.model = settings.defaultModel;
    }
    if (aiProvider.agentType) {
      agentConfig.agentType = aiProvider.agentType;
    }
    agentConfig.providerId = aiProvider.id;
    if (aiProvider.dialect) agentConfig.dialect = aiProvider.dialect;
  }

  try {
    const response = await fetch(`${API_BASE_URL}/providers/settings/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sandboxProvider: settings.defaultSandboxProvider,
        sandboxConfig: getDefaultSandboxProvider()?.config,
        agentProvider: settings.defaultAgentRuntime,
        agentConfig: agentConfig,
        // Also send the AI provider info for clarity
        defaultProvider: settings.defaultProvider,
        defaultModel: settings.defaultModel,
        // User preferences for system prompt injection
        userPreferences,
      }),
    });

    if (!response.ok) {
      console.error(
        '[Settings] Failed to sync with backend:',
        response.statusText,
      );
    }
  } catch (error) {
    // Backend might not be running, ignore error
    console.warn('[Settings] Could not sync with backend:', error);
  }
}

/**
 * Save settings and sync with backend
 */
export async function saveSettingsWithSync(settings: Settings): Promise<void> {
  saveSettings(settings);
  await syncSettingsWithBackend();
}

// ============================================================================
// Individual Setting Items (for flags like setupCompleted)
// ============================================================================

/**
 * Onboarding schema version. Bump this to force all users to re-run onboarding
 * (e.g. after a major wizard redesign). Old installations that lack this key
 * will automatically re-trigger onboarding, which also fixes the case where
 * stale app data from a prior install causes onboarding to be skipped on a
 * fresh reinstall.
 */
export const ONBOARDING_VERSION = '1';

/** Settings keys for the resumable first-run flow. */
export const FIRST_RUN_COMPLETED_AT_KEY = 'firstRunCompletedAt';
export const DEMO_SEEDED_AT_KEY = 'demoSeededAt';

/**
 * Save a single setting item (for simple key-value flags)
 */
export async function saveSettingItem(
  key: string,
  value: string,
): Promise<void> {
  const database = await getDatabase();

  if (database) {
    try {
      await database.execute(
        `INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ($1, $2, datetime('now'))`,
        [key, JSON.stringify(value)],
      );
    } catch (error) {
      console.error(`[Settings] Failed to save ${key} to database:`, error);
    }
  }

  // Also save to localStorage
  try {
    localStorage.setItem(`${APP_SLUG}_${key}`, value);
  } catch (error) {
    console.error(`[Settings] Failed to save ${key} to localStorage:`, error);
  }
}

/**
 * Get a single setting item
 */
export async function getSettingItem(key: string): Promise<string | null> {
  const database = await getDatabase();

  if (database) {
    try {
      const result = await database.select<{ value: string }[]>(
        'SELECT value FROM settings WHERE key = $1',
        [key],
      );
      if (result.length > 0) {
        return JSON.parse(result[0].value);
      }
    } catch (error) {
      console.error(`[Settings] Failed to get ${key} from database:`, error);
    }
  }

  // Fallback to localStorage
  try {
    return localStorage.getItem(`${APP_SLUG}_${key}`);
  } catch {
    return null;
  }
}

/**
 * Check if setup has been completed
 */
export async function isSetupCompleted(): Promise<boolean> {
  const value = await getSettingItem('setupCompleted');
  return value === 'true';
}

/**
 * Clear all settings and reset to defaults
 */
export async function clearAllSettings(): Promise<void> {
  const database = await getDatabase();

  if (database) {
    try {
      await database.execute('DELETE FROM settings');
    } catch (error) {
      console.error(
        '[Settings] Failed to clear settings from database:',
        error,
      );
    }
  }

  // Clear localStorage — remove all keys prefixed with the current slug
  try {
    const keys = Object.keys(localStorage);
    for (const key of keys) {
      if (key.startsWith(APP_SLUG)) {
        localStorage.removeItem(key);
      }
    }
  } catch (error) {
    console.error('[Settings] Failed to clear localStorage:', error);
  }

  // Reset cache
  settingsCache = null;
  notifySettingsListeners();
}

// ============================================================================
// Settings Subscription (for cross-component reactivity)
// ============================================================================

/**
 * Lightweight pub/sub for settings changes.
 * Enables `useSettingsValue()` hook to re-render when any component
 * calls `saveSettings()` or `saveSettingsAsync()`.
 */
const settingsListeners = new Set<() => void>();

function notifySettingsListeners(): void {
  settingsListeners.forEach((cb) => cb());
}

/**
 * Subscribe to settings changes. Returns an unsubscribe function.
 * Compatible with React's `useSyncExternalStore`.
 */
export function subscribeToSettings(callback: () => void): () => void {
  settingsListeners.add(callback);
  return () => {
    settingsListeners.delete(callback);
  };
}

/**
 * Snapshot function for `useSyncExternalStore`.
 * Returns the current cached settings (referentially stable until next save).
 */
export function getSettingsSnapshot(): Settings {
  return settingsCache ?? defaultSettings;
}

/**
 * React hook that returns the current settings and re-renders
 * whenever any component saves settings.
 *
 * Uses `useSyncExternalStore` for tear-free, concurrent-safe reads.
 *
 * @example
 * const settings = useSettingsValue();
 * // `settings.planMode` is always up-to-date
 */
export function useSettingsValue(): Settings {
  return useSyncExternalStore(subscribeToSettings, getSettingsSnapshot);
}

/**
 * Subscribe to a single settings key. Re-renders only when that key
 * changes — useful for feature flags consumed deep in the tree.
 */
export function useSetting<K extends keyof Settings>(key: K): Settings[K] {
  return useSyncExternalStore(
    subscribeToSettings,
    () => getSettingsSnapshot()[key],
  );
}
