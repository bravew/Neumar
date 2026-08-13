import { afterEach, describe, expect, it, vi } from 'vitest';

import { ingestComposerSources } from '@/shared/video/ingest-composer-sources';
import * as client from '@/shared/video/source-ingest';

vi.mock('@/shared/video/source-ingest', async (orig) => {
  const actual = await orig<typeof import('@/shared/video/source-ingest')>();
  return { ...actual, ingestSource: vi.fn() };
});

const ingestSource = vi.mocked(client.ingestSource);

const MESSAGES = {
  fetching: 'Fetching {count}',
  truncated: 'Truncated {title}',
  errors: {
    'oversized-body': 'too big',
    unknown: 'unknown error',
  },
};

afterEach(() => {
  vi.clearAllMocks();
});

describe('ingestComposerSources', () => {
  it('returns the base prompt unchanged when there are no URLs', async () => {
    const emit = vi.fn();
    const out = await ingestComposerSources('no links', 'base', MESSAGES, emit);
    expect(out).toBe('base');
    expect(ingestSource).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });

  it('leaves a YouTube link for the agent to download (no scraping)', async () => {
    const emit = vi.fn();
    const out = await ingestComposerSources(
      'put video as the first scene https://www.youtube.com/watch?v=NW1moSz-C4A',
      'put video as the first scene https://www.youtube.com/watch?v=NW1moSz-C4A',
      MESSAGES,
      emit,
    );
    expect(ingestSource).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
    expect(out).not.toContain('[FETCHED SOURCE');
    expect(out).toContain('youtube.com/watch?v=NW1moSz-C4A');
  });

  it('appends fetched source markdown and emits a fetching note', async () => {
    ingestSource.mockResolvedValue({
      ok: true,
      source: {
        url: 'https://a.com',
        title: 'Title',
        markdown: 'BODY',
        kind: 'article',
        truncated: false,
      },
    });
    const emit = vi.fn();

    const out = await ingestComposerSources(
      'check https://a.com',
      'base',
      MESSAGES,
      emit,
    );

    expect(out).toContain('base');
    expect(out).toContain('BODY');
    expect(out).toContain('https://a.com');
    expect(emit).toHaveBeenCalledWith('Fetching 1');
  });

  it('emits a truncation notice when the source was truncated', async () => {
    ingestSource.mockResolvedValue({
      ok: true,
      source: {
        url: 'https://a.com',
        title: 'Title',
        markdown: 'BODY',
        kind: 'article',
        truncated: true,
      },
    });
    const emit = vi.fn();

    await ingestComposerSources('https://a.com', '', MESSAGES, emit);
    expect(emit).toHaveBeenCalledWith('Truncated Title');
  });

  it('emits a localized error for a failed ingest', async () => {
    ingestSource.mockResolvedValue({ ok: false, code: 'oversized-body' });
    const emit = vi.fn();

    const out = await ingestComposerSources(
      'https://a.com',
      'base',
      MESSAGES,
      emit,
    );
    expect(out).toBe('base');
    expect(emit).toHaveBeenCalledWith('too big');
  });

  it('is a silent no-op when ingestion is disabled by the flag', async () => {
    ingestSource.mockResolvedValue({
      ok: false,
      code: 'source-ingestion-disabled',
    });
    const emit = vi.fn();

    const out = await ingestComposerSources(
      'https://a.com',
      'base',
      MESSAGES,
      emit,
    );
    expect(out).toBe('base');
    // The "fetching" note is deferred until a non-disabled result arrives, so a
    // flag-off run is fully silent — no phantom status with no follow-up.
    expect(emit).not.toHaveBeenCalled();
  });

  it('bails without emitting when the signal is already aborted', async () => {
    ingestSource.mockResolvedValue({ ok: false, code: 'oversized-body' });
    const emit = vi.fn();
    const controller = new AbortController();
    controller.abort();

    const out = await ingestComposerSources(
      'https://a.com',
      'base',
      MESSAGES,
      emit,
      controller.signal,
    );
    expect(out).toBe('base');
    expect(emit).not.toHaveBeenCalled();
  });
});
