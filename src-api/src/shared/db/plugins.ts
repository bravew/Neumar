/**
 * Plugin DB operations
 *
 * CRUD over the `installed_plugins` table created by migration 005.
 * Kept in its own file (rather than extending the giant `operations.ts`)
 * because the plugin/marketplace surface owns its own schema and lifecycle.
 */

import type { PluginScope } from '@/shared/plugins';
import type { PluginConfigPrimitive } from '@/shared/plugins/config';
import type { TrustTier } from '@/shared/plugins/runtime';

import { getDatabase } from './index';
import { hasColumn } from './migrations/utils';

export type PluginSource = 'github' | 'url' | 'local' | 'bundled';

export type MarketplaceTrust = 'official' | 'restricted';

export interface InstalledPluginRow {
  id: string;
  name: string;
  version: string;
  source: PluginSource;
  source_ref: string | null;
  install_path: string;
  scope: PluginScope;
  enabled: 0 | 1;
  manifest_json: string;
  sha256: string | null;
  signature_ok: 0 | 1 | null;
  trust_tier?: TrustTier | null;
  manifest_digest?: string | null;
  last_reviewed_digest?: string | null;
  source_marketplace_id?: string | null;
  source_entry_name?: string | null;
  source_entry_version?: string | null;
  marketplace_trust?: MarketplaceTrust | null;
  installed_at: string;
  updated_at: string;
}

export interface InstalledPlugin {
  id: string;
  name: string;
  version: string;
  source: PluginSource;
  sourceRef: string | null;
  installPath: string;
  scope: PluginScope;
  enabled: boolean;
  manifest: unknown;
  sha256: string | null;
  signatureOk: boolean | null;
  trustTier: TrustTier | null;
  manifestDigest: string | null;
  lastReviewedDigest: string | null;
  /** Marketplace provenance: which source/entry this install came from. */
  sourceMarketplaceId: string | null;
  sourceEntryName: string | null;
  sourceEntryVersion: string | null;
  /** Trust of the source at install time — user-assigned, never from catalog. */
  marketplaceTrust: MarketplaceTrust | null;
  installedAt: string;
  updatedAt: string;
}

export interface PluginConfigValueRow {
  plugin_id: string;
  key: string;
  value_json: string | null;
  secret_name: string | null;
  sensitive: 0 | 1;
  updated_at: string;
}

export interface PluginConfigValue {
  key: string;
  value: PluginConfigPrimitive | null;
  secretName: string | null;
  sensitive: boolean;
  updatedAt: string;
}

function rowToPlugin(row: InstalledPluginRow): InstalledPlugin {
  let manifest: unknown = null;
  try {
    manifest = JSON.parse(row.manifest_json);
  } catch {
    // tolerate corrupt rows; surface as null
  }
  return {
    id: row.id,
    name: row.name,
    version: row.version,
    source: row.source,
    sourceRef: row.source_ref,
    installPath: row.install_path,
    scope: row.scope,
    enabled: row.enabled === 1,
    manifest,
    sha256: row.sha256,
    signatureOk: row.signature_ok === null ? null : row.signature_ok === 1,
    trustTier: row.trust_tier ?? null,
    manifestDigest: row.manifest_digest ?? null,
    lastReviewedDigest: row.last_reviewed_digest ?? null,
    sourceMarketplaceId: row.source_marketplace_id ?? null,
    sourceEntryName: row.source_entry_name ?? null,
    sourceEntryVersion: row.source_entry_version ?? null,
    marketplaceTrust: row.marketplace_trust ?? null,
    installedAt: row.installed_at,
    updatedAt: row.updated_at,
  };
}

function rowToConfigValue(row: PluginConfigValueRow): PluginConfigValue {
  let value: PluginConfigPrimitive | null = null;
  if (row.value_json !== null) {
    try {
      const parsed = JSON.parse(row.value_json) as unknown;
      if (
        typeof parsed === 'string' ||
        typeof parsed === 'number' ||
        typeof parsed === 'boolean'
      ) {
        value = parsed;
      }
    } catch {
      value = null;
    }
  }
  return {
    key: row.key,
    value,
    secretName: row.secret_name,
    sensitive: row.sensitive === 1,
    updatedAt: row.updated_at,
  };
}

export interface UpsertInstalledPluginInput {
  id: string;
  name: string;
  version: string;
  source: PluginSource;
  sourceRef?: string | null;
  installPath: string;
  scope: PluginScope;
  enabled?: boolean;
  manifest: unknown;
  sha256?: string | null;
  signatureOk?: boolean | null;
  trustTier?: TrustTier | null;
  manifestDigest?: string | null;
  lastReviewedDigest?: string | null;
  sourceMarketplaceId?: string | null;
  sourceEntryName?: string | null;
  sourceEntryVersion?: string | null;
  marketplaceTrust?: MarketplaceTrust | null;
}

export function upsertInstalledPlugin(
  input: UpsertInstalledPluginInput,
): InstalledPlugin {
  const db = getDatabase();
  const now = new Date().toISOString();
  const signatureOk =
    input.signatureOk === undefined || input.signatureOk === null
      ? null
      : input.signatureOk
        ? 1
        : 0;

  // Base columns always exist (migration 005); trust and provenance columns
  // arrived in later migrations, so include them only when present.
  const columns: Record<string, unknown> = {
    id: input.id,
    name: input.name,
    version: input.version,
    source: input.source,
    source_ref: input.sourceRef ?? null,
    install_path: input.installPath,
    scope: input.scope,
    enabled: input.enabled === false ? 0 : 1,
    manifest_json: JSON.stringify(input.manifest ?? {}),
    sha256: input.sha256 ?? null,
    signature_ok: signatureOk,
  };
  if (pluginTrustColumnsAvailable(db)) {
    columns.trust_tier = input.trustTier ?? 'local';
    columns.manifest_digest = input.manifestDigest ?? null;
    columns.last_reviewed_digest = input.lastReviewedDigest ?? null;
  }
  if (pluginProvenanceColumnsAvailable(db)) {
    columns.source_marketplace_id = input.sourceMarketplaceId ?? null;
    columns.source_entry_name = input.sourceEntryName ?? null;
    columns.source_entry_version = input.sourceEntryVersion ?? null;
    columns.marketplace_trust = input.marketplaceTrust ?? null;
  }

  const names = Object.keys(columns);
  const updates = names
    .filter((name) => name !== 'id')
    .map((name) => `${name} = excluded.${name}`);
  db.prepare(
    `INSERT INTO installed_plugins
       (${names.join(', ')}, installed_at, updated_at)
     VALUES (${names.map((name) => `@${name}`).join(', ')}, @now, @now)
     ON CONFLICT(id) DO UPDATE SET
       ${updates.join(',\n       ')},
       updated_at = excluded.updated_at`,
  ).run({ ...columns, now });

  const row = db
    .prepare('SELECT * FROM installed_plugins WHERE id = ?')
    .get(input.id) as InstalledPluginRow;
  return rowToPlugin(row);
}

function pluginTrustColumnsAvailable(
  db: ReturnType<typeof getDatabase>,
): boolean {
  return (
    hasColumn(db, 'installed_plugins', 'trust_tier') &&
    hasColumn(db, 'installed_plugins', 'manifest_digest') &&
    hasColumn(db, 'installed_plugins', 'last_reviewed_digest')
  );
}

function pluginProvenanceColumnsAvailable(
  db: ReturnType<typeof getDatabase>,
): boolean {
  return hasColumn(db, 'installed_plugins', 'source_marketplace_id');
}

export function listInstalledPlugins(filter?: {
  scope?: PluginScope;
  enabledOnly?: boolean;
}): InstalledPlugin[] {
  const db = getDatabase();
  const where: string[] = [];
  const args: unknown[] = [];
  if (filter?.scope) {
    where.push('scope = ?');
    args.push(filter.scope);
  }
  if (filter?.enabledOnly) {
    where.push('enabled = 1');
  }
  const sql = `SELECT * FROM installed_plugins ${
    where.length ? 'WHERE ' + where.join(' AND ') : ''
  } ORDER BY name ASC`;
  const rows = db.prepare(sql).all(...args) as InstalledPluginRow[];
  return rows.map(rowToPlugin);
}

export function getInstalledPlugin(id: string): InstalledPlugin | null {
  const db = getDatabase();
  const row = db
    .prepare('SELECT * FROM installed_plugins WHERE id = ?')
    .get(id) as InstalledPluginRow | undefined;
  return row ? rowToPlugin(row) : null;
}

export function getInstalledPluginByName(name: string): InstalledPlugin | null {
  const db = getDatabase();
  const row = db
    .prepare('SELECT * FROM installed_plugins WHERE name = ? LIMIT 1')
    .get(name) as InstalledPluginRow | undefined;
  return row ? rowToPlugin(row) : null;
}

export function setPluginEnabled(id: string, enabled: boolean): boolean {
  const db = getDatabase();
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `UPDATE installed_plugins
         SET enabled = ?, updated_at = ?
         WHERE id = ?`,
    )
    .run(enabled ? 1 : 0, now, id);
  return result.changes > 0;
}

export function deleteInstalledPlugin(id: string): boolean {
  const db = getDatabase();
  const result = db
    .prepare('DELETE FROM installed_plugins WHERE id = ?')
    .run(id);
  return result.changes > 0;
}

export interface BundledPluginSeed {
  id: string;
  name: string;
  version: string;
  installPath: string;
  manifest: unknown;
}

/**
 * Reconcile discovered bundled plugins into `installed_plugins` so they carry
 * identity + an enabled flag and surface in the Plugins tab as "Built-in".
 *
 * Insert-if-absent: a new bundled plugin is added enabled; an existing row has
 * its manifest/version/path refreshed but its `enabled` flag preserved, so a
 * user's disable survives restarts. Returns the number of rows inserted.
 */
export function reconcileBundledPlugins(seeds: BundledPluginSeed[]): number {
  const db = getDatabase();
  const now = new Date().toISOString();
  const insert = db.prepare(
    `INSERT INTO installed_plugins
       (id, name, version, source, source_ref, install_path, scope, enabled,
        manifest_json, sha256, signature_ok, installed_at, updated_at)
     VALUES (@id, @name, @version, 'bundled', NULL, @installPath, 'bundled', 1,
             @manifestJson, NULL, NULL, @now, @now)`,
  );
  const update = db.prepare(
    `UPDATE installed_plugins
        SET version = @version, install_path = @installPath,
            manifest_json = @manifestJson, updated_at = @now
      WHERE id = @id`,
  );
  const existing = db.prepare('SELECT id FROM installed_plugins WHERE id = ?');

  let inserted = 0;
  const tx = db.transaction((rows: BundledPluginSeed[]) => {
    for (const row of rows) {
      const args = {
        id: row.id,
        name: row.name,
        version: row.version,
        installPath: row.installPath,
        manifestJson: JSON.stringify(row.manifest ?? {}),
        now,
      };
      if (existing.get(row.id)) {
        update.run(args);
      } else {
        insert.run(args);
        inserted += 1;
      }
    }
  });
  tx(seeds);
  return inserted;
}

/**
 * Names of every plugin marked disabled. Loaders consult this to skip disabled
 * plugins (including built-ins) without re-reading each row.
 */
export function getDisabledPluginNames(): Set<string> {
  const rows = getDatabase()
    .prepare('SELECT name FROM installed_plugins WHERE enabled = 0')
    .all() as Array<{ name: string }>;
  return new Set(rows.map((row) => row.name));
}

export interface UpsertPluginConfigValueInput {
  pluginId: string;
  key: string;
  value?: PluginConfigPrimitive | null;
  secretName?: string | null;
  sensitive?: boolean;
}

export function listPluginConfigValues(pluginId: string): PluginConfigValue[] {
  const db = getDatabase();
  const rows = db
    .prepare(
      `SELECT plugin_id, key, value_json, secret_name, sensitive, updated_at
         FROM plugin_config_values
        WHERE plugin_id = ?
        ORDER BY key ASC`,
    )
    .all(pluginId) as PluginConfigValueRow[];
  return rows.map(rowToConfigValue);
}

export function upsertPluginConfigValue(
  input: UpsertPluginConfigValueInput,
): PluginConfigValue {
  const db = getDatabase();
  const now = new Date().toISOString();
  const valueJson =
    input.value === undefined || input.value === null
      ? null
      : JSON.stringify(input.value);
  db.prepare(
    `INSERT INTO plugin_config_values
       (plugin_id, key, value_json, secret_name, sensitive, updated_at)
     VALUES (@pluginId, @key, @valueJson, @secretName, @sensitive, @now)
     ON CONFLICT(plugin_id, key) DO UPDATE SET
       value_json  = excluded.value_json,
       secret_name = excluded.secret_name,
       sensitive   = excluded.sensitive,
       updated_at  = excluded.updated_at`,
  ).run({
    pluginId: input.pluginId,
    key: input.key,
    valueJson,
    secretName: input.secretName ?? null,
    sensitive: input.sensitive ? 1 : 0,
    now,
  });

  const row = db
    .prepare(
      `SELECT plugin_id, key, value_json, secret_name, sensitive, updated_at
         FROM plugin_config_values
        WHERE plugin_id = ? AND key = ?`,
    )
    .get(input.pluginId, input.key) as PluginConfigValueRow;
  return rowToConfigValue(row);
}

export function deletePluginConfigValue(
  pluginId: string,
  key: string,
): PluginConfigValue | null {
  const db = getDatabase();
  const existing = db
    .prepare(
      `SELECT plugin_id, key, value_json, secret_name, sensitive, updated_at
         FROM plugin_config_values
        WHERE plugin_id = ? AND key = ?`,
    )
    .get(pluginId, key) as PluginConfigValueRow | undefined;
  if (!existing) return null;
  db.prepare(
    'DELETE FROM plugin_config_values WHERE plugin_id = ? AND key = ?',
  ).run(pluginId, key);
  return rowToConfigValue(existing);
}

export function deletePluginConfigValues(
  pluginId: string,
): PluginConfigValue[] {
  const existing = listPluginConfigValues(pluginId);
  const db = getDatabase();
  db.prepare('DELETE FROM plugin_config_values WHERE plugin_id = ?').run(
    pluginId,
  );
  return existing;
}
