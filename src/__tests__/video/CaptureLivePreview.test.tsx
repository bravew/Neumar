import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CaptureLivePreview } from '@/components/video/capture/CaptureLivePreview';

import { renderWithProviders } from '../helpers/render-with-providers';

describe('CaptureLivePreview', () => {
  it('attaches and clears the browser media stream', () => {
    const stream = { getTracks: () => [] } as unknown as MediaStream;

    const { unmount } = renderWithProviders(
      <CaptureLivePreview
        stream={stream}
        state="recording"
        nativeActive={false}
      />,
    );

    const video = screen.getByLabelText(
      /live camera preview/i,
    ) as HTMLVideoElement;
    expect(video.srcObject).toBe(stream);

    unmount();

    expect(video.srcObject).toBeNull();
  });

  it('shows native disk recording status without a browser stream', () => {
    renderWithProviders(
      <CaptureLivePreview
        stream={null}
        state="recording"
        nativeActive={true}
      />,
    );

    expect(
      screen.getByText(/native capture is recording directly to disk/i),
    ).toBeInTheDocument();
  });
});
