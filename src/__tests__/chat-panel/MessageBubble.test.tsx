import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MessageBubble } from '@/components/shared/chat-panel';

describe('MessageBubble', () => {
  it('renders user and assistant bubble content', () => {
    render(
      <>
        <MessageBubble role="user">User text</MessageBubble>
        <MessageBubble role="assistant">Assistant text</MessageBubble>
      </>,
    );

    expect(screen.getByText('User text')).toBeInTheDocument();
    expect(screen.getByText('Assistant text')).toBeInTheDocument();
  });

  it('right-aligns user messages and renders assistant text without the user bubble surface', () => {
    render(
      <>
        <MessageBubble role="user">User text</MessageBubble>
        <MessageBubble role="assistant">Assistant text</MessageBubble>
      </>,
    );

    const userBubble = screen.getByText('User text');
    const assistantBubble = screen.getByText('Assistant text');

    expect(userBubble.parentElement).toHaveClass('justify-end');
    expect(userBubble).toHaveClass('bg-user-message', 'max-w-[85%]', 'w-fit');
    expect(assistantBubble.parentElement).toHaveClass('justify-start');
    expect(assistantBubble).toHaveClass('text-foreground', 'max-w-[92%]');
    expect(assistantBubble).not.toHaveClass('bg-user-message');
    expect(assistantBubble).not.toHaveClass('bg-muted');
  });
});
