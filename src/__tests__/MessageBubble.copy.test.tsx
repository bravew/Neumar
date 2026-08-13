import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UserMessageBubble } from '@/components/task/UserMessageBubble';

import { renderWithProviders } from './helpers/render-with-providers';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

describe('UserMessageBubble copy', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    });
    document.execCommand = vi.fn(() => true);
  });

  it('copies user message text to the clipboard', async () => {
    renderWithProviders(
      <UserMessageBubble messageId="msg_1" content="Copy this" />,
    );

    fireEvent.click(screen.getByRole('button', { name: /^copy$/i }));

    expect(document.execCommand).toHaveBeenCalledWith('copy');
  });
});
