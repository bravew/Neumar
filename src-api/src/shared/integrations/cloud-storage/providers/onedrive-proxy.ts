import type { SiteApiClient } from '@/shared/auth/site-api-client';

import { SiteProxyAdapter } from './site-proxy-adapter';

export class OneDriveProxyAdapter extends SiteProxyAdapter {
  constructor(connectionId: string, siteApiClient: SiteApiClient) {
    super('onedrive', connectionId, siteApiClient, {
      fullTextSearch: true,
      thumbnails: true,
      exportContent: false,
      watch: true,
      longPoll: false,
      sharedDrives: false,
    });
  }
}
