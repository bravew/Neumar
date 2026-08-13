import fs from 'node:fs/promises';
import path from 'node:path';

export function linkedCacheDir(
  workspaceRoot: string,
  projectId: string,
  sourceId: string,
): string {
  return path.join(
    workspaceRoot,
    '.neuma',
    'video',
    projectId,
    '.linked-cache',
    sourceId,
  );
}

export function thumbnailPathForAsset(
  workspaceRoot: string,
  projectId: string,
  sourceId: string,
  assetId: string,
): string {
  return path.join(
    linkedCacheDir(workspaceRoot, projectId, sourceId),
    `${assetId}.jpg`,
  );
}

export async function purgeLinkedSourceCache(
  workspaceRoot: string,
  projectId: string,
  sourceId: string,
): Promise<void> {
  await fs.rm(linkedCacheDir(workspaceRoot, projectId, sourceId), {
    recursive: true,
    force: true,
  });
}

export async function canWriteThumbnail(
  workspaceRoot: string,
  projectId: string,
  sourceId: string,
  maxBytes: number,
  incomingBytes: number,
): Promise<boolean> {
  if (incomingBytes > maxBytes) return false;
  const current = await directorySize(
    linkedCacheDir(workspaceRoot, projectId, sourceId),
  );
  return current + incomingBytes <= maxBytes;
}

async function directorySize(dir: string): Promise<number> {
  let total = 0;
  let entries: Array<{ name: string; isDirectory(): boolean }>;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const child = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += await directorySize(child);
      continue;
    }
    try {
      total += (await fs.stat(child)).size;
    } catch {
      // Ignore cache files removed by concurrent cleanup.
    }
  }
  return total;
}
