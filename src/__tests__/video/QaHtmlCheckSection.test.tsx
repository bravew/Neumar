import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { QaHtmlCheckSection } from '@/components/video/QaHtmlCheckSection';

import { renderWithProviders as render } from '../helpers/render-with-providers';

const REPORT = {
  schema: 'neuma.video.html-check.v1',
  compositionDir: 'hyperframes',
  summary: {
    ok: false,
    errorCount: 3,
    warningCount: 1,
    passes: [
      { key: 'lint', ok: false, errorCount: 3, warningCount: 1, enabled: true },
      {
        key: 'runtime',
        ok: true,
        errorCount: 0,
        warningCount: 0,
        enabled: true,
      },
      {
        key: 'layout',
        ok: true,
        errorCount: 0,
        warningCount: 0,
        enabled: true,
      },
      {
        key: 'motion',
        ok: true,
        errorCount: 0,
        warningCount: 0,
        enabled: false,
      },
      {
        key: 'contrast',
        ok: true,
        errorCount: 0,
        warningCount: 0,
        enabled: true,
      },
    ],
  },
  report: {
    lint: {
      findings: [
        {
          code: 'root_missing_composition_id',
          severity: 'error',
          message: 'Root composition is missing `data-composition-id`.',
        },
      ],
    },
    runtime: { findings: [] },
    layout: { findings: [] },
  },
};

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => REPORT });
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('QaHtmlCheckSection', () => {
  it('does not run the browser gate until asked', () => {
    render(<QaHtmlCheckSection projectId="project-1" />);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(screen.getByTestId('qa-html-check-run')).toBeInTheDocument();
  });

  it('renders every pass and the findings after a run', async () => {
    render(<QaHtmlCheckSection projectId="project-1" />);
    fireEvent.click(screen.getByTestId('qa-html-check-run'));

    expect(
      await screen.findByText('3 errors · 1 warnings'),
    ).toBeInTheDocument();
    expect(screen.getByText('Lint')).toBeInTheDocument();
    expect(screen.getByText('Contrast')).toBeInTheDocument();
    // motion is disabled in this report, so it shows "off" rather than counts
    expect(screen.getAllByText('off').length).toBeGreaterThan(0);
    expect(screen.getByText('root_missing_composition_id')).toBeInTheDocument();

    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toContain('/video/projects/project-1/html-check');
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      compositionDir: 'hyperframes',
    });
  });

  it('surfaces a typed backend failure instead of a blank panel', async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => ({
        error: 'HyperFrames is not installed',
        detail: { code: 'not-found' },
      }),
    });
    render(<QaHtmlCheckSection projectId="project-1" />);
    fireEvent.click(screen.getByTestId('qa-html-check-run'));

    await waitFor(() =>
      expect(
        screen.getByText('Check failed: HyperFrames is not installed'),
      ).toBeInTheDocument(),
    );
  });
});
