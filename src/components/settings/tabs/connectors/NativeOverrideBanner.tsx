import { defaultConnectorMessages, type ConnectorMessages } from './messages';
import type { ConnectorProvider } from './types';

export function NativeOverrideBanner({
  messages = defaultConnectorMessages,
  provider,
}: {
  messages?: ConnectorMessages;
  provider: ConnectorProvider;
}) {
  if (provider !== 'native') return null;
  return (
    <div className="border-border bg-muted/40 rounded-md border p-3 text-sm">
      {messages.nativeOverride.description}
    </div>
  );
}
