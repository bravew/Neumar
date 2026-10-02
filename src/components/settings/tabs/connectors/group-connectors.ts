import type { ConnectorDetail } from './types';

export type ConnectorChip = 'all' | 'files' | 'work' | 'publishing';

const FILE_PATTERN = /file|storage|drive|dropbox|box|s3|webdav|immich/;
const PUBLISH_PATTERN = /publish|youtube|tiktok|social/;

export function connectorChip(connector: {
  id: string;
  category: string;
  name: string;
}): Exclude<ConnectorChip, 'all'> {
  const blob =
    `${connector.id} ${connector.category} ${connector.name}`.toLowerCase();
  if (PUBLISH_PATTERN.test(blob)) return 'publishing';
  if (FILE_PATTERN.test(blob)) return 'files';
  return 'work';
}

export function groupConnectors(
  connectors: ConnectorDetail[],
  query: string,
  chip: ConnectorChip,
): { connected: ConnectorDetail[]; available: ConnectorDetail[] } {
  const q = query.trim().toLowerCase();
  const seen = new Set<string>();
  const matched = connectors.filter((connector) => {
    if (seen.has(connector.id)) return false;
    seen.add(connector.id);
    if (chip !== 'all' && connectorChip(connector) !== chip) return false;
    if (!q) return true;
    return `${connector.name} ${connector.id} ${connector.category}`
      .toLowerCase()
      .includes(q);
  });
  return {
    connected: matched.filter((connector) => connector.status === 'connected'),
    available: matched.filter((connector) => connector.status !== 'connected'),
  };
}

export function withStorageAndPublish(
  connectors: ConnectorDetail[],
): ConnectorDetail[] {
  const present = new Set(connectors.map((connector) => connector.id));
  const extras: ConnectorDetail[] = [
    stub('dropbox', 'Dropbox', 'files'),
    stub('box', 'Box', 'files'),
    stub('onedrive', 'OneDrive', 'files'),
    stub('youtube', 'YouTube', 'publishing'),
    stub('tiktok', 'TikTok', 'publishing'),
  ];
  return [
    ...connectors,
    ...extras.filter((connector) => !present.has(connector.id)),
  ];
}

function stub(id: string, name: string, category: string): ConnectorDetail {
  return {
    id,
    name,
    provider: 'native',
    category,
    status: 'available',
    tools: [],
    allowedToolNames: [],
    curatedToolNames: [],
    auth: { provider: 'oauth', configured: false },
  };
}
