import { describe, expect, it, vi } from 'vitest';

import { TikTokClient } from '@/shared/integrations/social';
import { createTikTokDestination } from '@/shared/services/publish/destinations/social';

import {
  createSocialInput,
  createSourceFixture,
  MemoryUploadSession,
} from './publish-social-helpers';

describe('TikTok publish destination', () => {
  it('defaults to inbox upload and sets post_info.is_aigc', async () => {
    const fixture = createSourceFixture();
    try {
      const uploadSession = new MemoryUploadSession('tiktok-chunked');
      const destination = createTikTokDestination({
        client: new TikTokClient({
          endpoints: { init: 'https://tiktok.example/init' },
        }),
        uploadSession,
      });
      const input = createSocialInput(fixture.source, 'tiktok');

      const plan = await destination.plan(input);
      await destination.upload(input, { recordChunkProgress: vi.fn() });
      const body = JSON.parse(uploadSession.starts[0]!.body as string) as {
        post_info: { is_aigc?: boolean; privacy_level?: string };
      };

      expect(plan.quotaPreview).toEqual([{ kind: 'tiktok_init_24h', cost: 1 }]);
      expect(body.post_info.is_aigc).toBe(true);
      expect(body.post_info.privacy_level).toBe('SELF_ONLY');
    } finally {
      fixture.close();
    }
  });
});
