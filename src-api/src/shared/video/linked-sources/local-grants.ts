import { randomUUID } from 'node:crypto';

import { assertSafeLocalSourceRoot } from './local-fs';

interface LocalFolderGrant {
  rootPath: string;
  expiresAt: number;
}

const GRANT_TTL_MS = 10 * 60 * 1000;
const grants = new Map<string, LocalFolderGrant>();

export async function createLocalFolderGrant(rawPath: string): Promise<{
  token: string;
  rootPath: string;
  expiresAt: string;
}> {
  pruneExpiredGrants();
  const rootPath = await assertSafeLocalSourceRoot(rawPath);
  const token = randomUUID();
  const expiresAt = Date.now() + GRANT_TTL_MS;
  grants.set(token, { rootPath, expiresAt });
  return { token, rootPath, expiresAt: new Date(expiresAt).toISOString() };
}

export async function consumeLocalFolderGrant(
  rawPath: string,
  token: string | undefined,
): Promise<string> {
  pruneExpiredGrants();
  if (!token) throw new Error('Local folder grant token is required');
  const rootPath = await assertSafeLocalSourceRoot(rawPath);
  const grant = grants.get(token);
  if (!grant || grant.rootPath !== rootPath) {
    throw new Error('Local folder grant token is invalid or expired');
  }
  grants.delete(token);
  return rootPath;
}

function pruneExpiredGrants(): void {
  const now = Date.now();
  for (const [token, grant] of grants.entries()) {
    if (grant.expiresAt <= now) grants.delete(token);
  }
}
