import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MessageFeedback } from '@/components/design/MessageFeedback';

import { renderWithProviders } from './helpers/render-with-providers';

describe('MessageFeedback', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('submits positive feedback and allows changes', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        jsonResponse({ feedback: {} }),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    renderWithProviders(
      <MessageFeedback projectId="design_feedback" messageId="msg_1" />,
    );

    await user.click(screen.getByRole('button', { name: /^helpful$/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const feedbackCall = fetchMock.mock.calls.find(([input]) =>
      String(input).includes('/messages/msg_1/feedback'),
    );
    expect(JSON.parse(String(feedbackCall?.[1]?.body))).toMatchObject({
      rating: 'up',
    });
    expect(screen.getByText(/thanks/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /change/i }));
    expect(screen.getByText(/was this helpful/i)).toBeInTheDocument();
  });

  it('submits negative feedback with an optional comment', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        jsonResponse({ feedback: {} }),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    renderWithProviders(
      <MessageFeedback projectId="design_feedback" messageId="msg_2" />,
    );

    await user.click(screen.getByRole('button', { name: /not helpful/i }));
    await user.type(
      screen.getByPlaceholderText(/optional comment/i),
      'Too vague',
    );
    await user.click(screen.getByRole('button', { name: /^send$/i }));

    await waitFor(() =>
      expect(
        JSON.parse(
          String(
            fetchMock.mock.calls.find(([input]) =>
              String(input).includes('/messages/msg_2/feedback'),
            )?.[1]?.body,
          ),
        ),
      ).toMatchObject({
        rating: 'down',
        comment: 'Too vague',
      }),
    );
  });

  it('scrolls the negative feedback form into view', async () => {
    const user = userEvent.setup();
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    window.matchMedia = vi.fn().mockReturnValue({ matches: true });
    globalThis.fetch = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        jsonResponse({ feedback: {} }),
    ) as typeof fetch;

    renderWithProviders(
      <MessageFeedback projectId="design_feedback" messageId="msg_scroll" />,
    );

    await user.click(screen.getByRole('button', { name: /not helpful/i }));

    await waitFor(() =>
      expect(scrollIntoView).toHaveBeenCalledWith({
        block: 'nearest',
        behavior: 'auto',
      }),
    );
  });
});

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
