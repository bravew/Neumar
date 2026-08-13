import type { SiteApiClient } from '@/shared/auth/site-api-client';

import type { DownloadInit } from '../adapter';
import type {
  ImmichBridgeAsset,
  PathMapping,
} from '../personal-media/lan-bridge';
import {
  openBridgeResponse,
  PathMappingsStore,
  recordBridgeResolution,
  resolveBridgePath,
} from '../personal-media/lan-bridge';
import type { Capabilities, CloudStorageProvider, CloudFile } from '../types';
import { SiteProxyAdapter } from './site-proxy-adapter';

const PERSONAL_MEDIA_CAPABILITIES: Capabilities = {
  fullTextSearch: true,
  thumbnails: true,
  exportContent: false,
  watch: false,
  longPoll: true,
  sharedDrives: false,
  mediaMetadata: {
    structuredSearch: true,
    writableFields: ['description', 'isFavorite', 'rating', 'tags'],
  },
  lanBridge: {
    available: true,
    verifiedMappings: 0,
    totalMappings: 0,
    writeModes: ['api-only', 'direct-then-scan'],
  },
};

interface PathMappingsReader {
  list(connectionId: string, includeDisabled?: boolean): PathMapping[];
  markVerification?: (
    id: string,
    verified: boolean,
    options?: { verificationHash?: string; lastError?: string },
  ) => void;
}

export class PersonalMediaProxyAdapter extends SiteProxyAdapter {
  constructor(
    provider: Extract<CloudStorageProvider, 'immich' | 'photoprism'>,
    private readonly personalMediaConnectionId: string,
    siteApiClient: SiteApiClient,
    private readonly pathMappings: PathMappingsReader = new PathMappingsStore(),
  ) {
    super(
      provider,
      personalMediaConnectionId,
      siteApiClient,
      PERSONAL_MEDIA_CAPABILITIES,
    );
  }

  override getCapabilities(): Capabilities {
    const mappings = this.pathMappings.list(
      this.personalMediaConnectionId,
      true,
    );
    return {
      ...PERSONAL_MEDIA_CAPABILITIES,
      lanBridge: {
        available: true,
        writeModes: ['api-only', 'direct-then-scan'],
        totalMappings: mappings.length,
        verifiedMappings: mappings.filter(
          (mapping) => mapping.verified && !mapping.disabled,
        ).length,
      },
    };
  }

  override async download(
    providerItemId: string,
    init: DownloadInit = {},
  ): Promise<Response> {
    if (this.provider !== 'immich') {
      return super.download(providerItemId, init);
    }

    const metadata = await this.getMetadata(providerItemId);
    const asset = toImmichBridgeAsset(metadata);
    if (!asset) {
      return super.download(providerItemId, init);
    }

    const resolution = await resolveBridgePath({
      asset,
      mappings: this.pathMappings.list(this.personalMediaConnectionId, false),
    });
    recordBridgeResolution(resolution, this.pathMappings);
    if (resolution.kind !== 'local') {
      return super.download(providerItemId, init);
    }

    return openBridgeResponse(resolution, {
      range: init.range,
      contentType: metadata.mimeType,
    });
  }
}

function toImmichBridgeAsset(file: CloudFile): ImmichBridgeAsset | null {
  const originalPath = file.mediaMetadata?.fileInfo?.originalPath;
  if (!originalPath || file.size <= 0) return null;
  return {
    id: file.id,
    originalPath,
    fileSizeBytes: file.size,
    checksum: file.mediaMetadata?.fileInfo?.checksum ?? file.etag,
  };
}
