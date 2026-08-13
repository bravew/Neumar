import { describe, expect, it } from 'vitest';

import {
  externalMcpStatusForConfig,
  listExternalMcpTemplates,
} from '@/shared/mcp/external-client/templates';

describe('external MCP templates', () => {
  it('returns the curated DesignMode starter set', () => {
    const templates = listExternalMcpTemplates();

    expect(templates).toHaveLength(12);
    expect(templates.map((template) => template.id)).toEqual(
      expect.arrayContaining(['figma-context', 'mermaid', 'pollinations']),
    );
    expect(
      templates.find((template) => template.id === 'figma-context'),
    ).toMatchObject({
      auth: 'oauth',
      transport: 'http',
    });
  });

  it('reports non-secret connection status from config shape only', () => {
    expect(externalMcpStatusForConfig('figma', undefined)).toEqual({
      serverId: 'figma',
      connected: false,
    });
    expect(
      externalMcpStatusForConfig('figma', {
        figma: { headers: { Authorization: 'Bearer secret-token' } },
      }),
    ).toEqual({
      serverId: 'figma',
      connected: true,
    });
  });
});
