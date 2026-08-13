import { describe, expect, it, vi } from 'vitest';

import { LinkedInClient } from '@/shared/integrations/social';
import { createLinkedInDestination } from '@/shared/services/publish/destinations/social';

import {
  createSocialInput,
  createSourceFixture,
  MemoryUploadSession,
} from './publish-social-helpers';

describe('LinkedIn publish destination', () => {
  it('requires an owner and carries caption disclosure fallback', async () => {
    const fixture = createSourceFixture();
    try {
      const uploadSession = new MemoryUploadSession('linkedin-chunked');
      const destination = createLinkedInDestination({
        client: new LinkedInClient({
          endpoints: { init: 'https://linkedin.example/init' },
        }),
        uploadSession,
      });
      const input = createSocialInput(fixture.source, 'linkedin', {
        owner: 'urn:li:organization:123',
      });

      const plan = await destination.plan(input);
      const handle = await destination.upload(input, {
        recordChunkProgress: vi.fn(),
      });
      const ref = await destination.finalize(handle);
      const post = ref.metadata?.post as {
        disclosure?: { fallbackCaptionSuffix?: string };
      };

      expect(plan.quotaPreview).toEqual([
        { kind: 'linkedin_posts_24h', cost: 1 },
      ]);
      expect(uploadSession.starts[0]!.initUrl).toBe(
        'https://linkedin.example/init',
      );
      expect(post.disclosure?.fallbackCaptionSuffix).toContain(
        'AI-generated content',
      );
      expect(ref.providerId).toBe('linkedin-chunked:media');
    } finally {
      fixture.close();
    }
  });
});
