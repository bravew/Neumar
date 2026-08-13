import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/__tests__/helpers/render-with-providers';
import { VideoAgentMessageContent } from '@/components/video/VideoAgentMessageContent';
import type { VideoProject } from '@/shared/types/video';
import { extractPreviewUrls } from '@/shared/video/link-preview';

function project(): VideoProject {
  return {
    id: 'project-1',
    name: 'Preview project',
    template: 'product-reel',
    prompt: '',
    assets: [],
    createdAt: '2026-06-21T00:00:00Z',
    updatedAt: '2026-06-21T00:00:00Z',
  };
}

describe('VideoAgentMessageContent link previews', () => {
  it('extracts deduped preview URLs from markdown tables and links', () => {
    expect(
      extractPreviewUrls(
        '| Video |\n| --- |\n| [Clip](https://youtube.com/shorts/abc12345678) |\nhttps://youtube.com/shorts/abc12345678',
      ),
    ).toEqual(['https://youtube.com/shorts/abc12345678']);
  });

  it('renders a click-to-play video preview card for assistant links', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          kind: 'video',
          provider: 'youtube',
          url: 'https://youtube.com/shorts/abc12345678',
          title: 'Match highlights',
          authorName: 'Titans',
          thumbnailUrl: 'https://i.ytimg.com/vi/abc12345678/hqdefault.jpg',
          embedUrl: 'https://www.youtube-nocookie.com/embed/abc12345678',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    renderWithProviders(
      <VideoAgentMessageContent
        content={
          '| Video |\n| --- |\n| [Clip](https://youtube.com/shorts/abc12345678) |'
        }
        project={project()}
        streaming={false}
      />,
    );

    expect(await screen.findByText('Match highlights')).toBeInTheDocument();
    const previewButtons = screen.getAllByRole('button', { name: 'Preview' });
    const previewButton = previewButtons.at(-1);
    if (!previewButton) throw new Error('Expected preview button');
    fireEvent.click(previewButton);

    await waitFor(() => {
      const frame = screen.getByTitle('Match highlights');
      expect(frame.getAttribute('src')).toContain(
        'https://www.youtube-nocookie.com/embed/abc12345678',
      );
      expect(frame.getAttribute('src')).toContain('autoplay=1');
    });
  });

  it('plays the clicked preview inline and keeps it after mouse leaves the card', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          kind: 'video',
          provider: 'youtube',
          url: 'https://youtube.com/shorts/abc12345678',
          title: 'Match highlights',
          authorName: 'Titans',
          thumbnailUrl: 'https://i.ytimg.com/vi/abc12345678/hqdefault.jpg',
          embedUrl: 'https://www.youtube-nocookie.com/embed/abc12345678',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    renderWithProviders(
      <VideoAgentMessageContent
        content={
          '| Video |\n| --- |\n| [Clip](https://youtube.com/shorts/abc12345678) |'
        }
        project={project()}
        streaming={false}
      />,
    );

    expect(await screen.findByText('Match highlights')).toBeInTheDocument();
    const card = screen.getByTestId('external-link-preview-card');
    const previewButtons = screen.getAllByRole('button', { name: 'Preview' });
    const previewButton = previewButtons.at(-1);
    if (!previewButton) throw new Error('Expected preview button');
    fireEvent.click(previewButton);
    fireEvent.mouseLeave(card);

    await waitFor(() => {
      // The player renders inline inside the card, not in a separate section.
      const player = screen.getByTestId('external-link-inline-player');
      expect(card).toContainElement(player);
      const frame = screen.getByTitle('Match highlights');
      expect(frame.getAttribute('src')).toContain(
        'https://www.youtube-nocookie.com/embed/abc12345678',
      );
    });
  });
});
