import { describe, expect, it, vi } from 'vitest';

import type { Message } from '@/shared/db/types';

vi.mock('@/shared/services/usage-logger', () => ({
  logUsage: vi.fn(),
}));

const { resolveApiCredentialsMock, anthropicCreateMock } = vi.hoisted(() => ({
  resolveApiCredentialsMock: vi.fn(() => ({}) as Record<string, string>),
  anthropicCreateMock: vi.fn(),
}));

vi.mock('@/shared/utils/provider-resolution', async () => {
  const actual = await vi.importActual<
    typeof import('@/shared/utils/provider-resolution')
  >('@/shared/utils/provider-resolution');
  return {
    ...actual,
    resolveApiCredentials: resolveApiCredentialsMock,
  };
});

vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { create: anthropicCreateMock };
  },
}));

import { extractSkillContent } from '@/shared/services/skill-extractor';

function makeMessage(overrides: Partial<Message>): Message {
  return {
    id: 1,
    task_id: 'task-1',
    type: 'user',
    content: null,
    tool_name: null,
    tool_input: null,
    tool_output: null,
    tool_use_id: null,
    subtype: null,
    error_message: null,
    attachments: null,
    is_error: 0,
    message_id: null,
    cost: null,
    usage_input: null,
    usage_output: null,
    usage_cache_read: null,
    usage_cache_creation: null,
    model: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('extractSkillContent abort signal', () => {
  it('forwards an already-aborted caller signal to the Anthropic SDK call', async () => {
    resolveApiCredentialsMock.mockReturnValueOnce({ apiKey: 'test-key' });
    anthropicCreateMock.mockReset();
    anthropicCreateMock.mockImplementation(
      (_params: unknown, opts?: { signal?: AbortSignal }) => {
        if (opts?.signal?.aborted) {
          return Promise.reject(new Error('The operation was aborted'));
        }
        return Promise.resolve({
          content: [{ type: 'text', text: 'Ignored skill content' }],
          usage: {},
        });
      },
    );

    const controller = new AbortController();
    controller.abort();

    const messages: Message[] = [
      makeMessage({ type: 'user', content: 'Build a todo app' }),
    ];

    const content = await extractSkillContent(
      'Build a todo app',
      messages,
      'todo-app-builder',
      undefined,
      controller.signal,
    );

    expect(anthropicCreateMock).toHaveBeenCalledTimes(1);
    const [, opts] = anthropicCreateMock.mock.calls[0] as [
      unknown,
      { signal: AbortSignal },
    ];
    // The combined signal (caller signal `AbortSignal.any`-ed with the
    // internal timeout) must reflect the already-aborted caller signal.
    expect(opts.signal.aborted).toBe(true);
    // The aborted Anthropic call falls through to the template fallback.
    expect(content).toContain('name: todo-app-builder');
    expect(content).toContain(
      'This skill was auto-extracted from a task session without AI refinement',
    );
  });
});
