import { describe, expect, it, vi } from 'vitest';

import { YouTubeClient } from '@/shared/integrations/social';
import { createYouTubeDestination } from '@/shared/services/publish/destinations/social';

import {
  createSocialInput,
  createSourceFixture,
  MemoryUploadSession,
} from './publish-social-helpers';

describe('YouTube publish destination', () => {
  it('plans approval, quota, disclosure, and Google resumable upload', async () => {
    const fixture = createSourceFixture();
    try {
      const uploadSession = new MemoryUploadSession('google-resumable');
      const destination = createYouTubeDestination({
        client: new YouTubeClient({
          endpoints: { upload: 'https://youtube.example/upload' },
        }),
        uploadSession,
      });
      const input = createSocialInput(fixture.source, 'youtube');

      const plan = await destination.plan(input);
      const handle = await destination.upload(input, {
        recordChunkProgress: vi.fn(),
      });
      const ref = await destination.finalize(handle);
      const body = JSON.parse(uploadSession.starts[0]!.body as string) as {
        status: { containsSyntheticMedia?: boolean };
      };

      expect(destination.capabilities().approvalDefault).toBe(true);
      expect(plan.requiresApproval).toBe(true);
      expect(plan.quotaPreview).toEqual([
        { kind: 'youtube_units', cost: 1_600 },
      ]);
      expect(uploadSession.starts[0]!.initUrl).toBe(
        'https://youtube.example/upload',
      );
      expect(body.status.containsSyntheticMedia).toBe(true);
      expect(ref.providerId).toBe('google-resumable:media');
    } finally {
      fixture.close();
    }
  });
});
