import type {
  DestinationCapabilities,
  VersioningMode,
  VersioningPolicy,
} from '../types';

export interface ResolvedTargetPath {
  path: string;
  mode: VersioningMode;
}

export type VersioningPolicyErrorCode =
  | 'versioning_not_supported'
  | 'versioning_not_enabled'
  | 'invalid_content_hash'
  | 'invalid_base_name';

export class VersioningPolicyError extends Error {
  constructor(
    readonly code: VersioningPolicyErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'VersioningPolicyError';
  }
}

export function resolveTargetPath(
  baseName: string,
  contentSha256: string,
  policy: VersioningPolicy,
  capabilities: DestinationCapabilities & { versioningEnabled?: boolean },
  options: { now?: Date } = {},
): ResolvedTargetPath {
  if (!baseName.trim()) {
    throw new VersioningPolicyError(
      'invalid_base_name',
      'Publish target name cannot be empty',
    );
  }
  if (!/^[a-f0-9]{64}$/i.test(contentSha256)) {
    throw new VersioningPolicyError(
      'invalid_content_hash',
      'Publish source must include a sha256 content hash',
    );
  }

  switch (policy.mode) {
    case 'provider-native':
      if (!capabilities.supportsVersioning) {
        throw new VersioningPolicyError(
          'versioning_not_supported',
          'Destination does not support provider-native versioning',
        );
      }
      if (capabilities.versioningEnabled === false) {
        throw new VersioningPolicyError(
          'versioning_not_enabled',
          'Enable bucket versioning or pick content-addressable versioning',
        );
      }
      return { path: baseName, mode: policy.mode };
    case 'content-addressable':
      return {
        path: contentAddressedName(baseName, contentSha256, policy),
        mode: policy.mode,
      };
    case 'timestamped-folder':
      return {
        path: timestampedPath(baseName, policy, options.now ?? new Date()),
        mode: policy.mode,
      };
    case 'overwrite':
      return { path: baseName, mode: policy.mode };
  }
}

function contentAddressedName(
  baseName: string,
  contentSha256: string,
  policy: VersioningPolicy,
): string {
  const { stem, ext } = splitName(baseName);
  const hashLen = policy.contentAddressable?.hashLen ?? 8;
  const sep = policy.contentAddressable?.sep ?? '_';
  return `${stem}${sep}${contentSha256.slice(0, hashLen)}${ext}`;
}

function timestampedPath(
  baseName: string,
  policy: VersioningPolicy,
  now: Date,
): string {
  const rootPath = policy.timestampedFolder?.rootPath ?? '_versions';
  const stamp =
    policy.timestampedFolder?.tsFormat === 'epoch'
      ? String(now.getTime())
      : now.toISOString().replace(/[:.]/g, '');
  return `${trimSlashes(rootPath)}/${stamp}/${baseName}`;
}

function splitName(name: string): { stem: string; ext: string } {
  const lastSlash = name.lastIndexOf('/');
  const prefix = lastSlash >= 0 ? `${name.slice(0, lastSlash + 1)}` : '';
  const fileName = lastSlash >= 0 ? name.slice(lastSlash + 1) : name;
  const dot = fileName.lastIndexOf('.');
  if (dot <= 0) return { stem: `${prefix}${fileName}`, ext: '' };
  return {
    stem: `${prefix}${fileName.slice(0, dot)}`,
    ext: fileName.slice(dot),
  };
}

function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, '');
}
