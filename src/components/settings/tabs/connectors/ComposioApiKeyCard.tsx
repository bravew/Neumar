import { useState } from 'react';

import { ExternalLink, Info, RefreshCw, Save } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { openExternalUrl } from '@/shared/lib/open-external-url';

import { defaultConnectorMessages, type ConnectorMessages } from './messages';
import { ConnectorBadge, ConnectorInput, ConnectorPanel } from './parts';
import type { ComposioConfig } from './types';

const COMPOSIO_API_KEY_URL = 'https://platform.composio.dev';

interface ComposioApiKeyCardProps {
  messages?: ConnectorMessages;
  config: ComposioConfig;
  saving: boolean;
  error: string;
  onSave: (apiKey: string | null) => Promise<void>;
  onRefreshCatalog: () => Promise<void>;
}

export function ComposioApiKeyCard({
  messages = defaultConnectorMessages,
  config,
  saving,
  error,
  onSave,
  onRefreshCatalog,
}: ComposioApiKeyCardProps) {
  const [apiKey, setApiKey] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  return (
    <ConnectorPanel className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold">
              {messages.composioCard.title}
            </h2>
            <ConnectorBadge tone={config.configured ? 'green' : 'neutral'}>
              {config.configured
                ? `${messages.composioCard.configuredLabel} ${config.apiKeyTail}`
                : messages.composioCard.notConfiguredLabel}
            </ConnectorBadge>
          </div>
          <p className="text-muted-foreground mt-1 text-sm">
            {messages.composioCard.subtitle}
          </p>
          <div className="text-muted-foreground mt-3 flex max-w-2xl items-start gap-2 text-xs leading-5">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <p>{messages.composioCard.customAuthNotice}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline">
            <a
              href={COMPOSIO_API_KEY_URL}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(event) => {
                event.preventDefault();
                void openExternalUrl(COMPOSIO_API_KEY_URL);
              }}
            >
              <ExternalLink className="size-4" />
              {messages.composioCard.apiKeyButton}
            </a>
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={async () => {
              setRefreshing(true);
              try {
                await onRefreshCatalog();
              } finally {
                setRefreshing(false);
              }
            }}
            disabled={refreshing}
          >
            <RefreshCw className="size-4" />
            {messages.composioCard.refreshButton}
          </Button>
        </div>
      </div>
      <div className="flex flex-col gap-2 md:flex-row">
        <ConnectorInput
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          type="password"
          placeholder="cmp_..."
          aria-label={messages.composioCard.title}
        />
        <Button
          type="button"
          disabled={saving || apiKey.trim().length === 0}
          onClick={() => onSave(apiKey.trim())}
        >
          <Save className="size-4" />
          {messages.composioCard.saveButton}
        </Button>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </ConnectorPanel>
  );
}
