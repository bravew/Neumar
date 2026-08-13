import { describe, expect, it } from 'vitest';

import type { FetchedSource } from '@/shared/video/source/ingest';
import {
  VIDEO_SOURCE_INGEST_PROVIDER,
  buildSourceProvenance,
} from '@/shared/video/source/provenance';
import type { MediaProvenance } from '@/shared/video/types';

const fetched: FetchedSource = {
  url: 'https://example.com/article',
  title: 'Example Article',
  markdown: 'body',
  kind: 'article',
  truncated: false,
};

describe('buildSourceProvenance', () => {
  it('stamps provider, sourceUrl, display name, and ISO timestamp', () => {
    const at = new Date('2026-06-06T10:00:00Z');
    const result = buildSourceProvenance(fetched, { now: () => at });
    expect(result.provider).toBe(VIDEO_SOURCE_INGEST_PROVIDER);
    expect(result.sourceUrl).toBe(fetched.url);
    expect(result.sourceDisplayName).toBe(fetched.title);
    expect(result.sourceFetchedAt).toBe(at.toISOString());
  });

  it('falls back to the URL when the upstream title is empty', () => {
    const result = buildSourceProvenance({ ...fetched, title: '' });
    expect(result.sourceDisplayName).toBe(fetched.url);
  });

  it('produces a partial that spreads cleanly onto MediaProvenance without losing model/cost', () => {
    const existing: MediaProvenance = {
      provider: 'seedream-5-0',
      model: 'seedream-5-0',
      cost: 0.01,
    };
    const merged: MediaProvenance = {
      ...existing,
      ...buildSourceProvenance(fetched),
    };
    expect(merged.model).toBe('seedream-5-0');
    expect(merged.cost).toBe(0.01);
    expect(merged.sourceUrl).toBe(fetched.url);
    expect(merged.provider).toBe(VIDEO_SOURCE_INGEST_PROVIDER);
  });
});
