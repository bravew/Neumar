import { createHash } from 'node:crypto';

import type { Capability } from './capability-registry';
import type { TrustTier } from './capability-registry';

export interface AppliedSnapshotConfig {
  keys: string[];
  sensitiveKeys: string[];
  publicValues: Record<string, string | number | boolean>;
}

export interface AppliedSnapshot<TPayload = unknown> {
  id: string;
  domain: string;
  plugin: {
    id: string;
    name: string;
    version: string;
    source?: string;
    trustTier: TrustTier;
    manifestDigest: string;
  };
  capabilities: Capability[];
  config?: AppliedSnapshotConfig;
  payload: TPayload;
  createdAt: string;
}

export interface CreateAppliedSnapshotInput<TPayload> {
  domain: string;
  plugin: AppliedSnapshot<TPayload>['plugin'];
  capabilities: readonly Capability[];
  config?: AppliedSnapshotConfig;
  payload: TPayload;
  createdAt?: string;
}

export function createAppliedSnapshot<TPayload>(
  input: CreateAppliedSnapshotInput<TPayload>,
): AppliedSnapshot<TPayload> {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const config = input.config
    ? normalizeAppliedSnapshotConfig(input.config)
    : undefined;
  const digestInput = {
    domain: input.domain,
    plugin: input.plugin,
    capabilities: [...input.capabilities].sort(),
    ...(config ? { config } : {}),
    payload: input.payload,
    createdAt,
  };
  const id = digestStableJson(digestInput);
  const snapshot: AppliedSnapshot<TPayload> = {
    id,
    domain: input.domain,
    plugin: input.plugin,
    capabilities: [...input.capabilities].sort(),
    ...(config ? { config } : {}),
    payload: input.payload,
    createdAt,
  };
  return deepFreeze(snapshot);
}

export function digestStableJson(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
  }
  return value;
}

function normalizeAppliedSnapshotConfig(
  config: AppliedSnapshotConfig,
): AppliedSnapshotConfig {
  return {
    keys: [...new Set(config.keys)].sort(),
    sensitiveKeys: [...new Set(config.sensitiveKeys)].sort(),
    publicValues: { ...config.publicValues },
  };
}
