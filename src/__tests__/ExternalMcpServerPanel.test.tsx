import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ExternalMcpServerPanel } from '@/components/settings/tabs/mcp/ExternalMcpServerPanel';
import { defaultSettings } from '@/shared/db/settings';

import { renderWithProviders } from './helpers/render-with-providers';

const installInfo = {
  serverName: 'neumar',
  command: '/opt/neumar-api',
  args: ['mcp', 'server', '--daemon-url', 'http://127.0.0.1:5126'],
  env: { NEUMAR_APP_DATA_DIR: '/tmp/.neumar' },
  daemonUrl: 'http://127.0.0.1:5126',
  appDataDir: '/tmp/.neumar',
  binaryExists: true,
  platform: 'darwin',
  buildHint: null,
  codexCommand: 'codex mcp add neumar -- /opt/neumar-api mcp server',
  claudeCodeCommand:
    'claude mcp add --scope user neumar -- /opt/neumar-api mcp server',
  codexRemoveCommand: 'codex mcp remove neumar',
  claudeCodeRemoveCommand: 'claude mcp remove --scope user neumar',
  development: true,
};

describe('ExternalMcpServerPanel', () => {
  const writeText = vi.fn(async () => {});

  beforeEach(() => {
    writeText.mockClear();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo) => {
        const url = String(input);
        if (url.endsWith('/mcp/server/install-info')) {
          return new Response(JSON.stringify(installInfo), { status: 200 });
        }
        if (url.endsWith('/mcp/server/status')) {
          return new Response(
            JSON.stringify({
              ready: true,
              daemonUrl: 'http://127.0.0.1:5126',
              flags: {
                enabled: false,
                writesEnabled: false,
                agentRunsEnabled: false,
              },
            }),
            { status: 200 },
          );
        }
        return new Response('not found', { status: 404 });
      }),
    );
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads install info and copies the Codex add command', async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const onSettingsChange = vi.fn();
    renderWithProviders(
      <ExternalMcpServerPanel
        settings={defaultSettings}
        onSettingsChange={onSettingsChange}
      />,
    );

    expect(
      await screen.findByText(
        'codex mcp add neumar -- /opt/neumar-api mcp server',
      ),
    ).toBeTruthy();

    await user.click(
      screen.getByRole('button', { name: /copy codex add command/i }),
    );
    expect(writeText).toHaveBeenCalledWith(installInfo.codexCommand);

    await user.click(
      screen.getByRole('switch', { name: /allow other apps to call neumar/i }),
    );
    expect(onSettingsChange).toHaveBeenCalledWith(
      expect.objectContaining({ externalMcpEnabled: true }),
    );
  });
});
