import { describe, expect, it } from 'vitest';

import {
  injectDisclosure,
  listDisclosureDestinations,
} from '@/shared/services/publish/provenance';
import type { DestinationKind } from '@/shared/services/publish/types';

describe('C2PA disclosure injector', () => {
  it('does not add platform fields when the manifest has no AI signal', () => {
    expect(
      injectDisclosure({
        manifest: { aiGenerated: false },
        destinationKind: 'youtube',
      }),
    ).toEqual({});
  });

  it('maps AI provenance to platform-native disclosure fields', () => {
    const cases: Array<{
      destinationKind: DestinationKind;
      expected: Record<string, unknown>;
    }> = [
      {
        destinationKind: 'youtube',
        expected: { status: { containsSyntheticMedia: true } },
      },
      {
        destinationKind: 'tiktok',
        expected: { post_info: { is_aigc: true } },
      },
      {
        destinationKind: 'instagram',
        expected: { disclosures: { ai_generated: true } },
      },
      {
        destinationKind: 'linkedin',
        expected: {
          commentaryDisclosure: {
            aiGenerated: true,
            fallbackCaptionSuffix: 'AI-generated content disclosed by Neuma.',
          },
        },
      },
      {
        destinationKind: 'threads',
        expected: { disclosures: { ai_generated: true } },
      },
      {
        destinationKind: 'bluesky',
        expected: {
          labels: { ai_generated: true },
          fallbackCaptionSuffix: 'AI-generated content disclosed by Neuma.',
        },
      },
      {
        destinationKind: 'mastodon',
        expected: {
          language: 'en',
          contentWarning: 'AI-generated media',
        },
      },
    ];

    for (const testCase of cases) {
      expect(
        injectDisclosure({
          manifest: { aiGenerated: true },
          destinationKind: testCase.destinationKind,
          language: 'en',
        }),
      ).toEqual(testCase.expected);
    }
  });

  it('requires explicit opt-in before appending X hashtag disclosure', () => {
    expect(
      injectDisclosure({
        manifest: { aiGenerated: true },
        destinationKind: 'x',
      }),
    ).toEqual({
      approvalDisclosure: {
        required: true,
        suggestedCaptionSuffix: '#AI',
      },
    });

    expect(
      injectDisclosure({
        manifest: { aiGenerated: true },
        destinationKind: 'x',
        captionDisclosureOptIn: true,
      }),
    ).toEqual({ textAppend: '#AI' });
  });

  it('keeps the mapping table explicit and discoverable', () => {
    expect(listDisclosureDestinations()).toEqual([
      'youtube',
      'tiktok',
      'instagram',
      'linkedin',
      'x',
      'threads',
      'bluesky',
      'mastodon',
    ]);
  });
});
