import { ConnectorAccessControls } from '../../ConnectorAccessControls';
import { defaultConnectorMessages, type ConnectorMessages } from './messages';

export function ConnectorPermissionsSection({
  messages = defaultConnectorMessages,
}: {
  messages?: ConnectorMessages;
}) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">{messages.permissions.title}</h3>
      <ConnectorAccessControls />
    </div>
  );
}
