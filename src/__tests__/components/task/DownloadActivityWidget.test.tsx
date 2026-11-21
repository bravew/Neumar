import type { DownloadActivity } from '@neumar/video-ir';
import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DownloadActivityWidget } from '@/components/task/DownloadActivityWidget';

import { renderWithProviders } from '../../helpers/render-with-providers';

const asset = {
  assetId: '101',
  name: 'clip.mp4',
  mime: 'video/mp4',
  size: 2048,
};
const activity = (items: DownloadActivity['items']): DownloadActivity => ({
  version: 1,
  taskId: 'task 1',
  runId: 'run-1',
  toolCallId: 'call-1',
  batchId: 'batch-1',
  items,
});

describe('DownloadActivityWidget', () => {
  it('shows measured progress, summing separate audio and video streams', () => {
    renderWithProviders(
      <DownloadActivityWidget
        activity={activity([
          {
            itemId: 'a',
            sequence: 1,
            phase: 'transferring',
            streams: [
              { streamId: 'video', bytes: 1024, totalBytes: 3072 },
              { streamId: 'audio', bytes: 1024, totalBytes: 1024 },
            ],
          },
        ])}
      />,
    );

    const bar = screen.getByRole('progressbar', { name: 'Video 1' });
    expect(bar).toHaveAttribute('value', '2048');
    expect(bar).toHaveAttribute('max', '4096');
    expect(screen.getByText(/2\.0 KB of 4\.0 KB/)).toBeInTheDocument();
    expect(screen.getByText('Downloading')).toBeInTheDocument();
  });

  it('is indeterminate, not zero, when a total is unknown', () => {
    renderWithProviders(
      <DownloadActivityWidget
        activity={activity([
          {
            itemId: 'a',
            sequence: 1,
            phase: 'transferring',
            streams: [{ streamId: 'video', bytes: 0 }],
          },
        ])}
      />,
    );

    const bar = screen.getByRole('progressbar', { name: 'Video 1' });
    expect(bar).not.toHaveAttribute('value');
    expect(screen.getByText(/0 B downloaded/)).toBeInTheDocument();
  });

  it('keeps a saved file playable beside a failed sibling', () => {
    const { container } = renderWithProviders(
      <DownloadActivityWidget
        activity={activity([
          { itemId: 'a', sequence: 2, phase: 'saved', asset },
          { itemId: 'b', sequence: 1, phase: 'failed', reason: 'unavailable' },
          { itemId: 'c', sequence: 1, phase: 'cancelled' },
        ])}
      />,
    );

    const video = container.querySelector('video');
    expect(video).toHaveAttribute('controls');
    expect(video).toHaveAttribute(
      'src',
      expect.stringMatching(/\/files\/tasks\/task%201\/downloads\/101$/),
    );
    expect(video).toHaveAccessibleName('clip.mp4');
    expect(screen.getByText('This video is unavailable.')).toBeInTheDocument();
    expect(screen.getByText('Cancelled')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('1 of 3 saved');
    expect(container.querySelectorAll('video')).toHaveLength(1);
  });

  it('falls back to a visible message when the video cannot play', () => {
    const { container } = renderWithProviders(
      <DownloadActivityWidget
        activity={activity([
          { itemId: 'a', sequence: 2, phase: 'saved', asset },
        ])}
      />,
    );

    fireEvent.error(container.querySelector('video')!);

    expect(container.querySelector('video')).toBeNull();
    const row = screen.getByText('clip.mp4').closest('li')!;
    expect(within(row).getByText(/can’t be played here/)).toBeInTheDocument();
  });
});
