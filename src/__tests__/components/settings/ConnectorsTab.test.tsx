import React from 'react';

import { openUrl } from '@tauri-apps/plugin-opener';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ConnectorCatalogGrid } from '@/components/settings/tabs/connectors/ConnectorCatalogGrid';
import { ConnectorChannelScopes } from '@/components/settings/tabs/connectors/ConnectorChannelScopes';
import { ConnectorsTab } from '@/components/settings/tabs/connectors/ConnectorsTab';
import type { ConnectorDetail } from '@/components/settings/tabs/connectors/types';
import en from '@/config/locale/messages/en';
import es from '@/config/locale/messages/es';
import fr from '@/config/locale/messages/fr';
import hi from '@/config/locale/messages/hi';
import pt from '@/config/locale/messages/pt';
import zh from '@/config/locale/messages/zh';
import { defaultSettings } from '@/shared/db/settings';

import { renderWithProviders } from '../../helpers/render-with-providers';

const mocks = vi.hoisted(() => ({
  refreshCatalog: vi.fn(async () => {}),
  saveComposioConfig: vi.fn(async (_key: string | null) => {}),
  // Mutable so the mocked hook can flip `configured` after save fires,
  // mimicking the real hook so the `useEffect`-driven discovery runs.
  composioConfigured: false,
}));

vi.mock('@/components/settings/GoogleWorkspaceSection', () => ({
  GoogleWorkspaceSection: () => <section>Google Workspace setup</section>,
}));

vi.mock(
  '@/components/settings/cloud-storage/CloudStorageConnectionsSection',
  () => ({
    CloudStorageConnectionsSection: () => (
      <section>Unified cloud storage</section>
    ),
  }),
);

vi.mock('@/components/settings/ConnectorAccessControls', () => ({
  ConnectorAccessControls: () => <section>Connector access by tier</section>,
}));

vi.mock(
  '@/components/settings/tabs/connectors/hooks/useComposioConfig',
  () => ({
    useComposioConfig: () => {
      const [, setTick] = React.useState(0);
      return {
        config: {
          configured: mocks.composioConfigured,
          apiKeyTail: mocks.composioConfigured ? '_key' : '',
        },
        saving: false,
        error: '',
        save: async (key: string | null) => {
          await mocks.saveComposioConfig(key);
          mocks.composioConfigured = key !== null;
          setTick((n) => n + 1);
        },
      };
    },
  }),
);

vi.mock(
  '@/components/settings/tabs/connectors/hooks/useConnectorCatalog',
  () => ({
    useConnectorCatalog: () => ({
      connectors: [
        {
          id: 'github',
          name: 'GitHub',
          provider: 'composio',
          category: 'Engineering',
          description: 'GitHub connector',
          apiKeyUrl: 'https://github.com/settings/personal-access-tokens',
          status: 'available',
          tools: [],
          allowedToolNames: [],
          curatedToolNames: [],
          auth: { provider: 'composio', configured: false },
        },
        {
          id: 'drive',
          name: 'Google Drive',
          provider: 'native',
          category: 'Google Workspace',
          description: 'Google Drive connector',
          status: 'available',
          tools: [],
          allowedToolNames: [],
          curatedToolNames: [],
          auth: { provider: 'oauth', configured: false },
        },
        {
          id: 'calendar',
          name: 'Google Calendar',
          provider: 'native',
          category: 'Google Workspace',
          description: 'Google Calendar connector',
          status: 'available',
          tools: [],
          allowedToolNames: [],
          curatedToolNames: [],
          auth: { provider: 'oauth', configured: false },
        },
        {
          id: 'drive_composio',
          name: 'Google Drive',
          provider: 'composio',
          category: 'Google Workspace',
          description: 'Google Drive Composio connector',
          status: 'available',
          tools: [],
          allowedToolNames: [],
          curatedToolNames: [],
          auth: { provider: 'composio', configured: false },
        },
        {
          id: 'apaleo',
          name: 'Apaleo',
          provider: 'composio',
          category: 'Scheduling',
          description: 'Apaleo connector',
          status: 'available',
          tools: [],
          allowedToolNames: [],
          curatedToolNames: [],
          auth: { provider: 'composio', configured: false },
        },
      ],
      loading: false,
      error: '',
      refresh: mocks.refreshCatalog,
    }),
  }),
);

const github = connector({
  id: 'github',
  name: 'GitHub',
  provider: 'composio',
  status: 'connected',
});
const slack = connector({
  id: 'slack',
  name: 'Slack',
  provider: 'native',
  status: 'available',
});

describe('connector settings components', () => {
  beforeEach(() => {
    vi.mocked(openUrl).mockClear();
    mocks.refreshCatalog.mockClear();
    mocks.saveComposioConfig.mockClear();
    mocks.composioConfigured = false;
  });

  it('filters catalog cards by search and status', async () => {
    const user = userEvent.setup();
    render(
      <ConnectorCatalogGrid
        catalog={{
          connectors: [github, slack],
          loading: false,
          error: '',
          refresh: async () => {},
        }}
        onOpen={() => {}}
      />,
    );

    expect(screen.getByText('GitHub')).toBeInTheDocument();
    expect(screen.getByText('Slack')).toBeInTheDocument();

    await user.type(screen.getByLabelText(/search connectors/i), 'git');
    expect(screen.getByText('GitHub')).toBeInTheDocument();
    expect(screen.queryByText('Slack')).not.toBeInTheDocument();
  });

  it('renders the unified v2 connector management sections', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <ConnectorsTab settings={defaultSettings} onSettingsChange={() => {}} />,
    );

    expect(screen.getByText('Google Workspace setup')).toBeInTheDocument();
    expect(screen.getByText('Unified cloud storage')).toBeInTheDocument();

    // Catalog and access-policy disclosures are collapsed by default; expand
    // them so the assertions below can reach the children.
    await user.click(screen.getByRole('button', { name: /composio/i }));
    await user.click(screen.getByRole('button', { name: /access policy/i }));

    expect(screen.getByText('Connector access by tier')).toBeInTheDocument();
    expect(screen.getByText(/configure Custom Auth/i)).toBeInTheDocument();
    expect(screen.getByText('GitHub')).toBeInTheDocument();
    expect(screen.queryByText('Apaleo')).not.toBeInTheDocument();
    expect(screen.queryByText('Google Drive')).not.toBeInTheDocument();
    expect(screen.queryByText('Google Calendar')).not.toBeInTheDocument();
  });

  it('searches the full connector catalog from the suggested default', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <ConnectorsTab settings={defaultSettings} onSettingsChange={() => {}} />,
    );

    expect(screen.queryByText('Apaleo')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /composio/i }));
    await user.type(screen.getByLabelText(/search connectors/i), 'apaleo');

    expect(screen.getByText('Apaleo')).toBeInTheDocument();
    expect(screen.queryByText('GitHub')).not.toBeInTheDocument();
  });

  it('refreshes the connector catalog after saving a Composio key', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <ConnectorsTab settings={defaultSettings} onSettingsChange={() => {}} />,
    );

    await user.click(screen.getByRole('button', { name: /composio/i }));
    await user.type(screen.getByLabelText(/composio api key/i), 'cmp_key');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() =>
      expect(mocks.saveComposioConfig).toHaveBeenCalledWith('cmp_key'),
    );
    await waitFor(() => expect(mocks.refreshCatalog).toHaveBeenCalled());
  });

  it('can hide connectors that are managed by a dedicated settings section', () => {
    render(
      <ConnectorCatalogGrid
        catalog={{
          connectors: [
            github,
            connector({
              id: 'drive',
              name: 'Google Drive',
              provider: 'native',
              status: 'available',
            }),
          ],
          loading: false,
          error: '',
          refresh: async () => {},
        }}
        hiddenConnectorIds={['drive']}
        onOpen={() => {}}
      />,
    );

    expect(screen.getByText('GitHub')).toBeInTheDocument();
    expect(screen.queryByText('Google Drive')).not.toBeInTheDocument();
  });

  it('opens connector API key links through the desktop opener', async () => {
    const user = userEvent.setup();
    const apiKeyUrl = 'https://github.com/settings/personal-access-tokens';

    render(
      <ConnectorCatalogGrid
        catalog={{
          connectors: [
            connector({
              id: 'github',
              name: 'GitHub',
              provider: 'composio',
              status: 'available',
              apiKeyUrl,
            }),
          ],
          loading: false,
          error: '',
          refresh: async () => {},
        }}
        onOpen={() => {}}
      />,
    );

    const link = screen.getByRole('link', { name: /get api key for github/i });
    expect(link).toHaveAttribute('href', apiKeyUrl);

    await user.click(link);

    await waitFor(() => expect(openUrl).toHaveBeenCalledWith(apiKeyUrl));
  });

  it('renders isolated channel scopes independently', () => {
    render(
      <ConnectorChannelScopes
        detail={{
          ...github,
          scopeConnections: [
            {
              scopeKey: 'channel:slack:bot-a:user-1',
              label: 'Slack · Workspace A',
              status: 'connected',
            },
            {
              scopeKey: 'channel:discord:guild-b:user-1',
              label: 'Discord · Guild B',
              status: 'connected',
            },
          ],
        }}
      />,
    );

    expect(screen.getByText('Slack · Workspace A')).toBeInTheDocument();
    expect(screen.getByText('Discord · Guild B')).toBeInTheDocument();
    expect(screen.getByText('channel:slack:bot-a:user-1')).toBeInTheDocument();
    expect(
      screen.getByText('channel:discord:guild-b:user-1'),
    ).toBeInTheDocument();
  });

  it('loads the connectors namespace in every locale', () => {
    for (const messages of [en, zh, es, fr, hi, pt]) {
      expect(messages.connectors.title).toBeTruthy();
      expect(messages.connectors.card.apiKeyButton).toBeTruthy();
      expect(messages.connectors.composioCard.refreshButton).toBeTruthy();
      expect(messages.connectors.composioCard.apiKeyButton).toBeTruthy();
      expect(messages.connectors.scopes.requiresDesktopApproval).toBeTruthy();
    }
  });
});

function connector(input: {
  id: string;
  name: string;
  provider: ConnectorDetail['provider'];
  status: ConnectorDetail['status'];
  apiKeyUrl?: string;
}): ConnectorDetail {
  return {
    ...input,
    category: 'Test',
    description: `${input.name} connector`,
    tools: [],
    allowedToolNames: [],
    curatedToolNames: [],
    auth: {
      provider: input.provider === 'composio' ? 'composio' : 'oauth',
      configured: false,
    },
  };
}
