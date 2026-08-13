import { describe, expect, it, vi } from 'vitest';

import { GoogleDriveProxyAdapter } from '@/shared/integrations/cloud-storage';

describe('GoogleDriveProxyAdapter', () => {
  it('maps listChildren to the site items route', async () => {
    const siteApiClient = {
      getJson: vi.fn(async () => ({ items: [], hasMore: false })),
    };
    const adapter = new GoogleDriveProxyAdapter(
      'conn-1',
      siteApiClient as never,
    );

    await adapter.listChildren({ parentId: 'root', cursor: 'cur', limit: 25 });

    expect(siteApiClient.getJson).toHaveBeenCalledWith(
      '/api/cloud-storage/connections/conn-1/items?parentId=root&cursor=cur&limit=25',
    );
  });

  it('streams downloads without buffering', async () => {
    const response = new Response('payload');
    const siteApiClient = {
      streamGetResponse: vi.fn(async () => response),
    };
    const adapter = new GoogleDriveProxyAdapter(
      'conn-1',
      siteApiClient as never,
    );

    await expect(adapter.download('file-1')).resolves.toBe(response);
    expect(siteApiClient.streamGetResponse).toHaveBeenCalledWith(
      '/api/cloud-storage/connections/conn-1/items/file-1/content',
      expect.objectContaining({ headers: expect.any(Headers) }),
    );
  });

  it('maps getChanges to the site changes route', async () => {
    const siteApiClient = {
      getJson: vi.fn(async () => ({ changes: [], hasMore: false })),
    };
    const adapter = new GoogleDriveProxyAdapter(
      'conn-1',
      siteApiClient as never,
    );

    await adapter.getChanges({ cursor: 'token', limit: 10, rootId: 'root-1' });

    expect(siteApiClient.getJson).toHaveBeenCalledWith(
      '/api/cloud-storage/connections/conn-1/changes?cursor=token&limit=10&rootId=root-1',
    );
  });
});
