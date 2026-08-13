import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentMessage } from '@/core/agent/types';

const mocks = vi.hoisted(() => ({
  run: vi.fn(),
}));

// Stub project + path resolvers so the chat loop runs without an on-disk
// project. The agent is mocked to a run that never yields — simulating a CLI
// wedged in startup (e.g. an MCP server that never finishes `initialize`).
vi.mock('@/shared/services/design-mode/projects', () => ({
  getDesignProject: vi.fn(async () => ({
    id: 'p1',
    surface: 'prototype',
    outputs: [],
  })),
  addProjectOutput: vi.fn(),
}));
vi.mock('@/shared/services/design-mode/fs', () => ({
  getProjectDir: () => '/tmp/design-p1',
}));
vi.mock('node:fs/promises', () => ({
  stat: vi.fn(async () => ({ mtimeMs: 0 })),
}));

async function* hangingRun(): AsyncGenerator<AgentMessage> {
  // Never resolves — the run produces no message at all (a wedged startup).
  await new Promise<void>(() => {});
  yield { type: 'text' };
}

async function* idleAfterFirstMessageRun(): AsyncGenerator<AgentMessage> {
  yield { type: 'text', content: 'Started' };
  await new Promise<void>(() => {});
  yield { type: 'text', content: 'Unreachable' };
}

vi.mock('@/core/agent/registry', () => ({
  createAgentFromConfig: () => ({ run: mocks.run }),
}));

describe('DesignMode chat loop watchdog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.run.mockImplementation(() => hangingRun());
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('aborts and surfaces an error when the run yields nothing within the budget', async () => {
    const { runDesignChat } =
      await import('@/shared/services/design-mode/chat');

    const collected: AgentMessage[] = [];
    const pump = (async () => {
      for await (const m of runDesignChat('p1', {
        prompt: 'build a dashboard',
        provider: 'mock',
      })) {
        collected.push(m);
      }
    })();

    // Advance past the 90s first-token watchdog.
    await vi.advanceTimersByTimeAsync(91_000);
    await pump;

    // The watchdog fired: it surfaced an error + done instead of hanging.
    expect(collected.map((m) => m.type)).toEqual(['error', 'done']);
    expect(collected[0]).toMatchObject({ subtype: 'first_token_timeout' });
  });

  it('aborts and surfaces an error when the run goes idle after output begins', async () => {
    mocks.run.mockImplementation(() => idleAfterFirstMessageRun());
    const { runDesignChat } =
      await import('@/shared/services/design-mode/chat');

    const collected: AgentMessage[] = [];
    const pump = (async () => {
      for await (const m of runDesignChat('p1', {
        prompt: 'build a dashboard',
        provider: 'mock',
      })) {
        collected.push(m);
      }
    })();

    await vi.advanceTimersByTimeAsync(1);
    expect(collected.map((m) => m.type)).toEqual(['text']);

    await vi.advanceTimersByTimeAsync(121_000);
    await pump;

    expect(collected.map((m) => m.type)).toEqual(['text', 'error', 'done']);
    expect(collected[1]).toMatchObject({ subtype: 'idle_timeout' });
  });
});
