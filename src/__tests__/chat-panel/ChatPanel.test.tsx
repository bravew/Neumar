import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ChatPanel } from '@/components/shared/chat-panel';

describe('ChatPanel', () => {
  it('renders compound header, messages, composer, and empty slots', () => {
    render(
      <ChatPanel aria-label="Agent chat">
        <ChatPanel.Header actions={<button type="button">Stop</button>}>
          <h2>Video agent</h2>
        </ChatPanel.Header>
        <ChatPanel.Messages autoScrollKey={1}>
          <p>Hello</p>
        </ChatPanel.Messages>
        <ChatPanel.Composer>
          <button type="button">Send</button>
        </ChatPanel.Composer>
        <ChatPanel.Empty show={false}>Empty</ChatPanel.Empty>
      </ChatPanel>,
    );

    expect(screen.getByLabelText('Agent chat')).toBeInTheDocument();
    expect(screen.getByText('Video agent')).toBeInTheDocument();
    expect(screen.getByText('Hello')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
    expect(screen.queryByText('Empty')).not.toBeInTheDocument();
  });

  it('supports virtualized message children without adding scroll spacing', () => {
    render(
      <ChatPanel aria-label="Virtual chat">
        <ChatPanel.Messages virtualized>
          <div data-testid="virtual-list">Rows</div>
        </ChatPanel.Messages>
      </ChatPanel>,
    );

    expect(screen.getByTestId('virtual-list')).toHaveTextContent('Rows');
  });

  it('follows content appended to the active streaming message', () => {
    const scrollTo = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
      configurable: true,
      value: scrollTo,
    });

    const { rerender } = render(
      <ChatPanel aria-label="Streaming chat">
        <ChatPanel.Messages autoScrollKey={1} followOutput>
          <p>Creating a head image.</p>
        </ChatPanel.Messages>
      </ChatPanel>,
    );
    scrollTo.mockClear();

    rerender(
      <ChatPanel aria-label="Streaming chat">
        <ChatPanel.Messages autoScrollKey={1} followOutput>
          <p>Creating a head image. Choose how to continue.</p>
        </ChatPanel.Messages>
      </ChatPanel>,
    );

    expect(scrollTo).toHaveBeenCalledWith({
      top: expect.any(Number),
      behavior: 'auto',
    });
  });
});
