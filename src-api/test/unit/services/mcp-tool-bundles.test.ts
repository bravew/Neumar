import { describe, expect, it } from 'vitest';

import {
  mcpAllowedToolNames,
  mcpSelectionTraceAttrs,
  selectMcpServers,
  selectMcpToolBundles,
  summarizeMcpSelection,
} from '@/shared/mcp/tool-bundles';

describe('MCP tool bundles', () => {
  it('selects focused bundles from plan text', () => {
    const plan = {
      steps: [
        { description: 'Use Figma context and generate a product screenshot.' },
        { description: 'Open a GitHub pull request for the artifact.' },
      ],
    };

    expect(selectMcpToolBundles(plan)).toEqual(
      new Set(['design-context', 'issue-tracker', 'media-generation']),
    );
    expect(selectMcpServers(plan)).toEqual(
      new Set([
        'assets',
        'cloud-storage-media',
        'ffmpeg',
        'figma',
        'github',
        'linear',
        'media',
        'speech',
        'workspace',
      ]),
    );
  });

  it('falls back to all bundles when no signal is present', () => {
    const servers = selectMcpServers({
      steps: [{ description: 'Improve the implementation.' }],
    });

    expect(servers.size).toBeGreaterThan(10);
    expect(servers.has('google')).toBe(true);
    expect(servers.has('workspace')).toBe(true);
    expect(servers.has('schedule')).toBe(true);
  });

  it('summarizes selected servers by bundle risk', () => {
    expect(summarizeMcpSelection(['linear', 'assets', 'workspace'])).toEqual({
      bundles: [
        {
          id: 'issue-tracker',
          risk: 'external_write',
          servers: ['linear'],
        },
        {
          id: 'design-context',
          risk: 'network_fetch',
          servers: ['assets', 'workspace'],
        },
      ],
      risks: ['external_write', 'network_fetch'],
      servers: ['assets', 'linear', 'workspace'],
    });
  });

  it('does not treat generic documents or photos as Google Workspace', () => {
    const servers = selectMcpServers({
      steps: [{ description: 'Create a document-style photo gallery.' }],
    });

    expect(servers.has('google')).toBe(false);
    expect(servers.has('media')).toBe(true);
  });

  it('builds exact Claude MCP tool allowlist names', () => {
    expect(mcpAllowedToolNames('linear', ['search_issues'])).toEqual([
      'mcp__linear__search_issues',
    ]);
  });

  it('builds capped trace attributes for selected bundles and tools', () => {
    expect(
      mcpSelectionTraceAttrs(
        ['linear', 'assets'],
        ['Bash', 'mcp__linear__create_issue', 'mcp__linear__search_issues'],
        1,
      ),
    ).toEqual({
      mcpSelection: {
        bundles: [
          {
            id: 'issue-tracker',
            risk: 'external_write',
            servers: ['linear'],
          },
          {
            id: 'design-context',
            risk: 'network_fetch',
            servers: ['assets'],
          },
        ],
        risks: ['external_write', 'network_fetch'],
        servers: ['assets', 'linear'],
      },
      mcpAllowedToolCount: 2,
      mcpAllowedTools: ['mcp__linear__create_issue'],
    });
  });
});
