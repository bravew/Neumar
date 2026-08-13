import type { LicenseInfo } from '@/shared/integrations/cloud-storage';

import type { AttachmentScope } from './types';

export type MaterializeReason =
  | 'video_attach'
  | 'video_hydrate'
  | 'design_attach'
  | 'preview'
  | 'export'
  | 'agent_inline';

export const PROXY_PRESETS = [
  'edit_1080p',
  'web_720p',
  'design_2k',
  'audio_mp3',
] as const;

export type ProxyPreset = (typeof PROXY_PRESETS)[number];

export const PREVIEW_ARTIFACT_KINDS = [
  'filmstrip',
  'waveform',
  'poster',
] as const;

export type PreviewArtifactKind = (typeof PREVIEW_ARTIFACT_KINDS)[number];

export interface MaterializeRequest {
  assetId: string;
  scope: AttachmentScope['scope'];
  scopeId: string;
  reason: MaterializeReason;
  sessionId?: string;
  clientRequestId?: string;
  role?: string;
  proxies?: ProxyPreset[];
  signal?: AbortSignal;
  onProgress?: (bytes: number, total: number | null) => void;
}

export interface MaterializeLicense {
  provider: string;
  attribution?: string;
  attributionRequired: boolean;
  licenseCode?: string;
  raw?: LicenseInfo;
}

export interface MaterializeResult {
  materializationId: string;
  activePath: string;
  contentHash: string | null;
  bytes: number;
  cacheHit: boolean;
  license: MaterializeLicense | null;
  urls: {
    raw: string;
    preview: string;
    proxy?: Partial<Record<ProxyPreset, string>>;
    filmstrip?: string;
    waveform?: string;
    poster?: string;
  };
}
