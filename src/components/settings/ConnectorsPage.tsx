import { useEffect, useState } from 'react';

import { useLanguage } from '@/shared/providers/language-provider';

import { OAuthCredentialsForm } from './OAuthCredentialsForm';
import { SettingsDrillIn } from './primitives/SettingsDrillIn';
import { SettingsRow } from './primitives/SettingsRow';
import { ComposioApiKeyCard } from './tabs/connectors/ComposioApiKeyCard';
import { ConnectorDetailPanel } from './tabs/connectors/ConnectorDetailPanel';
import {
  groupConnectors,
  withStorageAndPublish,
  type ConnectorChip,
} from './tabs/connectors/group-connectors';
import { useComposioConfig } from './tabs/connectors/hooks/useComposioConfig';
import { useConnectorCatalog } from './tabs/connectors/hooks/useConnectorCatalog';

const CHIPS: ConnectorChip[] = ['all', 'files', 'work', 'publishing'];

export function ConnectorsPage() {
  const { t } = useLanguage();
  const messages = t.connectors;
  const composio = useComposioConfig();
  const catalog = useConnectorCatalog();
  const refreshCatalog = catalog.refresh;
  const [query, setQuery] = useState('');
  const [chip, setChip] = useState<ConnectorChip>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(false);

  useEffect(() => {
    if (!composio.config.configured) return;
    void refreshCatalog();
  }, [refreshCatalog, composio.config.configured]);

  const groups = groupConnectors(
    withStorageAndPublish(catalog.connectors),
    query,
    chip,
  );
  const open = catalog.connectors.find((connector) => connector.id === openId);

  if (openId) {
    return (
      <SettingsDrillIn
        title={open?.name ?? messages.detail.fallbackTitle}
        backLabel={messages.title}
        onBack={() => setOpenId(null)}
      >
        <ConnectorDetailPanel connectorId={openId} messages={messages} />
      </SettingsDrillIn>
    );
  }

  if (advanced) {
    return (
      <SettingsDrillIn
        title={messages.catalog.advanced}
        backLabel={messages.title}
        onBack={() => setAdvanced(false)}
      >
        <div className="space-y-6">
          <ComposioApiKeyCard
            messages={messages}
            config={composio.config}
            saving={composio.saving}
            error={composio.error}
            onSave={composio.save}
            onRefreshCatalog={catalog.refresh}
          />
          <OAuthCredentialsForm
            provider="slack"
            setupGuideUrl="https://api.slack.com/apps"
          />
          <OAuthCredentialsForm
            provider="box"
            setupGuideUrl="https://app.box.com/developers/console"
          />
          <OAuthCredentialsForm
            provider="dropbox"
            setupGuideUrl="https://www.dropbox.com/developers/apps"
          />
          <OAuthCredentialsForm
            provider="onedrive"
            setupGuideUrl="https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app"
          />
        </div>
      </SettingsDrillIn>
    );
  }

  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 pb-6">
      <input
        data-testid="connector-search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={messages.catalog.searchPlaceholder}
        aria-label={messages.catalog.searchLabel}
        className="border-input bg-background h-9 w-full rounded-lg border px-3 text-sm"
      />
      <div className="flex flex-wrap gap-2">
        {CHIPS.map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={chip === value}
            className={
              chip === value
                ? 'bg-accent text-foreground rounded-full px-3 py-1 text-xs'
                : 'text-muted-foreground rounded-full px-3 py-1 text-xs'
            }
            onClick={() => setChip(value)}
          >
            {messages.catalog.chips[value]}
          </button>
        ))}
      </div>
      <ConnectorList
        title={messages.catalog.listConnected}
        empty={messages.catalog.empty}
        connectors={groups.connected}
        onOpen={setOpenId}
      />
      <ConnectorList
        title={messages.catalog.listAvailable}
        empty={messages.catalog.empty}
        connectors={groups.available}
        onOpen={setOpenId}
        connectLabel={messages.catalog.connect}
      />
      {catalog.error ? (
        <p className="text-sm text-red-600">{catalog.error}</p>
      ) : null}
      <SettingsRow
        variant="chevron"
        label={messages.catalog.advanced}
        onSelect={() => setAdvanced(true)}
      />
    </div>
  );
}

function ConnectorList({
  title,
  empty,
  connectors,
  onOpen,
  connectLabel,
}: {
  title: string;
  empty: string;
  connectors: { id: string; name: string }[];
  onOpen: (id: string) => void;
  connectLabel?: string;
}) {
  return (
    <section>
      <h3 className="text-foreground mb-2 text-sm font-medium">{title}</h3>
      {connectors.length === 0 ? (
        <p className="text-muted-foreground text-sm">{empty}</p>
      ) : (
        <ul className="space-y-1">
          {connectors.map((connector) => (
            <li key={connector.id} className="flex items-center gap-2">
              <button
                type="button"
                className="hover:bg-accent min-w-0 flex-1 rounded-lg px-3 py-2 text-left text-sm"
                onClick={() => onOpen(connector.id)}
              >
                {connector.name}
              </button>
              {connectLabel ? (
                <button
                  type="button"
                  data-testid={`connector-connect-${connector.id}`}
                  className="text-primary px-2 text-sm"
                  onClick={() => onOpen(connector.id)}
                >
                  {connectLabel}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
