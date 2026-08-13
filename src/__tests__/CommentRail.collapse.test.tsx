import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { CommentRail } from '@/components/design/CommentRail';

import { renderWithProviders } from './helpers/render-with-providers';

describe('CommentRail collapse', () => {
  it('collapses to a count tab and expands again', async () => {
    const user = userEvent.setup();
    const onCollapsedChange = vi.fn();
    const comments = [
      {
        id: 'comment_1',
        status: 'open' as const,
        createdAt: '2026-05-15T00:00:00.000Z',
        text: 'Check spacing',
        target: { file: 'artifacts/index.html', id: 'hero' },
      },
    ];

    const { rerender } = renderWithProviders(
      <CommentRail
        comments={comments}
        activeFile="artifacts/index.html"
        onCollapsedChange={onCollapsedChange}
      />,
    );

    await user.click(
      screen.getByRole('button', { name: /collapse comments/i }),
    );
    expect(onCollapsedChange).toHaveBeenCalledWith(true);

    rerender(
      <CommentRail
        comments={comments}
        activeFile="artifacts/index.html"
        collapsed
        onCollapsedChange={onCollapsedChange}
      />,
    );
    expect(screen.getByText('1')).toBeVisible();
    await user.click(screen.getByRole('button', { name: /expand comments/i }));
    expect(onCollapsedChange).toHaveBeenCalledWith(false);
  });

  it('keeps resolved comments in a collapsed resolved section', () => {
    renderWithProviders(
      <CommentRail
        comments={[
          {
            id: 'comment_open',
            status: 'open' as const,
            createdAt: '2026-05-15T00:00:00.000Z',
            text: 'Open spacing note',
            target: { file: 'artifacts/index.html', id: 'hero' },
          },
          {
            id: 'comment_resolved',
            status: 'resolved' as const,
            createdAt: '2026-05-15T01:00:00.000Z',
            text: 'Resolved color note',
            target: { file: 'artifacts/index.html', id: 'cta' },
          },
        ]}
        activeFile="artifacts/index.html"
      />,
    );

    expect(screen.getByText('Open (1)')).toBeVisible();
    expect(screen.getByText('Open spacing note')).toBeVisible();
    expect(screen.getByText('Resolved (1)')).toBeVisible();
    expect(screen.getByText('Resolved color note')).not.toBeVisible();
  });

  it('renders image and note attachments', () => {
    renderWithProviders(
      <CommentRail
        projectId="design_attach"
        comments={[
          {
            id: 'comment_with_attachments',
            status: 'open' as const,
            createdAt: '2026-05-15T00:00:00.000Z',
            text: 'Use this screenshot.',
            target: { file: 'artifacts/index.html', id: 'hero' },
            attachments: [
              {
                kind: 'image',
                name: 'hero.png',
                mime: 'image/png',
                size: 68,
                path: 'comments/attachments/hero.png',
                alt: 'Hero screenshot',
              },
              { kind: 'note', text: 'Crop around the CTA.' },
            ],
          },
        ]}
        activeFile="artifacts/index.html"
      />,
    );

    const image = screen.getByRole('img', { name: 'Hero screenshot' });
    expect(image).toHaveAttribute(
      'src',
      expect.stringContaining('comments%2Fattachments%2Fhero.png'),
    );
    expect(screen.getByText(/Crop around the CTA/)).toBeVisible();
  });
});
