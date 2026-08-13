import type {
  AspectRatio,
  MediaItem,
  VideoProject,
} from '@/shared/video/types';

export const BROLL_PROVIDER_IDS = ['pexels', 'pixabay', 'storyblocks'] as const;
export type BrollProviderId = (typeof BROLL_PROVIDER_IDS)[number];
export const YOUTUBE_UNVERIFIED_PROVIDER = 'youtube-unverified';

export interface BrollSearchRequest {
  query: string;
  durationRangeSec?: [number, number];
  aspectRatio?: AspectRatio;
  orientation?: 'landscape' | 'portrait' | 'square';
  limit?: number;
  provider?: BrollProviderId;
}

export interface BrollHit {
  id: string;
  provider: BrollProviderId;
  previewUrl: string;
  downloadUrl: string;
  widths: number[];
  width?: number;
  height?: number;
  durationSec: number;
  license: string;
  attribution?: string;
  attributionUrl?: string;
  attributionRequired?: boolean;
  commercialUse: boolean;
  sourceUrl?: string;
  sourceDisplayName?: string;
  thumbnailUrl?: string;
  providerLinkLabel?: string;
  downloadMimeType?: string;
  fileExtension?: string;
  query?: string;
}

export interface BrollDownloadResult {
  project: VideoProject;
  asset: MediaItem;
}

export interface BrollProviderCredentials {
  apiKey: string;
  baseUrl: string;
  publicKey?: string;
  privateKey?: string;
  projectId?: string;
  userId?: string;
}

export interface BrollProviderAdapter {
  id: BrollProviderId;
  search(
    request: BrollSearchRequest,
    credentials: BrollProviderCredentials,
  ): Promise<BrollHit[]>;
}
