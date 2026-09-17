import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FrameworkApplyPanel } from '@/components/video/reference/FrameworkApplyPanel';
import type { VideoFramework } from '@/shared/types/video';

vi.mock('@/shared/providers/language-provider', () => ({
  useLanguage: () => ({
    t: {
      video: {
        reference: {
          apply: {
            title: 'Apply to timeline',
            chosen: 'Chosen',
            alternatives: 'Alternatives',
            gaps: 'Unfilled required slots',
            fallback: 'Fallback',
            cost: 'Estimated cost',
            empty: 'No matching project assets yet.',
            blocked: 'Fill or waive required slots before applying.',
            reason: 'Reason',
            none: 'No candidates',
            preview: 'Preview',
            approve: 'Approve',
            applying: 'Applying…',
            applySuccess: 'Applied to the timeline.',
            applyError: 'Apply failed: {error}',
            ops: 'Proposed operations',
          },
        },
      },
    },
  }),
}));

const framework: VideoFramework = {
  id: 'fw-1',
  version: 1,
  displayName: 'Explainer spine',
  category: 'explainer',
  hook: 'cold-open',
  pace: 'medium',
  aspectRatios: ['16:9'],
  totalDuration: { typicalMs: 4000, minMs: 2000, maxMs: 8000 },
  sections: [],
  systems: [],
  provenance: {
    referenceId: 'ref-1',
    derivedFromArtifacts: ['analysis'],
    extractedBy: 'test',
    extractedAt: '2026-09-15T00:00:00.000Z',
  },
  confidence: 0.8,
};

describe('FrameworkApplyPanel', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows bound assets, gaps, and a preview', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (input: RequestInfo) => {
        const url = String(input);
        if (url.includes('/bind')) {
          return {
            ok: true,
            json: async () => ({
              bindings: [
                {
                  sectionId: 'sec-hook',
                  slot: { id: 'slot-1', kind: 'a-roll', required: true },
                  chosen: {
                    assetId: 'asset-user',
                    reason: 'video matches a-roll',
                  },
                  alternatives: [{ assetId: 'asset-alt', reason: 'runner-up' }],
                },
              ],
              gaps: [],
            }),
          };
        }
        if (url.includes('/preview')) {
          return {
            ok: true,
            json: async () => ({
              ops: [{ kind: 'clip.insert', trackId: 'track-video-main' }],
              blocked: [],
              gaps: [],
            }),
          };
        }
        return { ok: true, json: async () => ({}) };
      }),
    );
    render(<FrameworkApplyPanel projectId="project-1" framework={framework} />);
    expect(await screen.findByText(/asset-user/)).toBeTruthy();
    expect(screen.getByText(/asset-alt/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Preview' }));
    expect(await screen.findByText('clip.insert')).toBeTruthy();
    expect(initWasPreview()).toBe(true);
  });

  it('reports apply failure instead of swallowing it', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (input: RequestInfo) => {
        const url = String(input);
        if (url.includes('/bind')) {
          return { ok: true, json: async () => ({ bindings: [], gaps: [] }) };
        }
        if (url.includes('/apply')) {
          return {
            ok: false,
            status: 409,
            json: async () => ({ error: 'Project revision conflict' }),
          };
        }
        return { ok: true, json: async () => ({}) };
      }),
    );
    render(<FrameworkApplyPanel projectId="project-1" framework={framework} />);
    await user.click(await screen.findByRole('button', { name: 'Approve' }));
    expect(
      await screen.findByText(/Apply failed: Project revision conflict/),
    ).toBeTruthy();
  });

  it('confirms apply success', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (input: RequestInfo) => {
        const url = String(input);
        if (url.includes('/bind')) {
          return { ok: true, json: async () => ({ bindings: [], gaps: [] }) };
        }
        if (url.includes('/apply')) {
          return { ok: true, json: async () => ({ project: {} }) };
        }
        return { ok: true, json: async () => ({}) };
      }),
    );
    render(<FrameworkApplyPanel projectId="project-1" framework={framework} />);
    await user.click(await screen.findByRole('button', { name: 'Approve' }));
    expect(await screen.findByText('Applied to the timeline.')).toBeTruthy();
  });
});

function initWasPreview(): boolean {
  const fetchSpy = fetch as unknown as ReturnType<typeof vi.fn>;
  return fetchSpy.mock.calls.some(([url]) => String(url).includes('/preview'));
}
