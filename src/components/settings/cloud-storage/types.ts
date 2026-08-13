export interface PathMapping {
  id: string;
  connectionId: string;
  immichPathPrefix: string;
  localMountPath: string;
  disabled: boolean;
  verified: boolean;
  verifiedAt?: string;
  verificationHash?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CloudStorageConnection {
  id: string;
  provider: string;
  displayName?: string | null;
  status: string;
  connectedAt?: string | null;
  isActive?: boolean;
  assetsCatalog?: {
    enabled: boolean;
    fullSyncAt?: number | null;
    lastSyncedAt?: number | null;
    lastError?: string | null;
  };
  capabilities?: {
    preferredView?: 'tree-list' | 'media-grid';
    selfHostedBaseUrl?: boolean;
    readOnly?: boolean;
  };
}

export interface PersonalMediaConnectionDetails extends CloudStorageConnection {
  credential?: {
    baseUrl?: string;
    serverVersion?: string;
    serverInstanceId?: string;
    userId?: string;
  };
  updatedAt?: string;
}

export interface ImmichBridgeAsset {
  id: string;
  originalPath: string;
  fileSizeBytes: number;
  checksum?: string;
}

export interface NetworkMount {
  path: string;
  label?: string;
  fsType?: string;
  source?: string;
}

export interface TailscaleStatus {
  available: boolean;
  selfDnsName?: string;
}

export interface PathMappingDiscovery {
  mounts?: NetworkMount[];
  tailscale?: TailscaleStatus;
}

export type BridgeResolution =
  | {
      kind: 'local';
      absolutePath: string;
      sizeBytes: number;
      mappingId: string;
      checksum?: string;
    }
  | {
      kind: 'remote';
      reason: string;
      mappingId?: string;
      detail?: string;
    };

export type BridgeVerificationResult =
  | {
      verified: true;
      verificationHash: string;
      resolution: Extract<BridgeResolution, { kind: 'local' }>;
    }
  | {
      verified: false;
      reason: string;
      detail?: string;
      resolution?: BridgeResolution;
    };
