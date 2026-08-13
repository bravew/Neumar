import { createHash, randomUUID } from 'crypto';
import { rename, writeFile } from 'fs/promises';

import type { SiteApiClient } from '@/shared/auth/site-api-client';
import { createLogger } from '@/shared/utils/logger';

import {
  assertNoSymlink,
  ensureCloudCacheDirectory,
  getCloudCachePath,
} from './cache-paths';
import { evaluateMimeForMaterialization } from './mime-policy';

const logger = createLogger('CloudStorage:Materializer');

export interface ContentJobIntent {
  id: string;
  connectionId: string;
  provider: string;
  providerItemId: string;
  contentFingerprint: string;
  mimeType: string;
  sizeBytes?: number;
}

export async function materializeContentJob(
  client: SiteApiClient,
  job: ContentJobIntent,
  workspaceRoot?: string,
): Promise<{ path?: string; skipped?: string; hash?: string }> {
  const decision = evaluateMimeForMaterialization({
    mimeType: job.mimeType,
    sizeBytes: job.sizeBytes,
  });
  if (decision.action === 'skip') {
    await client.patchJson(jobPath(job), {
      status: 'skipped',
      lastError: decision.reason,
    });
    return { skipped: decision.reason };
  }

  await client.patchJson(jobPath(job), { status: 'processing' });
  const target = getCloudCachePath(
    {
      provider: job.provider,
      connectionId: job.connectionId,
      providerItemId: job.providerItemId,
      fingerprint: job.contentFingerprint,
    },
    workspaceRoot,
  );
  await ensureCloudCacheDirectory(target);
  await assertNoSymlink(target);

  const stream = await client.streamGet(
    `/api/cloud-storage/connections/${job.connectionId}/items/${encodeURIComponent(
      job.providerItemId,
    )}/content?fingerprint=${encodeURIComponent(job.contentFingerprint)}`,
  );
  const body = await new Response(stream).arrayBuffer();
  const buffer = Buffer.from(body);
  const hash = createHash('sha256').update(buffer).digest('hex');
  const tempPath = `${target}.${randomUUID()}.tmp`;
  await writeFile(tempPath, buffer);
  await rename(tempPath, target);

  await client.patchJson(jobPath(job), { status: 'completed' });
  logger.debug(`Materialized cloud storage content job ${job.id} to ${target}`);
  return { path: target, hash };
}

function jobPath(job: ContentJobIntent): string {
  return `/api/cloud-storage/connections/${job.connectionId}/content-jobs/${job.id}`;
}
