import type { DestinationKind } from '../types';
import type { DisclosureFields, NeumaManifest } from './types';

export interface DisclosureInput {
  manifest: Pick<NeumaManifest, 'aiGenerated'>;
  destinationKind: DestinationKind;
  captionDisclosureOptIn?: boolean;
  language?: string;
}

type DisclosureFactory = (input: DisclosureInput) => DisclosureFields;

const AI_DISCLOSURE_FACTORIES: Partial<
  Record<DestinationKind, DisclosureFactory>
> = {
  youtube: () => ({ status: { containsSyntheticMedia: true } }),
  tiktok: () => ({ post_info: { is_aigc: true } }),
  instagram: () => ({ disclosures: { ai_generated: true } }),
  linkedin: () => ({
    commentaryDisclosure: {
      aiGenerated: true,
      fallbackCaptionSuffix: 'AI-generated content disclosed by Neuma.',
    },
  }),
  x: (input) =>
    input.captionDisclosureOptIn
      ? { textAppend: '#AI' }
      : {
          approvalDisclosure: {
            required: true,
            suggestedCaptionSuffix: '#AI',
          },
        },
  threads: () => ({ disclosures: { ai_generated: true } }),
  bluesky: () => ({
    labels: { ai_generated: true },
    fallbackCaptionSuffix: 'AI-generated content disclosed by Neuma.',
  }),
  mastodon: (input) => ({
    language: input.language,
    contentWarning: 'AI-generated media',
  }),
};

export function injectDisclosure(input: DisclosureInput): DisclosureFields {
  if (!input.manifest.aiGenerated) return {};
  const factory = AI_DISCLOSURE_FACTORIES[input.destinationKind];
  return factory ? factory(input) : {};
}

export function listDisclosureDestinations(): DestinationKind[] {
  return Object.keys(AI_DISCLOSURE_FACTORIES) as DestinationKind[];
}
