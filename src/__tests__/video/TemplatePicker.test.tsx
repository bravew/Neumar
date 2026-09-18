import { screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TemplatePicker } from '@/components/video/TemplatePicker';

import { renderWithProviders as render } from '../helpers/render-with-providers';

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
      id: 'frame-framework-spine',
      rootKind: 'user',
      metadata: {
        id: 'frame-framework-spine',
        name: 'Explainer spine',
        engine: 'html',
        category: 'explainer',
        tags: ['framework'],
        version: '0.1.0',
        license: {
          spdx: 'Apache-2.0',
          attribution_required: false,
          redistribution_allowed: true,
          commercial_use: true,
        },
      },
      warnings: [],
    },
  ],
};

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => fakeGallery,
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('TemplatePicker framework badge', () => {
  it('shows a framework badge on tagged gallery templates', async () => {
    render(<TemplatePicker selectedId={null} onSelect={() => {}} />);
    await waitFor(() =>
      screen.getByTestId('template-row-frame-framework-spine'),
    );
    expect(screen.getByText('Framework')).toBeTruthy();
    expect(screen.queryByTestId('template-row-frame-clean-title')).toBeTruthy();
  });
});
