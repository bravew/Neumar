import { getDatabase } from '@/shared/db';

import { isAssetsCatalogEnabled } from './flags';
import type { AttachmentScope } from './types';

export interface CatalogPreambleInput {
  scope: AttachmentScope['scope'];
  scopeId: string;
  attachedCap?: number;
}

interface CountRow {
  kind: string;
  count: number;
}

interface AttachedRow {
  id: string;
  kind: string;
  title: string | null;
  bytes: number;
  source: string;
  provenance_json: string | null;
}

export async function composeCatalogPreamble(
  input: CatalogPreambleInput,
): Promise<string> {
  if (!isAssetsCatalogEnabled()) return '';
  const db = getDatabase();
  const counts = db
    .prepare(
      `SELECT kind, COUNT(*) AS count
       FROM assets
       WHERE deleted_at IS NULL
       GROUP BY kind
       ORDER BY kind`,
    )
    .all() as CountRow[];
  const total = counts.reduce((sum, row) => sum + row.count, 0);
  if (total === 0) return '';

  const attached = db
    .prepare(
      `SELECT a.id, a.kind, a.title, a.bytes, a.source, a.provenance_json
       FROM assets a
       JOIN asset_attachments aa ON aa.asset_id = a.id
       WHERE a.deleted_at IS NULL AND aa.scope = ? AND aa.scope_id = ?
       ORDER BY aa.attached_at DESC
       LIMIT ?`,
    )
    .all(input.scope, input.scopeId, input.attachedCap ?? 10) as AttachedRow[];
  const countText = counts.map((row) => `${row.count} ${row.kind}`).join(', ');
  const lines = [
    '<!-- catalog-context-v1 -->',
    '## Workspace asset catalog',
    `Workspace has ${total} assets (${countText}). This project has ${attached.length} attached. Use assets_search before generating new media when an existing asset may fit.`,
  ];
  if (attached.length) {
    lines.push('Recent attached assets:');
    for (const row of attached) {
      lines.push(
        `- ${row.id} · ${row.kind} · "${row.title ?? row.id}" · ${formatBytes(row.bytes)} · ${row.source}${licenseHint(row.provenance_json)}`,
      );
    }
  }
  lines.push('<!-- /catalog-context-v1 -->');
  return lines.join('\n');
}

function licenseHint(raw: string | null): string {
  if (!raw) return '';
  try {
    const parsed = JSON.parse(raw) as {
      licenseInfo?: { requiresAttribution?: boolean; provider?: string };
    };
    if (!parsed.licenseInfo?.requiresAttribution) return '';
    return ` · attribution required${parsed.licenseInfo.provider ? ` (${parsed.licenseInfo.provider})` : ''}`;
  } catch {
    return '';
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}
