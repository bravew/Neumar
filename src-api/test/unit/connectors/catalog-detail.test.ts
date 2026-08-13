import { describe, expect, it } from 'vitest';

import { connectorDefinitionToDetail } from '@/shared/connectors/catalog';
import {
  CONNECTOR_SEED_CATALOG,
  getConnectorCatalogDefinitions,
} from '@/shared/connectors/seed';

describe('connector catalog details', () => {
  it('round-trips every seed connector into a stable detail payload', () => {
    const details = CONNECTOR_SEED_CATALOG.map((definition) =>
      connectorDefinitionToDetail(definition),
    );

    expect(details).toHaveLength(8);
    expect(details.map((detail) => detail.id)).toEqual([
      'github',
      'notion',
      'linear',
      'slack',
      'stripe',
      'gmail',
      'drive',
      'calendar',
    ]);

    for (const detail of details) {
      expect(detail.status).toBe('available');
      expect(detail.allowedToolNames).toEqual(
        expect.arrayContaining(detail.curatedToolNames),
      );
      expect(detail.tools.map((tool) => tool.name)).toEqual(
        expect.arrayContaining(detail.allowedToolNames),
      );
      expect(detail.auth).toMatchObject({
        configured: detail.auth.provider === 'none',
      });
    }
  });

  it('deep-clones definitions for callers', () => {
    const [first] = getConnectorCatalogDefinitions();
    if (!first) throw new Error('missing seed connector');

    first.allowedToolNames.push('github.injected_tool');
    first.tools[0]?.requiredScopes.push('repo:write');

    const [fresh] = getConnectorCatalogDefinitions();
    expect(fresh?.allowedToolNames).not.toContain('github.injected_tool');
    expect(fresh?.tools[0]?.requiredScopes).not.toContain('repo:write');
  });

  it('marks local or no-auth connectors configured by default', () => {
    const detail = connectorDefinitionToDetail({
      id: 'local-files',
      name: 'Local files',
      provider: 'local',
      category: 'Local',
      authentication: 'none',
      allowedToolNames: [],
      tools: [],
    });

    expect(detail.auth).toEqual({ provider: 'none', configured: true });
  });
});
