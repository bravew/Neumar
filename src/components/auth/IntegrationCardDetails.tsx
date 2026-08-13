import type { OAuthConnection } from '@/shared/hooks/useAuth';

import type { ConnectorMessages } from '../settings/tabs/connectors/messages';

interface IntegrationCardDetailsProps {
  connection: OAuthConnection;
  messages: ConnectorMessages;
}

export function IntegrationCardDetails({
  connection,
  messages,
}: IntegrationCardDetailsProps) {
  const scopes = connection.scopes.filter(Boolean);
  return (
    <div className="border-border bg-muted/20 border-t px-4 py-3">
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-xs">
        <dt className="text-muted-foreground">{messages.detail.statusLabel}</dt>
        <dd className="text-foreground">
          {connection.status === 'active'
            ? messages.card.statusConnected
            : messages.card.statusError}
        </dd>
        <dt className="text-muted-foreground">
          {messages.detail.accountLabel}
        </dt>
        <dd className="text-foreground min-w-0 truncate">
          {connection.accountEmail}
        </dd>
        <dt className="text-muted-foreground">
          {messages.detail.connectedLabel}
        </dt>
        <dd className="text-foreground">
          {formatDate(connection.connectedAt)}
        </dd>
        {connection.expiresAt && (
          <>
            <dt className="text-muted-foreground">
              {messages.detail.expiresLabel}
            </dt>
            <dd className="text-foreground">
              {formatDate(connection.expiresAt)}
            </dd>
          </>
        )}
      </dl>
      {scopes.length > 0 && (
        <div className="mt-3 space-y-2">
          <p className="text-muted-foreground text-xs">
            {messages.scopes.title}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {scopes.map((scope) => (
              <span
                key={scope}
                className="border-border bg-background text-foreground rounded border px-2 py-1 text-[11px]"
              >
                {scope}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}
