import { describe, expect, it, vi } from 'vitest';

import { InstagramClient } from '@/shared/integrations/social';
import { createInstagramDestination } from '@/shared/services/publish/destinations/social';

import {
  createSocialInput,
  createSourceFixture,
  MemoryUploadSession,
} from './publish-social-helpers';

describe('Instagram publish destination', () => {
  it('injects AI disclosure into the Graph media container request', async () => {
    const fixture = createSourceFixture();
    try {
      const uploadSession = new MemoryUploadSession('instagram-rupload');
      const destination = createInstagramDestination({
        client: new InstagramClient({
          endpoints: { init: 'https://ig.example/media' },
        }),
        uploadSession,
      });
      const input = createSocialInput(fixture.source, 'instagram', {
        mediaType: 'REELS',
      });

      const handle = await destination.upload(input, {
        recordChunkProgress: vi.fn(),
      });
      const ref = await destination.finalize(handle);
      const body = JSON.parse(uploadSession.starts[0]!.body as string) as {
        ai_generated?: boolean;
        media_type?: string;
      };

      expect(body.ai_generated).toBe(true);
      expect(body.media_type).toBe('REELS');
      expect(ref.metadata?.platform).toBe('instagram');
    } finally {
      fixture.close();
    }
  });
});
