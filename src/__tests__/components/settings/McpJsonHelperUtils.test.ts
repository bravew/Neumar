import { describe, expect, it } from 'vitest';

import {
  buildMcpPreview,
  buildMcpServerFromHelper,
  validateMcpHelperDraft,
  type McpHelperDraft,
} from '@/components/settings/tabs/mcp/McpJsonHelperUtils';

const baseDraft: McpHelperDraft = {
  name: 'Figma Context',
  transport: 'http',
  command: '',
  argsText: '',
  url: 'https://mcp.figma.com/mcp',
  authType: 'oauth2.1',
  envRows: [],
};

describe('McpJsonHelperUtils', () => {
  it('builds existing MCP settings config for remote OAuth servers', () => {
    const server = buildMcpServerFromHelper(baseDraft, new Map());

    expect(server).toMatchObject({
      id: 'app-Figma Context',
      name: 'Figma Context',
      type: 'http',
      url: 'https://mcp.figma.com/mcp',
      auth: { type: 'oauth2.1', pkce: 'S256' },
      requiresOAuth: true,
      source: 'app',
    });
  });

  it('masks env values in preview without losing applied values', () => {
    const draft: McpHelperDraft = {
      ...baseDraft,
      transport: 'stdio',
      command: 'npx',
      argsText: '-y\n@modelcontextprotocol/server-slack',
      envRows: [{ id: 'env-1', key: 'SLACK_BOT_TOKEN', valueLength: 12 }],
    };
    const envValues = new Map([['env-1', 'xoxb-secret1']]);

    const preview = buildMcpPreview(draft, envValues, true);
    const server = buildMcpServerFromHelper(draft, envValues);

    expect(preview.mcpServers['Figma Context']).toMatchObject({
      env: { SLACK_BOT_TOKEN: '**** (12 chars)' },
    });
    expect(server.env).toEqual({ SLACK_BOT_TOKEN: 'xoxb-secret1' });
  });

  it('validates remote MCP URLs before apply/copy', () => {
    expect(
      validateMcpHelperDraft({
        ...baseDraft,
        url: 'http://mcp.example.com/mcp',
      }).errors,
    ).toContain('mcpJsonHelperErrorHttps');
  });

  it('allows no-auth local HTTP MCP URLs', () => {
    expect(
      validateMcpHelperDraft({
        ...baseDraft,
        url: 'http://127.0.0.1:3333/mcp',
        authType: 'none',
      }).errors,
    ).not.toContain('mcpJsonHelperErrorHttps');
  });
});
