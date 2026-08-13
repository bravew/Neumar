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

export interface MountPoint {
  path: string;
  fsType?: string;
  source?: string;
  label?: string;
}

export interface ImmichBridgeAsset {
  id: string;
  originalPath: string;
  fileSizeBytes: number;
  checksum?: string;
}

export type BridgeRemoteReason =
  | 'lan_bridge_disabled'
  | 'no_verified_mapping'
  | 'path_traversal'
  | 'containment_violation'
  | 'mount_unavailable'
  | 'symlink_rejected'
  | 'not_a_file'
  | 'missing_file'
  | 'size_mismatch'
  | 'local_read_error';

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
      reason: BridgeRemoteReason;
      mappingId?: string;
      detail?: string;
    };

export interface ResolveBridgeInput {
  asset: ImmichBridgeAsset;
  mappings: PathMapping[];
  lanBridgeEnabled?: boolean;
}
