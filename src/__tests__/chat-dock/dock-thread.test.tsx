import type { MutableRefObject, ReactNode } from 'react';

import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DockThread,
  resetDockFirstSendForTests,
} from '@/components/chat-dock/DockThread';

const runtime = vi.hoisted(() => ({
  status: 'connecting',
  submit: vi.fn(),
}));

vi.mock('@copilotkit/react-core/v2', () => ({
  useCopilotKit: () => ({
    copilotkit: { runtimeConnectionStatus: runtime.status },
  }),
}));

vi.mock('@/shared/providers/agui-provider', () => ({
  AgUiProvider: ({ children }: { children: ReactNode }) => children,
}));

vi.mock('@/components/task/TaskV2Thread', () => ({
  TaskV2Thread: ({
    onSubmitRef,
  }: {
    onSubmitRef: MutableRefObject<((text: string) => void) | null>;
  }) => {
    onSubmitRef.current = runtime.submit;
    return null;
  },
}));

vi.mock('@/shared/db', () => ({
  getMessagesByTaskId: async () => [],
  getTask: async () => null,
}));

vi.mock('@/shared/hooks/useTaskModelSelector', () => ({
  useTaskModelSelector: () => ['', () => {}],
}));

describe('DockThread', () => {
  beforeEach(() => {
    resetDockFirstSendForTests();
    runtime.status = 'connecting';
    runtime.submit.mockClear();
  });

  it('sends the first prompt once, after the runtime connects', () => {
    const { rerender, unmount } = render(
      <DockThread taskId="t1" firstPrompt="hello" />,
    );
    expect(runtime.submit).not.toHaveBeenCalled();

    runtime.status = 'connected';
    rerender(<DockThread taskId="t1" firstPrompt="hello" />);
    expect(runtime.submit).toHaveBeenCalledExactlyOnceWith('hello');

    // A remount (StrictMode, keyed provider) must not send it again.
    unmount();
    render(<DockThread taskId="t1" firstPrompt="hello" />);
    expect(runtime.submit).toHaveBeenCalledTimes(1);
  });

  it('does not send for an existing session', () => {
    runtime.status = 'connected';
    render(<DockThread taskId="t2" />);
    expect(runtime.submit).not.toHaveBeenCalled();
  });
});
