import { describe, expect, it } from 'vitest';

import {
  hostAddCommand,
  hostRemoveCommand,
  hostStatusHint,
  installCliPayload,
} from '@/components/settings/tabs/mcp/external-mcp-install';
import type { ExternalMcpInstallInfo } from '@/components/settings/tabs/mcp/external-mcp-types';

const info: ExternalMcpInstallInfo = {
  serverName: 'neumar',
  command: '/opt/neumar-api',
  args: ['mcp', 'server', '--daemon-url', 'http://127.0.0.1:2620'],
  env: { NEUMAR_APP_DATA_DIR: '/home/user/.neumar' },
  daemonUrl: 'http://127.0.0.1:2620',
  appDataDir: '/home/user/.neumar',
  binaryExists: true,
  platform: 'linux',
  buildHint: null,
  codexCommand: 'codex mcp add neumar -- /opt/neumar-api mcp server',
  claudeCodeCommand:
    'claude mcp add --scope user neumar -- /opt/neumar-api mcp server',
  codexRemoveCommand: 'codex mcp remove neumar',
  claudeCodeRemoveCommand: 'claude mcp remove --scope user neumar',
  development: false,
};

describe('external MCP install helpers', () => {
  it('uses daemon-provided commands and does not invent binary paths', () => {
    expect(hostAddCommand(info, 'codex')).toBe(info.codexCommand);
    expect(hostAddCommand(info, 'claude')).toBe(info.claudeCodeCommand);
    expect(hostRemoveCommand(info, 'codex')).toBe(info.codexRemoveCommand);
    expect(installCliPayload(info, 'codex').args).toContain('/opt/neumar-api');
    expect(installCliPayload(info, 'claude').args).toContain('--scope');
    expect(hostStatusHint('codex')).toBe('codex mcp list');
  });
});
