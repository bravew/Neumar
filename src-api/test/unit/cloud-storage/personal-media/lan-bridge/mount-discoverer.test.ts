import { describe, expect, it } from 'vitest';

import {
  discoverLinuxMounts,
  discoverNetworkMounts,
} from '@/shared/integrations/cloud-storage/personal-media/lan-bridge';

describe('discoverNetworkMounts', () => {
  it('parses linux network mount points', async () => {
    const mounts = await discoverLinuxMounts(async () =>
      [
        '29 23 0:26 / /mnt/photos rw,relatime - cifs //nas/photos rw,vers=3.1.1',
        '30 23 0:27 / /mnt/local rw,relatime - ext4 /dev/disk rw',
        '31 23 0:28 / /mnt/family\\040photos rw,relatime - nfs nas:/family rw',
      ].join('\n'),
    );

    expect(mounts).toEqual([
      { path: '/mnt/photos', fsType: 'cifs', source: '//nas/photos' },
      { path: '/mnt/family photos', fsType: 'nfs', source: 'nas:/family' },
    ]);
  });

  it('lists mac volume candidates without failing when fs type is unavailable', async () => {
    const mounts = await discoverNetworkMounts({
      platform: 'darwin',
      readDirNames: async () => ['Photos', 'Macintosh HD'],
    });

    expect(mounts).toEqual([{ path: '/Volumes/Photos', label: 'Photos' }]);
  });
});
