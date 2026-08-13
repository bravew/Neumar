import { describe, expect, it } from 'vitest';

import {
  getCredentialConnector,
  listCredentialConnectors,
} from '@/shared/channels/slack/home/credentials';

describe('credential connectors', () => {
  it('lists linear + anthropic + openai (github/notion/atlassian moved to MCP catalog)', () => {
    const keys = listCredentialConnectors().map((c) => c.key);
    expect(keys).toEqual(
      expect.arrayContaining(['linear', 'anthropic', 'openai']),
    );
    expect(keys).not.toContain('github');
    expect(keys).not.toContain('notion');
    expect(keys).not.toContain('jira');
  });

  it('rejects placeholder pastes', () => {
    const c = getCredentialConnector('linear');
    expect(c).not.toBeNull();
    expect(c!.validateToken!('<your_token_here>')).toMatch(/placeholder/);
    expect(c!.validateToken!('YOUR_TOKEN_HERE')).toMatch(/placeholder/);
  });

  it('rejects wrong-prefix pastes', () => {
    expect(
      getCredentialConnector('linear')!.validateToken!('not-linear'),
    ).toMatch(/start with/);
    expect(
      getCredentialConnector('anthropic')!.validateToken!('sk-not-anthropic'),
    ).toMatch(/start with/);
  });

  it('accepts well-formed tokens', () => {
    expect(
      getCredentialConnector('linear')!.validateToken!(
        'lin_api_AAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      ),
    ).toBeNull();
    expect(
      getCredentialConnector('anthropic')!.validateToken!(
        'sk-ant-AAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      ),
    ).toBeNull();
    expect(
      getCredentialConnector('openai')!.validateToken!(
        'sk-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      ),
    ).toBeNull();
    expect(
      getCredentialConnector('openai')!.validateToken!(
        'sk-proj-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      ),
    ).toBeNull();
  });

  it('returns null for unknown connectors', () => {
    expect(getCredentialConnector('unknown')).toBeNull();
  });

  it('maps each connector to a canonical env var', () => {
    expect(getCredentialConnector('linear')!.envVar).toBe('LINEAR_API_KEY');
    expect(getCredentialConnector('anthropic')!.envVar).toBe(
      'ANTHROPIC_API_KEY',
    );
    expect(getCredentialConnector('openai')!.envVar).toBe('OPENAI_API_KEY');
  });
});
