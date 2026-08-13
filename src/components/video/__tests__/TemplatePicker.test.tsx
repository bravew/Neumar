import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders as render } from '../../../__tests__/helpers/render-with-providers';
import { EnginePicker } from '../EnginePicker';
import { TemplatePicker } from '../TemplatePicker';

const fakeGallery = {
  templates: [
    {
      id: 'frame-clean-title',
      rootKind: 'branding',
      metadata: {
        id: 'frame-clean-title',
        name: 'Clean Title',
        engine: 'html',
        category: 'intro-outro',
        tags: ['title'],
        version: '0.1.0',
        license: {
          spdx: 'Apache-2.0',
          attribution_required: false,
          redistribution_allowed: true,
          commercial_use: true,
        },
      },
      preview: {
        mode: 'poster',
        aspect: '16:9',
        posterUrl:
          '/video/html-gallery/frame-clean-title/asset?path=preview.png',
      },
      warnings: [],
    },
    {
      id: 'frame-quote-card',
      rootKind: 'branding',
      metadata: {
        id: 'frame-quote-card',
        name: 'Quote Card',
        engine: 'html',
        category: 'quote',
        tags: ['quote'],
        version: '0.1.0',
        license: {
          spdx: 'CC-BY-4.0',
          attribution_required: true,
          redistribution_allowed: true,
          commercial_use: true,
        },
      },
      warnings: [],
    },
  ],
};

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchSpy = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/source')) {
      return {
        ok: true,
        json: async () => ({ html: '<main>live preview</main>' }),
      };
    }
    return {
      ok: true,
      json: async () => fakeGallery,
    };
  });
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('TemplatePicker', () => {
  it('renders gallery rows and calls onSelect with the chosen template', async () => {
    const onSelect = vi.fn();
    render(<TemplatePicker selectedId={null} onSelect={onSelect} />);

    await waitFor(() => screen.getByTestId('template-row-frame-clean-title'));

    fireEvent.click(screen.getByTestId('template-row-frame-clean-title'));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0].id).toBe('frame-clean-title');
  });

  it('filters by search query (name / id / tag)', async () => {
    render(<TemplatePicker selectedId={null} onSelect={() => {}} />);
    await waitFor(() => screen.getByTestId('template-row-frame-clean-title'));

    fireEvent.change(screen.getByLabelText('search templates'), {
      target: { value: 'quote' },
    });

    expect(
      screen.queryByTestId('template-row-frame-clean-title'),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId('template-row-frame-quote-card'),
    ).toBeInTheDocument();
  });

  it('filters by category', async () => {
    render(
      <TemplatePicker
        selectedId={null}
        onSelect={() => {}}
        category="intro-outro"
      />,
    );
    await waitFor(() => screen.getByTestId('template-row-frame-clean-title'));
    expect(
      screen.queryByTestId('template-row-frame-quote-card'),
    ).not.toBeInTheDocument();
  });

  it('marks selected row as pressed', async () => {
    render(
      <TemplatePicker selectedId="frame-quote-card" onSelect={() => {}} />,
    );
    await waitFor(() => screen.getByTestId('template-row-frame-quote-card'));
    expect(screen.getByTestId('template-row-frame-quote-card')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(
      screen.getByTestId('template-row-frame-clean-title'),
    ).toHaveAttribute('aria-pressed', 'false');
  });

  it('uses poster previews without fetching raw source for poster templates', async () => {
    render(<TemplatePicker selectedId={null} onSelect={() => {}} />);
    await waitFor(() =>
      screen.getByTestId('template-poster-frame-clean-title'),
    );

    expect(
      screen.getByTestId('template-poster-frame-clean-title'),
    ).toHaveAttribute(
      'src',
      'http://127.0.0.1:5126/video/html-gallery/frame-clean-title/asset?path=preview.png',
    );
    expect(
      fetchSpy.mock.calls.some(([url]) =>
        String(url).includes('/frame-clean-title/source'),
      ),
    ).toBe(false);
  });
});

describe('EnginePicker', () => {
  it('renders a read-only chip with the engine id', () => {
    render(<EnginePicker engineId="html" />);
    expect(screen.getByTestId('engine-picker')).toHaveTextContent('html');
  });
});
