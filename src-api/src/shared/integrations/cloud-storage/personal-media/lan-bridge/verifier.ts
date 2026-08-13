import { createHash } from 'crypto';
import { createReadStream } from 'fs';
import { pipeline } from 'stream/promises';

import { resolveBridgePath } from './resolver';
import type {
  BridgeRemoteReason,
  BridgeResolution,
  ImmichBridgeAsset,
  PathMapping,
} from './types';

export const DEFAULT_MAX_VERIFY_BYTES = 50 * 1024 * 1024;

export type BridgeVerificationFailureReason =
  | BridgeRemoteReason
  | 'asset_too_large'
  | 'checksum_missing'
  | 'checksum_mismatch';

export type BridgeVerificationResult =
  | {
      verified: true;
      verificationHash: string;
      resolution: Extract<BridgeResolution, { kind: 'local' }>;
    }
  | {
      verified: false;
      reason: BridgeVerificationFailureReason;
      detail?: string;
      resolution?: BridgeResolution;
    };

export interface VerifyBridgeMappingInput {
  asset: ImmichBridgeAsset;
  mapping: Pick<
    PathMapping,
    'id' | 'connectionId' | 'immichPathPrefix' | 'localMountPath'
  >;
  maxBytes?: number;
}

export async function verifyBridgeMapping({
  asset,
  mapping,
  maxBytes = DEFAULT_MAX_VERIFY_BYTES,
}: VerifyBridgeMappingInput): Promise<BridgeVerificationResult> {
  const candidateMapping: PathMapping = {
    ...mapping,
    disabled: false,
    verified: true,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
  const resolution = await resolveBridgePath({
    asset,
    mappings: [candidateMapping],
  });

  if (resolution.kind === 'remote') {
    return {
      verified: false,
      reason: resolution.reason,
      detail: resolution.detail,
      resolution,
    };
  }

  if (resolution.sizeBytes > maxBytes) {
    return { verified: false, reason: 'asset_too_large', resolution };
  }

  if (!asset.checksum) {
    return { verified: false, reason: 'checksum_missing', resolution };
  }

  const hasher = createHash('sha1');
  await pipeline(createReadStream(resolution.absolutePath), hasher);
  const hash = hasher.digest('hex');
  if (hash !== normalizeSha1(asset.checksum)) {
    return {
      verified: false,
      reason: 'checksum_mismatch',
      detail: hash,
      resolution,
    };
  }

  return { verified: true, verificationHash: hash, resolution };
}

function normalizeSha1(checksum: string): string {
  const value = checksum.trim().replace(/^sha1:/i, '');
  if (/^[a-f0-9]{40}$/i.test(value)) {
    return value.toLowerCase();
  }
  return Buffer.from(value, 'base64').toString('hex').toLowerCase();
}
