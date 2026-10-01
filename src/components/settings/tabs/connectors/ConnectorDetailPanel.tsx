import { API_BASE_URL } from '@/config';

import { ConnectorAuthLauncher } from './ConnectorAuthLauncher';
import { ConnectorChannelScopes } from './ConnectorChannelScopes';
import { ConnectorPermissionsSection } from './ConnectorPermissionsSection';
import { ConnectorToolList } from './ConnectorToolList';
import { useConnectorDetail } from './hooks/useConnectorDetail';
import { defaultConnectorMessages, type ConnectorMessages } from './messages';
import { NativeOverrideBanner } from './NativeOverrideBanner';
import { ConnectorBadge } from './parts';
import type { ConnectorDetail } from './types';

export function ConnectorDetailPanel({
  connectorId,
  messages = defaultConnectorMessages,
}: {
  connectorId: string;
  messages?: ConnectorMessages;
}) {
  const { detail, loading, error } = useConnectorDetail(connectorId);

  if (loading) {
    return (
      <p className="text-muted-foreground text-sm">{messages.detail.loading}</p>
    );
  }
  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!detail) return null;

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <img
          src={`${API_BASE_URL}/connectors/logos/${detail.id}`}
          alt=""
          className="bg-muted size-10 rounded-md object-contain"
          onError={(event) => {
            event.currentTarget.style.display = 'none';
          }}
        />
        <div className="min-w-0">
          <p className="text-foreground text-base font-medium">{detail.name}</p>
          <p className="text-muted-foreground text-sm">{detail.description}</p>
        </div>
      </div>
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <ConnectorBadge>{detail.provider}</ConnectorBadge>
          <ConnectorBadge>{statusLabel(detail, messages)}</ConnectorBadge>
        </div>
        <ConnectorAuthLauncher detail={detail} messages={messages} />
      </div>
      <NativeOverrideBanner provider={detail.provider} messages={messages} />
      <ConnectorChannelScopes detail={detail} messages={messages} />
      <ConnectorToolList
        connectorId={detail.id}
        messages={messages}
        tools={detail.tools}
      />
      <ConnectorPermissionsSection messages={messages} />
    </div>
  );
}

function statusLabel(
  detail: ConnectorDetail,
  messages: ConnectorMessages,
): string {
  switch (detail.status) {
    case 'connected':
      return messages.card.statusConnected;
    case 'pending':
      return messages.card.statusPending;
    case 'error':
      return messages.card.statusError;
    case 'disabled':
      return messages.card.statusDisabled;
    default:
      return messages.card.statusAvailable;
  }
}
