import { describe, expect, it } from 'vitest';

import { groupConnectors } from '@/components/settings/tabs/connectors/group-connectors';
import type { ConnectorDetail } from '@/components/settings/tabs/connectors/types';

function connector(
  id: string,
  name: string,
  category: string,
  status: ConnectorDetail['status'],
): ConnectorDetail {
  return {
    id,
    name,
    provider: 'composio',
    category,
    status,
    tools: [],
    allowedToolNames: [],
    curatedToolNames: [],
    auth: { provider: 'oauth', configured: false },
  };
}

const catalog = [
  connector('slack', 'Slack', 'work', 'available'),
  connector('drive', 'Google Drive', 'files', 'connected'),
  connector('youtube', 'YouTube', 'publishing', 'available'),
];

describe('groupConnectors', () => {
  it('splits connected and available', () => {
    const groups = groupConnectors(catalog, '', 'all');
    expect(groups.connected.map((item) => item.id)).toEqual(['drive']);
    expect(groups.available.map((item) => item.id)).toEqual([
      'slack',
      'youtube',
    ]);
  });

  it('filters by files, work apps, and publishing', () => {
    expect(groupConnectors(catalog, '', 'files').connected[0]?.id).toBe(
      'drive',
    );
    expect(groupConnectors(catalog, '', 'work').available[0]?.id).toBe('slack');
    expect(groupConnectors(catalog, '', 'publishing').available[0]?.id).toBe(
      'youtube',
    );
  });

  it('matches a search query across name and id', () => {
    const groups = groupConnectors(catalog, 'you', 'all');
    expect(groups.available.map((item) => item.id)).toEqual(['youtube']);
    expect(groups.connected).toEqual([]);
  });
});
