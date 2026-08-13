import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MediaGridView, type MediaGridItem } from '@/components/library';

import { renderWithProviders } from '../helpers/render-with-providers';

const ITEMS: MediaGridItem[] = [
  {
    id: 'asset-1',
    name: 'Mountain.jpg',
    kind: 'image',
    thumbnailUrl: 'https://cdn.example.com/mountain.jpg',
    licenseInfo: {
      license: 'unsplash',
      attribution: {
        authorName: 'Jane Smith',
        sourceName: 'Unsplash',
        sourceUrl: 'https://unsplash.com/photos/abc',
      },
    },
  },
  {
    id: 'asset-2',
    name: 'Clip.mp4',
    kind: 'video',
  },
];

describe('MediaGridView', () => {
  it('renders thumbnails and attribution chips', () => {
    renderWithProviders(<MediaGridView items={ITEMS} />);

    expect(screen.getByAltText('Mountain.jpg')).toHaveAttribute(
      'src',
      'https://cdn.example.com/mountain.jpg',
    );
    expect(screen.getByText('Photo by Jane Smith on Unsplash')).toBeVisible();
  });

  it('opens and selects items with stable ids', () => {
    const onOpen = vi.fn();
    const onToggleSelect = vi.fn();
    renderWithProviders(
      <MediaGridView
        items={ITEMS}
        selectedIds={['asset-2']}
        onOpen={onOpen}
        onToggleSelect={onToggleSelect}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Mountain.jpg' }));
    expect(onOpen).toHaveBeenCalledWith(ITEMS[0]);

    const selectedButton = screen
      .getAllByRole('button', { pressed: true })
      .find((button) => button.getAttribute('aria-pressed') === 'true');
    expect(selectedButton).toBeDefined();

    fireEvent.click(screen.getAllByRole('button', { pressed: false })[0]!);
    expect(onToggleSelect).toHaveBeenCalledWith(ITEMS[0]);
  });

  it('renders an empty state', () => {
    renderWithProviders(<MediaGridView items={[]} />);

    expect(screen.getByText('No media results.')).toBeVisible();
  });
});
