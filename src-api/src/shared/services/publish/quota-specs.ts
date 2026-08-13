import type { DestinationKind } from './types';

export type QuotaWindow = '1h' | '24h' | '30d';

export interface QuotaSpec {
  kind: string;
  cost: number;
  window: QuotaWindow;
  limit?: number;
  source?: 'static' | 'adapterCapabilities';
}

export const QUOTA_SPECS: Partial<Record<DestinationKind, QuotaSpec[]>> = {
  youtube: [{ kind: 'youtube_units', cost: 1_600, window: '24h' }],
  linkedin: [{ kind: 'linkedin_posts_24h', cost: 1, window: '24h' }],
  instagram: [
    {
      kind: 'ig_posts_24h',
      cost: 1,
      window: '24h',
      source: 'adapterCapabilities',
    },
  ],
  tiktok: [
    {
      kind: 'tiktok_init_24h',
      cost: 1,
      window: '24h',
      source: 'adapterCapabilities',
    },
  ],
  x: [{ kind: 'x_posts_24h', cost: 1, window: '24h' }],
  threads: [
    {
      kind: 'threads_posts_24h',
      cost: 1,
      window: '24h',
      source: 'adapterCapabilities',
    },
  ],
  bluesky: [
    {
      kind: 'bluesky_records_24h',
      cost: 1,
      window: '24h',
      source: 'adapterCapabilities',
    },
  ],
  mastodon: [
    {
      kind: 'mastodon_statuses_1h',
      cost: 1,
      window: '1h',
      source: 'adapterCapabilities',
    },
  ],
};

export function quotaPreviewFor(
  kind: DestinationKind,
): Array<{ kind: string; cost: number }> {
  return (QUOTA_SPECS[kind] ?? []).map((spec) => ({
    kind: spec.kind,
    cost: spec.cost,
  }));
}
