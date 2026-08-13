import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PreviewDrawOverlay } from '@/components/design/PreviewDrawOverlay';

import { renderWithProviders } from './helpers/render-with-providers';

describe('PreviewDrawOverlay', () => {
  it('composes pointer strokes and sends them to chat', async () => {
    const onSubmit = vi.fn();
    renderWithProviders(
      <div style={{ width: 320, height: 240, position: 'relative' }}>
        <PreviewDrawOverlay
          labels={{
            clear: 'Clear drawing',
            sendToChat: 'Send to chat',
            strokeCount: '{count} strokes',
          }}
          onSubmit={onSubmit}
        />
      </div>,
    );

    const canvas = screen.getByLabelText('0 strokes');
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 320,
      bottom: 240,
      width: 320,
      height: 240,
      toJSON: () => ({}),
    } as DOMRect);
    fireEvent.pointerDown(canvas, {
      pointerId: 1,
      pointerType: 'mouse',
      clientX: 10,
      clientY: 20,
    });
    fireEvent.pointerMove(canvas, {
      pointerId: 1,
      pointerType: 'mouse',
      clientX: 30,
      clientY: 40,
    });
    fireEvent.pointerUp(canvas, { pointerId: 1 });

    await screen.findByText('1 strokes');
    fireEvent.click(screen.getByRole('button', { name: /send to chat/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject([
      {
        pointerType: 'mouse',
        points: [
          { x: 10, y: 20 },
          { x: 30, y: 40 },
        ],
      },
    ]);
  });
});
