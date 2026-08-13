import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/shared/db/operations', () => ({
  getSetting: vi.fn(),
}));

import { getAgentDef } from '@/shared/agent-runtimes';
import {
  getConfiguredExecutablePath,
  resolveConfiguredBinary,
} from '@/shared/agent-runtimes/resolve';
import { getSetting } from '@/shared/db/operations';

describe('Trae CLI runtime definition', () => {
  beforeEach(() => {
    vi.mocked(getSetting).mockReset();
  });

  it('registers Trae CLI as an ACP runtime with unattended launch args', () => {
    const trae = getAgentDef('trae-cli');

    expect(trae).toMatchObject({
      id: 'trae-cli',
      name: 'Trae CLI',
      bin: 'traecli',
      versionArgs: ['--version'],
      promptDelivery: 'stdin',
      streamFormat: 'acp-json-rpc',
    });
    expect(trae?.buildArgs?.('', [], [], {}, {})).toEqual([
      'acp',
      'serve',
      '--yolo',
    ]);
    expect(trae?.install?.[0]).toMatchObject({
      id: 'install-docs',
      label: 'Install from Trae CLI docs',
    });
  });

  it('uses the generic runtime executable override keyed by trae-cli', () => {
    vi.mocked(getSetting).mockReturnValue(
      JSON.stringify([
        {
          id: 'trae-cli',
          config: { executablePath: process.execPath },
        },
      ]),
    );

    expect(getConfiguredExecutablePath('trae-cli')).toBe(process.execPath);
    expect(resolveConfiguredBinary('trae-cli')).toEqual({
      path: process.execPath,
      source: 'configured',
    });
  });
});
