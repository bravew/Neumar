import { CheckCircle2, ExternalLink } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { API_BASE_URL } from '@/config';
import { openExternalUrl } from '@/shared/lib/open-external-url';

import { defaultConnectorMessages, type ConnectorMessages } from './messages';
import { ConnectorBadge, ConnectorPanel } from './parts';
import type { ConnectorDetail, ConnectorStatus } from './types';

interface ConnectorCardProps {
  connector: ConnectorDetail;
  messages?: ConnectorMessages;
  onOpen: (id: string) => void;
}

export function ConnectorCard({
  connector,
  messages = defaultConnectorMessages,
  onOpen,
}: ConnectorCardProps) {
  const isConnected = connector.status === 'connected';
  return (
    <ConnectorPanel
      className={
        'hover:border-primary/40 flex h-full flex-col gap-3 transition-colors ' +
        (isConnected ? 'border-emerald-500/40 bg-emerald-500/5' : '')
      }
    >
      <button
        type="button"
        aria-label={messages.card.openLabel.replace('{name}', connector.name)}
        onClick={() => onOpen(connector.id)}
        className="flex flex-1 flex-col gap-3 text-left"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <img
              src={`${API_BASE_URL}/connectors/logos/${connector.id}`}
              alt=""
              className="bg-muted size-9 rounded-md object-contain"
              loading="lazy"
              decoding="async"
              onError={(event) => {
                event.currentTarget.style.display = 'none';
              }}
            />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-sm font-semibold">
                <span className="truncate">{connector.name}</span>
                {isConnected && (
                  <CheckCircle2
                    className="size-3.5 shrink-0 text-emerald-500"
                    aria-label={messages.card.statusConnected}
                  />
                )}
              </div>
              <div className="text-muted-foreground truncate text-xs">
                {connector.category}
              </div>
            </div>
          </div>
          <StatusBadge status={connector.status} messages={messages} />
        </div>
        <p className="text-muted-foreground line-clamp-2 text-xs">
          {connector.description}
        </p>
        {isConnected && connector.accountLabel && (
          <p className="truncate text-xs text-emerald-700 dark:text-emerald-400">
            {messages.card.connectedAs.replace(
              '{label}',
              connector.accountLabel,
            )}
          </p>
        )}
      </button>
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2">
        <ConnectorBadge>{connector.provider}</ConnectorBadge>
        <div className="flex items-center gap-2">
          {connector.apiKeyUrl && (
            <Button
              asChild
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs"
            >
              <a
                href={connector.apiKeyUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(event) => {
                  event.preventDefault();
                  void openExternalUrl(connector.apiKeyUrl!);
                }}
                aria-label={messages.card.apiKeyLabel.replace(
                  '{name}',
                  connector.name,
                )}
              >
                {messages.card.apiKeyButton}
                <ExternalLink className="size-3" />
              </a>
            </Button>
          )}
          <span className="text-muted-foreground text-xs whitespace-nowrap">
            {messages.card.toolsLabel.replace(
              '{count}',
              String(connector.toolCount ?? connector.tools.length),
            )}
          </span>
        </div>
      </div>
    </ConnectorPanel>
  );
}

function StatusBadge({
  status,
  messages,
}: {
  status: ConnectorStatus;
  messages: ConnectorMessages;
}) {
  const { tone, label } = (() => {
    switch (status) {
      case 'connected':
        return { tone: 'green' as const, label: messages.card.statusConnected };
      case 'pending':
        return { tone: 'amber' as const, label: messages.card.statusPending };
      case 'error':
        return { tone: 'red' as const, label: messages.card.statusError };
      case 'disabled':
        return { tone: 'red' as const, label: messages.card.statusDisabled };
      default:
        return {
          tone: 'neutral' as const,
          label: messages.card.statusAvailable,
        };
    }
  })();
  return <ConnectorBadge tone={tone}>{label}</ConnectorBadge>;
}
