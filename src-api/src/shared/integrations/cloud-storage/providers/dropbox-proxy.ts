import type { SiteApiClient } from '@/shared/auth/site-api-client';

import { SiteProxyAdapter } from './site-proxy-adapter';

export class DropboxProxyAdapter extends SiteProxyAdapter {
  constructor(connectionId: string, siteApiClient: SiteApiClient) {
    super('dropbox', connectionId, siteApiClient, {
      fullTextSearch: true,
      thumbnails: true,
      exportContent: false,
      watch: true,
      longPoll: true,
      sharedDrives: false,
    });
  }
}
