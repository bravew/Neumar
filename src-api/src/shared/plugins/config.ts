import { createHash } from 'node:crypto';

import type { PluginManifest, PluginConfigField } from './manifest';

export type PluginConfigPrimitive = string | number | boolean;
export type PluginConfigPatchValue = PluginConfigPrimitive | null;

export interface StoredPluginConfigValue {
  key: string;
  value: PluginConfigPrimitive | null;
  secretName: string | null;
  sensitive: boolean;
  updatedAt: string;
}

export interface PluginConfigValidationEntry {
  key: string;
  field: PluginConfigField;
  value: PluginConfigPatchValue;
  remove: boolean;
}

export interface PluginConfigValidationResult {
  ok: boolean;
  entries: PluginConfigValidationEntry[];
  issues: string[];
}

export interface PublicPluginConfigValue {
  key: string;
  type: PluginConfigField['type'];
  label?: string;
  help?: string;
  sensitive: boolean;
  advanced: boolean;
  required: boolean;
  configured: boolean;
  value?: PluginConfigPrimitive;
  defaultValue?: PluginConfigPrimitive;
  options?: PluginConfigField['options'];
  hasValue: boolean;
  hasSecret: boolean;
  secretHint?: string;
  updatedAt?: string;
}

export interface EffectivePluginConfigValue {
  key: string;
  type: PluginConfigField['type'];
  value: PluginConfigPrimitive | undefined;
  configured: boolean;
  sensitive: boolean;
  secretName?: string;
  updatedAt?: string;
}

export function getPluginConfigFields(
  manifest: PluginManifest,
): PluginConfigField[] {
  return [...(manifest.metadata?.neuma?.configSchema ?? [])].sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0) || a.key.localeCompare(b.key),
  );
}

export function validatePluginConfigPatch(
  manifest: PluginManifest,
  values: Record<string, unknown>,
): PluginConfigValidationResult {
  const fields = getPluginConfigFields(manifest);
  const byKey = new Map(fields.map((field) => [field.key, field]));
  const entries: PluginConfigValidationEntry[] = [];
  const issues: string[] = [];

  for (const [key, raw] of Object.entries(values)) {
    const field = byKey.get(key);
    if (!field) {
      issues.push(`${key}: unknown config field`);
      continue;
    }

    if (raw === null) {
      entries.push({ key, field, value: null, remove: true });
      continue;
    }

    const coerced = coerceConfigValue(field, raw);
    if (!coerced.ok) {
      issues.push(`${key}: ${coerced.issue}`);
      continue;
    }
    entries.push({ key, field, value: coerced.value, remove: false });
  }

  return { ok: issues.length === 0, entries, issues };
}

export function buildPublicPluginConfig(
  manifest: PluginManifest,
  storedValues: readonly StoredPluginConfigValue[],
  secretHints: ReadonlyMap<string, string> = new Map(),
): PublicPluginConfigValue[] {
  const storedByKey = new Map(storedValues.map((entry) => [entry.key, entry]));
  return getPluginConfigFields(manifest).map((field) => {
    const stored = storedByKey.get(field.key);
    const defaultValue = normalizeDefault(field.default);
    const hasSecret = Boolean(stored?.secretName);
    const value =
      field.type === 'secret'
        ? undefined
        : (stored?.value ?? defaultValue ?? undefined);

    return {
      key: field.key,
      type: field.type,
      label: field.label,
      help: field.help,
      sensitive: field.sensitive === true || field.type === 'secret',
      advanced: field.advanced === true,
      required: field.required === true,
      configured: Boolean(stored),
      value,
      defaultValue,
      options: field.options,
      hasValue: Boolean(stored),
      hasSecret,
      secretHint: stored?.secretName
        ? secretHints.get(stored.secretName)
        : undefined,
      updatedAt: stored?.updatedAt,
    };
  });
}

export function buildEffectivePluginConfig(
  manifest: PluginManifest,
  storedValues: readonly StoredPluginConfigValue[],
  resolveSecret?: (name: string) => string | null,
): Record<string, PluginConfigPrimitive> {
  const effective: Record<string, PluginConfigPrimitive> = {};
  const storedByKey = new Map(storedValues.map((entry) => [entry.key, entry]));
  for (const field of getPluginConfigFields(manifest)) {
    const stored = storedByKey.get(field.key);
    if (field.type === 'secret') {
      if (!stored?.secretName || !resolveSecret) continue;
      const secret = resolveSecret(stored.secretName);
      if (secret) effective[field.key] = secret;
      continue;
    }

    const value = stored?.value ?? normalizeDefault(field.default);
    if (value !== undefined) effective[field.key] = value;
  }
  return effective;
}

export function pluginConfigSecretName(pluginId: string, key: string): string {
  const digest = createHash('sha256')
    .update(`${pluginId}:${key}`)
    .digest('hex')
    .slice(0, 40);
  return `plugin_config_${digest}`;
}

function normalizeDefault(
  value: PluginConfigField['default'],
): PluginConfigPrimitive | undefined {
  return value === undefined ? undefined : value;
}

function coerceConfigValue(
  field: PluginConfigField,
  raw: unknown,
): { ok: true; value: PluginConfigPrimitive } | { ok: false; issue: string } {
  switch (field.type) {
    case 'string':
      if (typeof raw !== 'string') return { ok: false, issue: 'must be text' };
      if (raw.length > 10_000) {
        return { ok: false, issue: 'must be 10000 characters or fewer' };
      }
      return { ok: true, value: raw };
    case 'secret':
      if (typeof raw !== 'string') return { ok: false, issue: 'must be text' };
      if (!raw) return { ok: false, issue: 'must not be empty' };
      if (raw.length > 10_000) {
        return { ok: false, issue: 'must be 10000 characters or fewer' };
      }
      return { ok: true, value: raw };
    case 'number': {
      const value =
        typeof raw === 'number'
          ? raw
          : typeof raw === 'string' && raw.trim()
            ? Number(raw)
            : Number.NaN;
      if (!Number.isFinite(value)) {
        return { ok: false, issue: 'must be a finite number' };
      }
      return { ok: true, value };
    }
    case 'boolean':
      if (typeof raw === 'boolean') return { ok: true, value: raw };
      if (raw === 'true') return { ok: true, value: true };
      if (raw === 'false') return { ok: true, value: false };
      return { ok: false, issue: 'must be true or false' };
    case 'enum':
      return coerceEnumValue(field, raw);
    default: {
      const exhaustive: never = field.type;
      return { ok: false, issue: `unsupported type ${exhaustive}` };
    }
  }
}

function coerceEnumValue(
  field: PluginConfigField,
  raw: unknown,
): { ok: true; value: PluginConfigPrimitive } | { ok: false; issue: string } {
  const options = field.options ?? [];
  if (options.length === 0) {
    return { ok: false, issue: 'must declare enum options' };
  }
  const match = options.find(
    (option) => option.value === raw || String(option.value) === String(raw),
  );
  if (!match) return { ok: false, issue: 'must match an enum option' };
  return { ok: true, value: match.value };
}
