import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TeleprompterControls } from '@/components/video/TeleprompterControls';

import { renderWithProviders } from './helpers/render-with-providers';

describe('TeleprompterControls', () => {
  it('updates speed, font size, mirror, and playback controls', () => {
    const onStart = vi.fn();
    const onPause = vi.fn();
    const onReset = vi.fn();
    const onWpmChange = vi.fn();
    const onFontSizeChange = vi.fn();
    const onMirrorChange = vi.fn();

    renderWithProviders(
      <TeleprompterControls
        running={false}
        wpm={150}
        fontSize={44}
        mirror={false}
        onStart={onStart}
        onPause={onPause}
        onReset={onReset}
        onWpmChange={onWpmChange}
        onFontSizeChange={onFontSizeChange}
        onMirrorChange={onMirrorChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /start/i }));
    fireEvent.click(screen.getByRole('button', { name: /reset/i }));
    fireEvent.change(screen.getByDisplayValue('150'), {
      target: { value: '180' },
    });
    fireEvent.change(screen.getByDisplayValue('44'), {
      target: { value: '52' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: /mirror/i }));

    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onPause).not.toHaveBeenCalled();
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(onWpmChange).toHaveBeenCalledWith(180);
    expect(onFontSizeChange).toHaveBeenCalledWith(52);
    expect(onMirrorChange).toHaveBeenCalledWith(true);
  });
});
