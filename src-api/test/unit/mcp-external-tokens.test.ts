import fs from 'fs/promises';
import os from 'os';
import { join } from 'path';

import { refreshAuthorization } from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  AuthorizationServerMetadata,
  OAuthClientInformationMixed,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const tokenPath = vi.hoisted(() => ({ value: '' }));

vi.mock('@/config/constants', () => ({
  getMcpOAuthTokensPath: () => tokenPath.value,
}));

vi.mock('@/shared/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('@modelcontextprotocol/sdk/client/auth.js', () => ({
  refreshAuthorization: vi.fn(),
}));

const metadata: AuthorizationServerMetadata = {
  issuer: 'https://auth.example.com',
  authorization_endpoint: 'https://auth.example.com/authorize',
  token_endpoint: 'https://auth.example.com/token',
  response_types_supported: ['code'],
};

const clientInfo: OAuthClientInformationMixed = {
  client_id: 'client-123',
};

describe('external MCP OAuth token store', () => {
  beforeEach(async () => {
    const dir = await fs.mkdtemp(join(os.tmpdir(), 'mcp-tokens-'));
    tokenPath.value = join(dir, 'mcp-oauth.enc.json');
    vi.mocked(refreshAuthorization).mockReset();
  });

  it('stores OAuth tokens encrypted and resolves authorization headers', async () => {
    const {
      getExternalMcpAuthorizationHeader,
      getExternalMcpTokenMetadata,
      saveExternalMcpTokens,
    } = await import('@/shared/mcp/external-client/tokens');

    const saved = await saveExternalMcpTokens({
      serverId: 'figma',
      serverUrl: 'https://mcp.figma.com/mcp',
      authServerBase: 'https://auth.example.com',
      clientInfo,
      metadata,
      tokens: {
        access_token: 'secret-access-token',
        refresh_token: 'secret-refresh-token',
        token_type: 'Bearer',
        expires_in: 3600,
        scope: 'files:read comments:read',
      },
    });

    const disk = await fs.readFile(tokenPath.value, 'utf-8');
    expect(disk).not.toContain('secret-access-token');
    expect(disk).not.toContain('secret-refresh-token');
    if (os.platform() !== 'win32') {
      const stat = await fs.stat(tokenPath.value);
      expect(stat.mode & 0o777).toBe(0o600);
    }
    await expect(getExternalMcpAuthorizationHeader('figma')).resolves.toBe(
      'Bearer secret-access-token',
    );
    await expect(getExternalMcpTokenMetadata('figma')).resolves.toEqual({
      ...saved,
      scopes: ['files:read', 'comments:read'],
    });
  });

  it('refreshes expired access tokens and persists the replacement encrypted', async () => {
    const { getExternalMcpAuthorizationHeader, saveExternalMcpTokens } =
      await import('@/shared/mcp/external-client/tokens');

    await saveExternalMcpTokens({
      serverId: 'figma',
      serverUrl: 'https://mcp.figma.com/mcp',
      authServerBase: 'https://auth.example.com',
      clientInfo,
      metadata,
      tokens: {
        access_token: 'old-access-token',
        refresh_token: 'old-refresh-token',
        token_type: 'Bearer',
        expires_in: -10,
        scope: 'files:read',
      },
    });
    vi.mocked(refreshAuthorization).mockResolvedValueOnce({
      access_token: 'new-access-token',
      refresh_token: 'new-refresh-token',
      token_type: 'Bearer',
      expires_in: 3600,
      scope: 'files:read',
    });

    await expect(getExternalMcpAuthorizationHeader('figma')).resolves.toBe(
      'Bearer new-access-token',
    );
    expect(refreshAuthorization).toHaveBeenCalledWith(
      'https://auth.example.com',
      {
        metadata,
        clientInformation: clientInfo,
        refreshToken: 'old-refresh-token',
      },
    );
    const disk = await fs.readFile(tokenPath.value, 'utf-8');
    expect(disk).not.toContain('old-access-token');
    expect(disk).not.toContain('new-access-token');
    expect(disk).not.toContain('new-refresh-token');
  });

  it('removes stored token records', async () => {
    const {
      getExternalMcpAuthorizationHeader,
      removeExternalMcpTokens,
      saveExternalMcpTokens,
    } = await import('@/shared/mcp/external-client/tokens');

    await saveExternalMcpTokens({
      serverId: 'figma',
      serverUrl: 'https://mcp.figma.com/mcp',
      authServerBase: 'https://auth.example.com',
      clientInfo,
      metadata,
      tokens: {
        access_token: 'secret-access-token',
        token_type: 'Bearer',
      },
    });

    await expect(removeExternalMcpTokens('figma')).resolves.toBe(true);
    await expect(
      getExternalMcpAuthorizationHeader('figma'),
    ).resolves.toBeNull();
    await expect(removeExternalMcpTokens('figma')).resolves.toBe(false);
  });
});
