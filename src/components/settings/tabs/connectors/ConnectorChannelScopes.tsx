import { defaultConnectorMessages, type ConnectorMessages } from './messages';
import { ConnectorBadge } from './parts';
import type { ConnectorDetail } from './types';

interface ConnectorChannelScopesProps {
  detail: ConnectorDetail;
  messages?: ConnectorMessages;
}

const DEFAULT_SCOPES = [
  'desktop',
  'slack',
  'discord',
  'telegram',
  'lark',
  'whatsApp',
  'iMessage',
] as const;

const SCOPE_STATUS_TONE_BY_STATUS = {
  connected: 'green',
  pending: 'amber',
  error: 'red',
  disabled: 'red',
  available: 'neutral',
} as const;

export function ConnectorChannelScopes({
  detail,
  messages = defaultConnectorMessages,
}: ConnectorChannelScopesProps) {
  const connections = detail.scopeConnections ?? [];

  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold">{messages.scopes.title}</h3>
        <p className="text-muted-foreground text-xs">
          {messages.scopes.subtitle}
        </p>
      </div>
      <div className="grid gap-2">
        {(connections.length > 0
          ? connections.map((scope) => ({
              label: scope.label,
              detail: scope.scopeKey,
              status: scope.status,
            }))
          : DEFAULT_SCOPES.map((key) => ({
              label: messages.scopes.defaultScopes[key],
              detail: messages.scopes.defaultScopeDetail,
              status: 'available' as const,
            }))
        ).map((scope) => (
          <div
            key={`${scope.label}:${scope.detail}`}
            className="border-border flex items-center justify-between gap-3 rounded-md border px-3 py-2"
          >
            <div className="min-w-0">
              <div className="text-sm font-medium">{scope.label}</div>
              <div className="text-muted-foreground truncate text-xs">
                {scope.detail}
              </div>
            </div>
            <ConnectorBadge tone={SCOPE_STATUS_TONE_BY_STATUS[scope.status]}>
              {scope.status}
            </ConnectorBadge>
          </div>
        ))}
      </div>
    </section>
  );
}
