import { describe, expect, it } from 'vitest';

import {
  buildExternalMcpInstallInfo,
  formatCliCommand,
  quoteCliArg,
  resolveLaunchBinary,
} from '@/shared/mcp/public-server/install-info';

describe('MCP install info', () => {
  it('quotes Windows paths and appends .exe for the packaged sidecar', () => {
    const launch = resolveLaunchBinary({
      execPath: 'C:\\Program Files\\Neumar\\neumar-api',
      binaryName: 'neumar-api',
      platform: 'win32',
      pkg: true,
    });
    expect(launch.command).toBe('C:\\Program Files\\Neumar\\neumar-api.exe');
    expect(launch.development).toBe(false);
    expect(quoteCliArg(launch.command, 'win32')).toBe(
      '"C:\\Program Files\\Neumar\\neumar-api.exe"',
    );
  });

  it('uses the running node + entry script in development', () => {
    const launch = resolveLaunchBinary({
      execPath: '/usr/bin/node',
      argv1: '/repo/src-api/src/index.ts',
      binaryName: 'neumar-api',
      platform: 'linux',
    });
    expect(launch).toEqual({
      command: '/usr/bin/node',
      prefixArgs: ['/repo/src-api/src/index.ts'],
      development: true,
    });
  });

  it('builds Codex and Claude commands without leaking a secret', () => {
    const info = buildExternalMcpInstallInfo({
      daemonUrl: 'http://127.0.0.1:2620',
      appDataDir: '/home/user/.neumar',
      command: '/opt/neumar-api',
      platform: 'linux',
      development: false,
      binaryExists: true,
    });
    expect(info.serverName).toBe('neumar');
    expect(info.env).toEqual({ NEUMAR_APP_DATA_DIR: '/home/user/.neumar' });
    expect(info.args).toEqual([
      'mcp',
      'server',
      '--daemon-url',
      'http://127.0.0.1:2620',
    ]);
    expect(info.codexCommand).toContain('codex mcp add neumar --env');
    expect(info.codexCommand).toContain('-- /opt/neumar-api mcp server');
    expect(info.claudeCodeCommand).toContain(
      'claude mcp add --scope user neumar --env',
    );
    expect(info.codexRemoveCommand).toBe('codex mcp remove neumar');
    expect(JSON.stringify(info)).not.toMatch(/secret|token|password/i);
    expect(info.buildHint).toBeNull();
    expect(formatCliCommand(['codex', 'mcp', 'list'], 'linux')).toBe(
      'codex mcp list',
    );
  });

  it('quotes Windows launch paths in the copyable Codex command', () => {
    const info = buildExternalMcpInstallInfo({
      daemonUrl: 'http://127.0.0.1:2620',
      appDataDir: 'C:\\Users\\Ada Lovelace\\.neumar',
      command: 'C:\\Program Files\\Neumar\\neumar-api.exe',
      platform: 'win32',
      development: false,
      binaryExists: true,
    });
    expect(info.codexCommand).toContain(
      '"C:\\Program Files\\Neumar\\neumar-api.exe"',
    );
    expect(info.codexCommand).toContain(
      '"NEUMAR_APP_DATA_DIR=C:\\Users\\Ada Lovelace\\.neumar"',
    );
    expect(JSON.stringify(info.env)).not.toMatch(/secret|token|password/i);
  });

  it('sets a build hint when the launch binary is missing', () => {
    const info = buildExternalMcpInstallInfo({
      daemonUrl: 'http://127.0.0.1:5126',
      appDataDir: '/tmp/app',
      command: '/missing/neumar-api',
      binaryExists: false,
      platform: 'darwin',
    });
    expect(info.binaryExists).toBe(false);
    expect(info.buildHint).toMatch(/sidecar/i);
  });
});
