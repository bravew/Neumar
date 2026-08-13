import { describe, expect, it, vi } from 'vitest';

import { XClient } from '@/shared/integrations/social';
import { createXDestination } from '@/shared/services/publish/destinations/social';

import {
  createSocialInput,
  createSourceFixture,
  MemoryUploadSession,
} from './publish-social-helpers';

describe('X publish destination', () => {
  it('requires opt-in before appending hashtag disclosure', async () => {
    const fixture = createSourceFixture();
    try {
      const uploadSession = new MemoryUploadSession('x-media-upload');
      const destination = createXDestination({
        client: new XClient(),
        uploadSession,
      });
      const input = createSocialInput(fixture.source, 'x');

      const handle = await destination.upload(input, {
        recordChunkProgress: vi.fn(),
      });
      const ref = await destination.finalize(handle);
      const post = ref.metadata?.post as {
        text?: string;
        disclosure?: { suggestedCaptionSuffix?: string };
      };

      expect(post.text).not.toContain('#AI');
      expect(post.disclosure?.suggestedCaptionSuffix).toBe('#AI');

      const optedIn = createSocialInput(fixture.source, 'x', {
        captionDisclosureOptIn: true,
      });
      const optedHandle = await destination.upload(optedIn, {
        recordChunkProgress: vi.fn(),
      });
      const optedRef = await destination.finalize(optedHandle);
      const optedPost = optedRef.metadata?.post as { text?: string };

      expect(optedPost.text).toContain('#AI');
    } finally {
      fixture.close();
    }
  });
});
