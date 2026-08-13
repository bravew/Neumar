import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AttributionChip } from '@/components/library/AttributionChip';

import { renderWithProviders } from '../helpers/render-with-providers';

describe('AttributionChip', () => {
  it('renders linked creator and source attribution', () => {
    renderWithProviders(
      <AttributionChip
        licenseInfo={{
          license: 'unsplash',
          attribution: {
            authorName: 'Jane Smith',
            sourceName: 'Unsplash',
            sourceUrl: 'https://unsplash.com/photos/abc',
          },
        }}
      />,
    );

    const link = screen.getByRole('link', {
      name: /Photo by Jane Smith on Unsplash/i,
    });
    expect(link).toHaveAttribute('href', 'https://unsplash.com/photos/abc');
    expect(screen.getByText('unsplash')).toBeInTheDocument();
  });

  it('falls back to required attribution copy', () => {
    renderWithProviders(
      <AttributionChip licenseInfo={{ requiresAttribution: true }} />,
    );

    expect(screen.getByText('Attribution required')).toBeInTheDocument();
  });

  it('does not render when no attribution or license data is present', () => {
    const { container } = renderWithProviders(
      <AttributionChip licenseInfo={{}} />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
