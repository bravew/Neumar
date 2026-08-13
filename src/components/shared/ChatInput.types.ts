/**
 * Types, constants, and helpers for the ChatInput component family.
 */

import type { ReactNode } from 'react';

import type { AIProvider } from '@/shared/db/settings';
import { getSettings } from '@/shared/db/settings';
import type {
  AttachmentSourceContext,
  MessageAttachment,
} from '@/shared/hooks/useAgent';
import { readProviderModelsCache } from '@/shared/lib/provider-models-cache';
import { randomUUID } from '@/shared/utils/uuid';

import {
  CLAUDE_MODELS,
  CODEX_MODELS,
  DEFAULT_MODEL_ID,
  type ModelOption,
} from './model-catalog.data';

export type { AttachmentSourceContext };

// ============================================================================
// Model selector types and constants
// ============================================================================

export { CLAUDE_MODELS, CODEX_MODELS, DEFAULT_MODEL_ID };
export type { ModelOption };

/** Return a human-readable short label for an arbitrary model ID. */
export function getModelShortLabel(modelId: string): string {
  if (modelId === 'codex') return 'OpenAI Codex';
  if (modelId.startsWith('codex:')) return modelId.slice(6);
  if (modelId.startsWith('kimi-k2')) return 'Kimi K2';
  if (modelId.startsWith('deepseek')) return 'DeepSeek';
  if (modelId.startsWith('gpt-4o')) return 'GPT-4o';
  if (modelId.startsWith('gpt-4')) return 'GPT-4';
  // Truncate long IDs to a readable slug
  return modelId.length > 20 ? `${modelId.slice(0, 18)}…` : modelId;
}

/** Build the full list of selectable models: built-in Claude models plus any
 *  non-Claude providers that have been configured with an API key.
 *  @param s - settings locale strings used to resolve i18n model descriptions
 *  @param providers - live provider list; falls back to getSettings() cache if omitted */
export function buildModelOptions(
  s: Record<string, unknown>,
  providers?: AIProvider[],
): ModelOption[] {
  const resolveDesc = (m: ModelOption): ModelOption =>
    m.descKey && typeof s[m.descKey] === 'string'
      ? { ...m, description: s[m.descKey] as string }
      : m;

  let allProviders = providers;
  if (!allProviders) {
    try {
      allProviders = getSettings().providers;
    } catch {
      return CLAUDE_MODELS.map(resolveDesc);
    }
  }

  const isConfigured = (p: AIProvider) =>
    !!p.apiKey || p.billingType === 'subscription' || p.billingType === 'free';

  const enabledIds = new Set(
    allProviders.filter((p) => p.enabled && isConfigured(p)).map((p) => p.id),
  );

  const options: ModelOption[] = [];
  if (enabledIds.has('claude')) options.push(...CLAUDE_MODELS.map(resolveDesc));
  if (enabledIds.has('codex')) options.push(...CODEX_MODELS.map(resolveDesc));

  for (const provider of allProviders) {
    if (!provider.enabled || !isConfigured(provider)) continue;
    if (!provider.agentType || provider.agentType === 'claude') continue;
    if (provider.id === 'codex') continue;
    const cached = readProviderModelsCache(provider);
    const cachedModelsById = new Map(
      cached?.models.map((model) => [model.id, model]) ?? [],
    );
    const modelIds =
      cached && cached.models.length > 0
        ? cached.models.map((model) => model.id)
        : provider.models;
    for (const modelId of modelIds) {
      if (
        modelId.startsWith('claude-') ||
        modelId === 'codex' ||
        modelId.startsWith('codex:')
      )
        continue;
      const cachedModel = cachedModelsById.get(modelId);
      options.push({
        id: modelId,
        label:
          cachedModel?.displayLabel ??
          cachedModel?.name ??
          getModelShortLabel(modelId),
        description: provider.name,
        provider: provider.agentType,
      });
    }
  }
  return options;
}

/** Whether we're running inside the Tauri desktop shell. */
export const inTauri =
  typeof window !== 'undefined' &&
  ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);

// Attachment type for files and images
export interface Attachment {
  id: string;
  file: File;
  type: 'image' | 'video' | 'audio' | 'file';
  preview?: string; // Data URL for image preview (thumbnail only for non-image files)
  localPath?: string; // Absolute path on disk (Tauri desktop only — avoids reading large files into memory)
  sourceContext?: AttachmentSourceContext;
}

export interface ChatInputAttachmentPolicy {
  accept?: string;
  allowCloudStorage?: boolean;
  allowAssetCatalog?: boolean;
  acceptsFile?: (file: File) => boolean;
}

export interface ChatInputProps {
  /** Placeholder text */
  placeholder?: string;
  /** Whether the agent is running */
  isRunning?: boolean;
  /** Callback when submitting with text, attachments, MCP server mentions, and pinned skills */
  onSubmit: (
    text: string,
    attachments?: MessageAttachment[],
    mentionedMcpServers?: string[],
    pinnedSkills?: string[],
  ) => Promise<void>;
  /** Callback when stop button is clicked */
  onStop?: () => void;
  /** Variant: 'home' for larger home page style, 'reply' for compact reply style */
  variant?: 'home' | 'reply';
  /** Additional class names (outer wrapper) */
  className?: string;
  /** Additional class names merged onto the bordered input box (overrides variant defaults) */
  inputBoxClassName?: string;
  /** Whether to disable the input */
  disabled?: boolean;
  /** Auto focus on mount */
  autoFocus?: boolean;
  /** Per-task work directory (single — used by reply variant) */
  workDir?: string | null;
  /** Callback when work directory changes (single — used by reply variant) */
  onWorkDirChange?: (workDir: string | null) => void;
  /** Multi-folder selection (used by home variant) */
  workDirs?: string[];
  /** Callback when multi-folder selection changes */
  onWorkDirsChange?: (folders: string[]) => void;
  /** Whether to show the folder picker option */
  showFolderPicker?: boolean;
  /** Restricts attachment sources and accepted files. Defaults preserve existing behavior. */
  attachmentPolicy?: ChatInputAttachmentPolicy;
  /** Optional slot rendered above attachments and input text, e.g. context pills. */
  beforeInput?: ReactNode;
  /** Allows submit with empty text/attachments when a mode has external context. */
  hasExternalSubmitContext?: boolean;
  /** Preserve original File objects on all message attachments for mode-owned upload adapters. */
  preserveAttachmentFiles?: boolean;
  /** Currently selected model ID (controlled) */
  selectedModel?: string;
  /** Called when the user picks a different model */
  onModelChange?: (modelId: string) => void;
  /** External value to prefill into the textarea */
  initialValue?: string;
  /** Nonce to trigger re-sync of initialValue (avoids re-firing on re-renders) */
  initialValueNonce?: number;
  /** Current task ID — used for slash commands like /export */
  taskId?: string;
  /** Callback to clear conversation messages */
  onClearMessages?: () => void;
  /** Pre-selected MCP servers (e.g., from agent profile) */
  initialMcpServers?: string[];
  /** Pre-selected skills (e.g., from agent profile) */
  initialSkills?: string[];
  /** Callback for "Dispatch" (background execution) — home variant only */
  onDispatch?: (
    text: string,
    attachments?: MessageAttachment[],
    mentionedMcpServers?: string[],
    pinnedSkills?: string[],
  ) => Promise<void>;
}

export function expandSearchSlashCommand(text: string): string {
  const match = text.match(/^\/search\s+([\s\S]+)$/i);
  if (!match) return text;

  const query = match[1].trim();
  if (!query) return text;

  return [
    'Research the following query using the search MCP research tool.',
    'Call research with depth="quick" and cite the returned sources in your answer.',
    '',
    `Query: ${query}`,
  ].join('\n');
}

// Named constants for textarea sizing (pixels)
export const TEXTAREA_MAX_HEIGHT_HOME = 200;
export const TEXTAREA_MAX_HEIGHT_REPLY = 80;
export const TEXTAREA_MIN_HEIGHT_HOME = 56;
export const TEXTAREA_MIN_HEIGHT_REPLY = 20;

// Generate unique ID for attachments
export const generateId = () => `attachment_${randomUUID()}`;

export const IMAGE_EXTS = [
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'svg',
  'bmp',
  'ico',
  'tiff',
];
export const VIDEO_EXTS = [
  'mp4',
  'webm',
  'mov',
  'avi',
  'mkv',
  'wmv',
  'flv',
  '3gp',
  'ogg',
];
export const AUDIO_EXTS = [
  'mp3',
  'wav',
  'ogg',
  'flac',
  'aac',
  'm4a',
  'opus',
  'webm',
];
/** File kinds the chat-input lightbox can preview beyond image/video/audio. */
export const PDF_EXTS = new Set(['pdf']);
export const MARKDOWN_EXTS = new Set(['md', 'markdown', 'mdx']);
/**
 * Text-preview extensions — loaded via File.text() or /files/read and
 * rendered in a monospace `<pre>`. Kept conservative on purpose: a 50 MB
 * binary mis-classified as text would freeze the webview.
 */
export const TEXT_EXTS = new Set<string>([
  ...MARKDOWN_EXTS,
  'txt',
  'log',
  'rst',
  'json',
  'yaml',
  'yml',
  'toml',
  'xml',
  'csv',
  'tsv',
  'html',
  'htm',
  'svg',
  'css',
  'scss',
  'less',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'ts',
  'tsx',
  'py',
  'rb',
  'go',
  'rs',
  'java',
  'c',
  'cc',
  'cpp',
  'h',
  'hpp',
  'cs',
  'php',
  'swift',
  'kt',
  'sh',
  'bash',
  'zsh',
  'fish',
  'sql',
  'ini',
  'conf',
  'gitignore',
  'dockerfile',
  'makefile',
]);

/** Lowercase extension without the leading dot, or '' when absent. */
export function extOf(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? '';
}

export const FILE_MIME_MAP: Record<string, string> = {
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  mkv: 'video/x-matroska',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  flac: 'audio/flac',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  json: 'application/json',
};

// Check if file is an image (by MIME type or file extension)
export const isImageFile = (file: File) => {
  // Check MIME type first
  if (file.type.startsWith('image/')) {
    return true;
  }
  // Fallback: check file extension for common image formats
  const ext = file.name.split('.').pop()?.toLowerCase();
  return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'ico'].includes(
    ext || '',
  );
};

// Check if file is a video (by MIME type or file extension)
export const isVideoFile = (file: File) => {
  if (file.type.startsWith('video/')) return true;
  const ext = file.name.split('.').pop()?.toLowerCase();
  return [
    'mp4',
    'mov',
    'webm',
    'avi',
    'mkv',
    'm4v',
    'wmv',
    'flv',
    '3gp',
    'ogg',
  ].includes(ext || '');
};

// Check if file is an audio file (by MIME type or file extension)
export const isAudioFile = (file: File) => {
  if (file.type.startsWith('audio/')) return true;
  const ext = file.name.split('.').pop()?.toLowerCase();
  return ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'opus', 'webm'].includes(
    ext || '',
  );
};

// Create preview for image files with error handling
export const createImagePreview = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      if (result) {
        resolve(result);
      } else {
        reject(new Error('Failed to read file'));
      }
    };
    reader.onerror = () => reject(new Error('FileReader error'));
    reader.readAsDataURL(file);
  });
};
