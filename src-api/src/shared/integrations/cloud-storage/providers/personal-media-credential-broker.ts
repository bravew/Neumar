import type { SiteApiClient } from '@/shared/auth/site-api-client';

import { CloudStorageError } from '../errors';
import { getLocalPersonalMediaCredential } from '../personal-media/local-personal-media-store';
import { validatePersonalMediaBaseUrl } from '../personal-media/url-policy';

const CACHE_SKEW_MS = 5_000;

export interface PersonalMediaCredential {
  credentialId: string;
  provider: 'immich' | 'photoprism';
  baseUrl: string;
  apiKey: string;
  serverVersion?: string;
  serverInstanceId?: string;
  userId?: string;
  displayName?: string;
  expiresAt: string;
}

export interface PersonalMediaCredentialResolver {
  resolve(connectionId: string): Promise<PersonalMediaCredential>;
}

interface CredentialHandleResponse {
  handle?: unknown;
  expiresAt: string;
}

interface CredentialRedeemResponse {
  expiresAt: string;
  credential?: {
    credentialId?: unknown;
    provider?: unknown;
    baseUrl?: unknown;
    apiKey?: unknown;
    serverVersion?: unknown;
    serverInstanceId?: unknown;
    userId?: unknown;
    displayName?: unknown;
  };
}

export class PersonalMediaCredentialBroker implements PersonalMediaCredentialResolver {
  private readonly cache = new Map<string, PersonalMediaCredential>();

  constructor(private readonly siteApiClient: SiteApiClient) {}

  async resolve(connectionId: string): Promise<PersonalMediaCredential> {
    const local = getLocalPersonalMediaCredential(connectionId);
    if (local) {
      return {
        credentialId: local.credentialId,
        provider: local.provider,
        baseUrl: local.baseUrl,
        apiKey: local.apiKey,
        serverVersion: local.serverVersion,
        serverInstanceId: local.serverInstanceId,
        userId: local.userId,
        displayName: local.displayName,
        expiresAt: new Date(
          Date.now() + 365 * 24 * 60 * 60 * 1000,
        ).toISOString(),
      };
    }

    const cached = this.cache.get(connectionId);
    if (cached && Date.parse(cached.expiresAt) - CACHE_SKEW_MS > Date.now()) {
      return cached;
    }

    const response = await this.siteApiClient.getJson<CredentialHandleResponse>(
      `/api/cloud-storage/connections/${encodeURIComponent(
        connectionId,
      )}/credential-handle`,
    );
    const handle = parseHandle(response);
    const credential = parseCredentialHandle(
      await this.siteApiClient.postJson<CredentialRedeemResponse>(
        `/api/cloud-storage/connections/${encodeURIComponent(
          connectionId,
        )}/credential-handle`,
        { handle },
      ),
    );
    const baseUrlResult = validatePersonalMediaBaseUrl(credential.baseUrl, {
      allowLan: true,
    });
    if (!baseUrlResult.valid) {
      throw new CloudStorageError(
        'permission_denied',
        'Personal media credential handle returned a blocked base URL',
        { details: baseUrlResult.reason },
      );
    }

    this.cache.set(connectionId, credential);
    return credential;
  }

  clear(connectionId?: string): void {
    if (connectionId) {
      this.cache.delete(connectionId);
      return;
    }
    this.cache.clear();
  }
}

function parseCredentialHandle(
  response: CredentialRedeemResponse,
): PersonalMediaCredential {
  const credential = response.credential;
  if (!credential) {
    throw new CloudStorageError(
      'transient_upstream',
      'Invalid personal media credential handle response',
      { details: response },
    );
  }

  const provider = parseString(credential?.provider);
  const credentialId = parseString(credential?.credentialId);
  const baseUrl = parseString(credential?.baseUrl);
  const apiKey = parseString(credential?.apiKey);
  const expiresAt = parseString(response.expiresAt);

  if (
    !credentialId ||
    (provider !== 'immich' && provider !== 'photoprism') ||
    !baseUrl ||
    !apiKey ||
    !expiresAt ||
    !Number.isFinite(Date.parse(expiresAt))
  ) {
    throw new CloudStorageError(
      'transient_upstream',
      'Invalid personal media credential handle response',
      { details: response },
    );
  }

  return {
    credentialId,
    provider,
    baseUrl,
    apiKey,
    expiresAt,
    serverVersion: parseString(credential.serverVersion),
    serverInstanceId: parseString(credential.serverInstanceId),
    userId: parseString(credential.userId),
    displayName: parseString(credential.displayName),
  };
}

function parseHandle(response: CredentialHandleResponse): string {
  if (typeof response.handle !== 'string' || response.handle.trim() === '') {
    throw new CloudStorageError(
      'transient_upstream',
      'Invalid personal media credential handle response',
      { details: response },
    );
  }
  return response.handle;
}

function parseString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== ''
    ? value.trim()
    : undefined;
}
