import { listPluginConfigValues } from '@/shared/db/plugins';
import {
  buildEffectivePluginConfig,
  getPluginConfigFields,
  type PluginConfigPrimitive,
} from '@/shared/plugins/config';
import type { PluginManifest } from '@/shared/plugins/manifest';
import { getSecret } from '@/shared/security/secrets';

import type { AppliedSnapshotConfig } from './snapshot';

export interface PluginRuntimeConfig {
  values: Record<string, PluginConfigPrimitive>;
  publicValues: Record<string, PluginConfigPrimitive>;
  keys: string[];
  sensitiveKeys: string[];
}

export function resolveInstalledPluginRuntimeConfig(
  pluginId: string,
  manifest: PluginManifest,
): PluginRuntimeConfig {
  const fields = getPluginConfigFields(manifest);
  if (fields.length === 0) return emptyPluginRuntimeConfig();

  const values = buildEffectivePluginConfig(
    manifest,
    listPluginConfigValues(pluginId),
    getSecret,
  );
  return buildPluginRuntimeConfig(manifest, values);
}

export function buildPluginRuntimeConfig(
  manifest: PluginManifest,
  values: Record<string, PluginConfigPrimitive>,
): PluginRuntimeConfig {
  const fields = getPluginConfigFields(manifest);
  if (fields.length === 0) return emptyPluginRuntimeConfig();

  const sensitive = new Set(
    fields
      .filter((field) => field.type === 'secret' || field.sensitive === true)
      .map((field) => field.key),
  );
  const keys = Object.keys(values).sort();
  const sensitiveKeys = keys.filter((key) => sensitive.has(key));
  const publicValues = Object.fromEntries(
    keys.filter((key) => !sensitive.has(key)).map((key) => [key, values[key]]),
  ) as Record<string, PluginConfigPrimitive>;

  return {
    values: { ...values },
    publicValues,
    keys,
    sensitiveKeys,
  };
}

export function toAppliedSnapshotConfig(
  config: PluginRuntimeConfig | undefined,
): AppliedSnapshotConfig | undefined {
  if (!config || config.keys.length === 0) return undefined;
  return {
    keys: [...config.keys],
    sensitiveKeys: [...config.sensitiveKeys],
    publicValues: { ...config.publicValues },
  };
}

function emptyPluginRuntimeConfig(): PluginRuntimeConfig {
  return {
    values: {},
    publicValues: {},
    keys: [],
    sensitiveKeys: [],
  };
}
