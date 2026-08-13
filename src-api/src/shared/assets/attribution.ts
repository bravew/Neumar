import { getDatabase } from '@/shared/db';

import { parseLicense } from './materializer-helpers';
import type { MaterializeLicense } from './materializer-types';

export type AssetAttributionFormat = 'text' | 'markdown' | 'html';

export interface AssetAttributionInput {
  scope: string;
  scopeId: string;
  format?: AssetAttributionFormat;
}

interface AttributionRow {
  asset_id: string;
  title: string | null;
  source: string;
  license_snapshot_json: string | null;
}

export function listAssetAttributions(input: AssetAttributionInput): Array<{
  assetId: string;
  title: string | null;
  source: string;
  license: MaterializeLicense;
}> {
  const rows = getDatabase()
    .prepare(
      `SELECT m.asset_id, a.title, a.source, m.license_snapshot_json
       FROM asset_materializations m
       JOIN assets a ON a.id = m.asset_id
       WHERE m.scope = ? AND m.scope_id = ?
       ORDER BY m.created_at ASC`,
    )
    .all(input.scope, input.scopeId) as AttributionRow[];
  const deduped = new Map<
    string,
    {
      assetId: string;
      title: string | null;
      source: string;
      license: MaterializeLicense;
    }
  >();
  for (const row of rows) {
    const license = parseLicense(row.license_snapshot_json);
    if (!license?.attribution && !license?.licenseCode) continue;
    const key = [
      license.provider,
      license.attribution ?? '',
      license.licenseCode ?? '',
    ].join('\0');
    deduped.set(key, {
      assetId: row.asset_id,
      title: row.title,
      source: row.source,
      license,
    });
  }
  return [...deduped.values()];
}

export function renderAssetAttributionBlock(
  input: AssetAttributionInput,
): string {
  const items = listAssetAttributions(input);
  if (items.length === 0) return '';
  const format = input.format ?? 'text';
  if (format === 'html') {
    return [
      '<section data-neuma-asset-attribution="true">',
      '<h2>Asset credits</h2>',
      '<ul>',
      ...items.map((item) => `<li>${escapeHtml(attributionLine(item))}</li>`),
      '</ul>',
      '</section>',
    ].join('');
  }
  if (format === 'markdown') {
    return [
      '## Asset credits',
      '',
      ...items.map((item) => `- ${attributionLine(item)}`),
    ].join('\n');
  }
  return items.map(attributionLine).join('\n');
}

function attributionLine(item: {
  title: string | null;
  source: string;
  license: MaterializeLicense;
}): string {
  const parts = [
    item.license.attribution ?? item.title ?? item.source,
    item.license.licenseCode ? `License: ${item.license.licenseCode}` : null,
    item.license.provider ? `Provider: ${item.license.provider}` : null,
  ].filter((part): part is string => Boolean(part));
  return parts.join(' | ');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
