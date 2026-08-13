import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
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

interface ConnectorDetailDrawerProps {
  connectorId: string | null;
  messages?: ConnectorMessages;
  onClose: () => void;
}

export function ConnectorDetailDrawer({
  connectorId,
  messages = defaultConnectorMessages,
  onClose,
}: ConnectorDetailDrawerProps) {
  const { detail, loading, error } = useConnectorDetail(connectorId);

  return (
    <Sheet
      open={connectorId !== null}
      onOpenChange={(open) => !open && onClose()}
    >
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <div className="flex items-start gap-3">
            {detail && (
              <img
                src={`${API_BASE_URL}/connectors/logos/${detail.id}`}
                alt=""
                className="bg-muted mt-1 size-10 rounded-md object-contain"
                onError={(event) => {
                  event.currentTarget.style.display = 'none';
                }}
              />
            )}
            <div className="min-w-0 flex-1">
              <SheetTitle>
                {detail?.name ?? messages.detail.fallbackTitle}
              </SheetTitle>
              <SheetDescription>
                {detail?.description ?? messages.detail.fallbackDescription}
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>
        <div className="mt-6 space-y-6">
          {loading && (
            <p className="text-muted-foreground text-sm">
              {messages.detail.loading}
            </p>
          )}
          {error && <p className="text-sm text-red-600">{error}</p>}
          {detail && (
            <>
              <div className="flex items-start justify-between gap-3">
                <div className="flex flex-wrap gap-2">
                  <ConnectorBadge>{detail.provider}</ConnectorBadge>
                  <ConnectorBadge
                    tone={
                      detail.status === 'connected'
                        ? 'green'
                        : detail.status === 'pending'
                          ? 'amber'
                          : detail.status === 'error' ||
                              detail.status === 'disabled'
                            ? 'red'
                            : 'neutral'
                    }
                  >
                    {statusLabel(detail, messages)}
                  </ConnectorBadge>
                </div>
                <ConnectorAuthLauncher detail={detail} messages={messages} />
              </div>
              <DetailsList detail={detail} messages={messages} />
              <NativeOverrideBanner
                provider={detail.provider}
                messages={messages}
              />
              <ConnectorChannelScopes detail={detail} messages={messages} />
              <ConnectorToolList
                connectorId={detail.id}
                messages={messages}
                tools={detail.tools}
              />
              <ConnectorPermissionsSection messages={messages} />
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
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

function DetailsList({
  detail,
  messages,
}: {
  detail: ConnectorDetail;
  messages: ConnectorMessages;
}) {
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-sm">
      <dt className="text-muted-foreground">{messages.detail.statusLabel}</dt>
      <dd>{statusLabel(detail, messages)}</dd>
      <dt className="text-muted-foreground">{messages.detail.categoryLabel}</dt>
      <dd>{detail.category}</dd>
      <dt className="text-muted-foreground">{messages.detail.providerLabel}</dt>
      <dd>{detail.provider}</dd>
      {detail.accountLabel && (
        <>
          <dt className="text-muted-foreground">
            {messages.detail.accountLabel}
          </dt>
          <dd className="truncate">{detail.accountLabel}</dd>
        </>
      )}
      {detail.lastError && (
        <>
          <dt className="text-muted-foreground">
            {messages.detail.lastErrorLabel}
          </dt>
          <dd className="text-red-600">{detail.lastError}</dd>
        </>
      )}
    </dl>
  );
}
