import path from 'node:path';

import {
  AssetRegistry,
  AssetsError,
  getAssetMaterializer,
  type Asset,
  type MaterializeResult,
} from '@/shared/assets';
import { getDatabase } from '@/shared/db';
import { extensionFromMime } from '@/shared/utils/mime-extension';

import {
  appendJsonl,
  appendProjectHistory,
  getProjectDir,
  resolveProjectPath,
} from './fs';
import { getDesignProject, patchDesignProject } from './projects';
import type { DesignOutput, DesignProject } from './types';

export interface AttachCatalogAssetToDesignInput {
  role?: 'reference' | 'inline';
  sessionId?: string;
  clientRequestId?: string;
}

export async function attachCatalogAssetToDesign(
  projectId: string,
  assetId: string,
  input: AttachCatalogAssetToDesignInput = {},
): Promise<{
  project: DesignProject;
  asset: DesignOutput;
  materialization: MaterializeResult;
}> {
  await getDesignProject(projectId);
  const registry = new AssetRegistry();
  const catalogAsset = registry.get(assetId);
  if (!catalogAsset) throw new AssetsError('Asset not found', 404);

  const materializer = getAssetMaterializer();
  const materialization = await materializer.materialize({
    assetId,
    scope: 'design_project',
    scopeId: projectId,
    reason: 'design_attach',
    sessionId: input.sessionId,
    clientRequestId: input.clientRequestId,
    role: input.role ?? 'reference',
    proxies: catalogAsset.kind === 'image' ? ['design_2k'] : [],
  });
  const relativePath = importedAssetPath(catalogAsset, materialization);
  const destination = resolveProjectPath(projectId, relativePath);
  await materializer.copyInto(materialization, destination.absolutePath, {
    strategy: 'hardlink',
  });

  const now = new Date().toISOString();
  const output: DesignOutput = {
    id: catalogAsset.id,
    kind: catalogAsset.kind,
    path: destination.relativePath,
    mime: catalogAsset.mime,
    provider: catalogAsset.source,
    providerId: catalogAsset.sourceId ?? undefined,
    createdAt: now,
  };
  const provenance = designProvenanceRow(
    projectId,
    output,
    catalogAsset,
    materialization,
    input.role ?? 'reference',
  );
  await appendJsonl(
    resolveProjectPath(projectId, 'provenance/assets.jsonl').absolutePath,
    provenance,
  );
  await appendProjectHistory(projectId, {
    type: 'asset.catalog_attached',
    at: now,
    assetId: catalogAsset.id,
    path: destination.relativePath,
    role: input.role ?? 'reference',
  });

  const current = await getDesignProject(projectId);
  const project = await patchDesignProject(projectId, {
    outputs: [
      output,
      ...current.outputs.filter((item) => item.id !== output.id),
    ],
  });
  registry.attach(
    assetId,
    { scope: 'design_project', scopeId: projectId },
    input.role ?? 'reference',
  );
  return { project, asset: output, materialization };
}

export function resolveMaterializedDesignAsset(
  projectId: string,
  assetId: string,
): { absolutePath: string; mime: string; contentHash: string | null } | null {
  const row = getDatabase()
    .prepare(
      `SELECT m.active_path, m.content_hash, a.mime
       FROM asset_materializations m
       JOIN assets a ON a.id = m.asset_id
       WHERE m.scope = 'design_project'
         AND m.scope_id = ?
         AND m.asset_id = ?
       ORDER BY m.created_at DESC
       LIMIT 1`,
    )
    .get(projectId, assetId) as
    | { active_path: string; content_hash: string | null; mime: string }
    | undefined;
  if (!row) return null;
  const absolutePath = path.resolve(row.active_path);
  const projectRoot = path.resolve(getProjectDir(projectId));
  if (
    absolutePath !== projectRoot &&
    !absolutePath.startsWith(`${projectRoot}${path.sep}`)
  ) {
    return null;
  }
  return { absolutePath, mime: row.mime, contentHash: row.content_hash };
}

export function resolveDesignInlineAsset(
  projectId: string,
  assetId: string,
  options: { preferProxy?: boolean } = {},
): {
  absolutePath: string;
  mime: string;
  source: 'materialized' | 'proxy';
} | null {
  const materialized = resolveMaterializedDesignAsset(projectId, assetId);
  if (!materialized) return null;
  if (options.preferProxy && materialized.mime.startsWith('image/')) {
    try {
      const proxy = new AssetRegistry().proxyPathFor(assetId, 'design_2k');
      return {
        absolutePath: proxy.absolutePath,
        mime: proxy.mime,
        source: 'proxy',
      };
    } catch {
      // Proxy generation is asynchronous; export falls back to the project copy
      // until assets_materialize_status reports the design_2k proxy ready.
    }
  }
  return {
    absolutePath: materialized.absolutePath,
    mime: materialized.mime,
    source: 'materialized',
  };
}

function importedAssetPath(
  asset: Asset,
  materialization: MaterializeResult,
): string {
  const ext =
    path.extname(materialization.activePath) ||
    extensionFromMime(asset.mime) ||
    '.bin';
  const safeId = asset.id.replace(/[^\w.-]/g, '_');
  return `assets/imports/${safeId}${ext}`;
}

function designProvenanceRow(
  projectId: string,
  output: DesignOutput,
  asset: Asset,
  materialization: MaterializeResult,
  role: 'reference' | 'inline',
) {
  return {
    assetId: output.id,
    projectId,
    surface: output.kind,
    path: output.path,
    provider: asset.source,
    source: {
      type: 'catalog',
      assetId: asset.id,
      sourceId: asset.sourceId,
      connectionId: asset.connectionId,
    },
    role,
    license: materialization.license,
    createdAt: output.createdAt,
    disclosureText: disclosureText(asset, materialization),
  };
}

function disclosureText(
  asset: Asset,
  materialization: MaterializeResult,
): string {
  const license = materialization.license;
  const parts = [
    `Imported from ${asset.source}`,
    license?.licenseCode ? `license: ${license.licenseCode}` : null,
    license?.attributionRequired ? 'attribution required' : null,
    license?.attribution ?? null,
  ].filter((part): part is string => Boolean(part));
  return parts.join(' · ');
}
