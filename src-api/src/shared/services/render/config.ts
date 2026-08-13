import { randomUUID } from 'node:crypto';

import { getSetting, setSetting } from '@/shared/db/operations';

import type {
  RenderProviderConfig,
  RenderProviderConfigView,
  RenderProviderKind,
} from './types';

const SETTINGS_KEY = 'video_render_providers';
export const PINNED_RENDERER_IMAGE = 'ghcr.io/bravew/neumar-video-renderer';
export const PINNED_RENDERER_VERSION = '2026-05-19';
export const PINNED_FAL_ENDPOINT_ID = 'neumar/video-ffmpeg-renderer';

const now = () => new Date().toISOString();

function defaultRenderProviders(): RenderProviderConfig[] {
  const timestamp = now();
  return [
    {
      id: 'local',
      provider: 'local',
      label: 'Local FFmpeg',
      enabled: true,
      rendererImage: 'local-ffmpeg',
      rendererVersion: PINNED_RENDERER_VERSION,
      settings: {},
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: 'fal',
      provider: 'fal',
      label: 'fal.ai',
      enabled: false,
      baseUrl: 'https://queue.fal.run',
      endpointId: PINNED_FAL_ENDPOINT_ID,
      rendererImage: PINNED_RENDERER_IMAGE,
      rendererVersion: PINNED_RENDERER_VERSION,
      defaultCostCentsPerRenderSec: 1,
      settings: {},
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ];
}

export interface UpsertRenderProviderConfigInput {
  id?: string;
  provider: RenderProviderKind;
  label?: string;
  enabled?: boolean;
  baseUrl?: string;
  endpointId?: string;
  apiKey?: string;
  providerSettingId?: string | null;
  rendererImage?: string;
  rendererVersion?: string;
  defaultCostCentsPerRenderSec?: number;
  settings?: Record<string, unknown>;
}

export function listRenderProviderConfigs(): RenderProviderConfigView[] {
  return readRenderProviderConfigs().map(sanitizeRenderProviderConfig);
}

export function getRenderProviderConfig(
  id: string,
): RenderProviderConfig | undefined {
  return readRenderProviderConfigs().find((config) => config.id === id);
}

export function upsertRenderProviderConfig(
  input: UpsertRenderProviderConfigInput,
): RenderProviderConfigView {
  const configs = readRenderProviderConfigs();
  const timestamp = now();
  const id = input.id?.trim() || defaultProviderId(input.provider);
  const existing = configs.find((config) => config.id === id);
  const next: RenderProviderConfig = {
    id,
    provider: input.provider,
    label:
      input.label?.trim() || existing?.label || defaultLabel(input.provider),
    enabled: input.enabled ?? existing?.enabled ?? input.provider === 'local',
    baseUrl: input.baseUrl?.trim() || existing?.baseUrl,
    endpointId: input.endpointId?.trim() || existing?.endpointId,
    apiKey: input.apiKey?.trim() || existing?.apiKey,
    providerSettingId:
      input.providerSettingId === null
        ? undefined
        : input.providerSettingId?.trim() || existing?.providerSettingId,
    rendererImage:
      input.rendererImage?.trim() ||
      existing?.rendererImage ||
      (input.provider === 'local' ? 'local-ffmpeg' : PINNED_RENDERER_IMAGE),
    rendererVersion:
      input.rendererVersion?.trim() ||
      existing?.rendererVersion ||
      PINNED_RENDERER_VERSION,
    defaultCostCentsPerRenderSec:
      input.defaultCostCentsPerRenderSec ??
      existing?.defaultCostCentsPerRenderSec ??
      (input.provider === 'local' ? 0 : 1),
    settings: { ...(existing?.settings ?? {}), ...(input.settings ?? {}) },
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  };

  const replaced = configs.some((config) => config.id === id);
  const merged = replaced
    ? configs.map((config) => (config.id === id ? next : config))
    : [...configs, next];
  writeRenderProviderConfigs(merged);
  return sanitizeRenderProviderConfig(next);
}

export function deleteRenderProviderConfig(id: string): boolean {
  if (id === 'local') return false;
  const configs = readRenderProviderConfigs();
  const next = configs.filter((config) => config.id !== id);
  if (next.length === configs.length) return false;
  writeRenderProviderConfigs(next);
  return true;
}

export function sanitizeRenderProviderConfig(
  config: RenderProviderConfig,
): RenderProviderConfigView {
  const { apiKey, ...view } = config;
  return { ...view, hasApiKey: Boolean(apiKey) };
}

function readRenderProviderConfigs(): RenderProviderConfig[] {
  const defaults = defaultRenderProviders();
  const raw = getSetting(SETTINGS_KEY);
  if (!raw) return defaults;

  try {
    let parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'string') parsed = JSON.parse(parsed);
    if (!Array.isArray(parsed)) return defaults;
    return mergeDefaults(parsed.filter(isRenderProviderConfig), defaults);
  } catch {
    return defaults;
  }
}

function writeRenderProviderConfigs(configs: RenderProviderConfig[]): void {
  setSetting(SETTINGS_KEY, JSON.stringify(configs));
}

function mergeDefaults(
  stored: RenderProviderConfig[],
  defaults: RenderProviderConfig[],
): RenderProviderConfig[] {
  const byId = new Map(stored.map((config) => [config.id, config]));
  for (const fallback of defaults) {
    if (!byId.has(fallback.id)) {
      byId.set(fallback.id, fallback);
    }
  }
  return Array.from(byId.values());
}

function isRenderProviderConfig(value: unknown): value is RenderProviderConfig {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === 'string' &&
    typeof record.provider === 'string' &&
    typeof record.label === 'string' &&
    typeof record.enabled === 'boolean' &&
    (record.settings === undefined || typeof record.settings === 'object')
  );
}

function defaultProviderId(provider: RenderProviderKind): string {
  if (provider === 'local') return 'local';
  return `${provider}-${randomUUID().slice(0, 8)}`;
}

function defaultLabel(provider: RenderProviderKind): string {
  switch (provider) {
    case 'fal':
      return 'fal.ai';
    case 'modal':
      return 'Modal';
    case 'replicate':
      return 'Replicate';
    case 'local':
      return 'Local FFmpeg';
  }
}
