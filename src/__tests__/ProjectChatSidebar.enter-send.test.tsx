import { useState } from 'react';

import { act, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProjectChatSidebar } from '@/components/design/ProjectChatSidebar';
import { isImeCompositionKeyEvent } from '@/components/shared/chat-input-keyboard';
import type { DesignProject } from '@/shared/types/design-mode';

import { renderWithProviders } from './helpers/render-with-providers';

describe('ProjectChatSidebar enter send behavior', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends on Enter', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    renderSidebar(onSend);

    await user.type(
      screen.getByPlaceholderText('Describe the design you want...'),
      'Make a poster',
    );
    await user.keyboard('{Enter}');

    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('keeps Shift+Enter as a newline', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    renderSidebar(onSend);

    const textarea = screen.getByPlaceholderText(
      'Describe the design you want...',
    );
    await user.type(textarea, 'Line one');
    await user.keyboard('{Shift>}{Enter}{/Shift}');
    await user.type(textarea, 'Line two');

    expect(onSend).not.toHaveBeenCalled();
    expect(textarea).toHaveValue('Line one\nLine two');
  });

  it('does not send while IME composition is active', () => {
    vi.useFakeTimers();
    const onSend = vi.fn();
    renderSidebar(onSend);

    const textarea = screen.getByPlaceholderText(
      'Describe the design you want...',
    );
    fireEvent.compositionStart(textarea);
    fireEvent.change(textarea, { target: { value: '正在输入' } });
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter' });

    expect(onSend).not.toHaveBeenCalled();

    fireEvent.compositionEnd(textarea);
    act(() => {
      vi.advanceTimersByTime(11);
    });
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter' });

    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('detects Safari IME Enter keyCode 229', () => {
    expect(isImeCompositionKeyEvent({ keyCode: 229 })).toBe(true);
    expect(isImeCompositionKeyEvent({ which: 229 })).toBe(true);
    expect(isImeCompositionKeyEvent({ nativeEvent: { keyCode: 229 } })).toBe(
      true,
    );
    expect(isImeCompositionKeyEvent({ nativeEvent: { which: 229 } })).toBe(
      true,
    );
    expect(
      isImeCompositionKeyEvent({ nativeEvent: { isComposing: true } }),
    ).toBe(true);
    expect(
      isImeCompositionKeyEvent({
        keyCode: 13,
        nativeEvent: { keyCode: 13 },
      }),
    ).toBe(false);
  });
});

function renderSidebar(onSend: () => void) {
  function Harness() {
    const [message, setMessage] = useState('');
    return (
      <ProjectChatSidebar
        activeTaskId={null}
        chatPanelWidth={360}
        juryError={null}
        juryRun={null}
        message={message}
        project={projectFixture}
        queuedSends={[]}
        sendError={null}
        sending={false}
        tasks={[]}
        onBriefSubmit={vi.fn()}
        onCancelActiveTask={vi.fn()}
        onEditQueuedSend={vi.fn()}
        onMessageChange={setMessage}
        onRemoveQueuedSend={vi.fn()}
        onSampleSelected={vi.fn()}
        onSend={onSend}
        onSendQueuedNow={vi.fn()}
        onAnswerQuestion={vi.fn()}
        onWidthChange={vi.fn()}
      />
    );
  }

  renderWithProviders(<Harness />);
}

const projectFixture = {
  id: 'design_enter_send',
  title: 'Enter send',
  surface: 'prototype',
  status: 'draft',
  skillId: null,
  designSystemId: null,
  inspirationDesignSystemIds: [],
  craftRefs: [],
  brief: {},
  outputs: [],
  createdAt: '2026-05-25T00:00:00.000Z',
  updatedAt: '2026-05-25T00:00:00.000Z',
} satisfies DesignProject;
