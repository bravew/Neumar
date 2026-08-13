import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentMessage } from '@/core/agent/types';

// Capture the prompt runDesignChat composes by faking the agent.
let capturedPrompt = '';
let capturedConversationLen = 0;
vi.mock('@/core/agent/registry', () => ({
  createAgentFromConfig: () => ({
    // eslint-disable-next-line require-yield
    run: async function* run(
      prompt: string,
      opts?: { conversation?: unknown[] },
    ): AsyncGenerator<AgentMessage> {
      capturedPrompt = prompt;
      capturedConversationLen = opts?.conversation?.length ?? 0;
    },
  }),
}));
vi.mock('@/shared/services/design-mode/projects', () => ({
  getDesignProject: vi.fn(async () => ({
    id: 'p1',
    surface: 'prototype',
    designSystemId: null,
    inspirationDesignSystemIds: [],
  })),
  addProjectOutput: vi.fn(),
}));
vi.mock('@/shared/services/design-mode/fs', () => ({
  getProjectDir: () => '/tmp/design-p1',
}));
// Control whether the target artifact "exists".
let artifactExists = false;
vi.mock('node:fs/promises', () => ({
  stat: vi.fn(async () => {
    if (!artifactExists) throw new Error('ENOENT');
    return { mtimeMs: 1 };
  }),
}));

async function drain(projectId: string, opts: Record<string, unknown>) {
  const { runDesignChat } = await import('@/shared/services/design-mode/chat');
  capturedPrompt = '';
  capturedConversationLen = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for await (const _ of runDesignChat(projectId, opts as any)) void _;
}

describe('DesignMode discovery gate (runDesignChat)', () => {
  beforeEach(() => {
    artifactExists = false;
    delete process.env.NEUMA_ON_DEMAND_CLARIFICATION_ENABLED;
  });

  it('asks discovery questions on turn 1 of a fresh project', async () => {
    await drain('p1', { prompt: 'A pricing page', messages: [] });
    expect(capturedPrompt).toContain('neuma:ask_user_question');
    expect(capturedPrompt.toLowerCase()).toContain('too ambiguous');
    // Must not also tell it to build this turn.
    expect(capturedPrompt).not.toContain('single, self-contained `index.html`');
  });

  it('starts building immediately when the first-turn brief is complete', async () => {
    await drain('p1', {
      prompt:
        'Create a bold landing page for freelance designers with hero, feature, pricing, and call-to-action sections.',
      messages: [],
    });
    expect(capturedPrompt).not.toContain('neuma:ask_user_question');
    expect(capturedPrompt).toContain('index.html');
  });

  it('restores mandatory first-turn discovery when the rollout flag is off', async () => {
    process.env.NEUMA_ON_DEMAND_CLARIFICATION_ENABLED = 'false';
    await drain('p1', {
      prompt:
        'Create a bold landing page for freelance designers with hero, feature, pricing, and call-to-action sections.',
      messages: [],
    });
    expect(capturedPrompt).toContain('neuma:ask_user_question');
  });

  it('builds (no discovery) once history exists', async () => {
    await drain('p1', {
      prompt: 'Answers: …',
      messages: [
        { role: 'user', content: 'A pricing page' },
        { role: 'assistant', content: 'questions…' },
      ],
    });
    expect(capturedPrompt).not.toContain('neuma:ask_user_question');
    expect(capturedPrompt).toContain('index.html');
    expect(capturedConversationLen).toBe(2);
  });

  it('never asks discovery when the artifact already exists', async () => {
    artifactExists = true;
    await drain('p1', { prompt: 'Tweak the hero', messages: [] });
    expect(capturedPrompt).not.toContain('neuma:ask_user_question');
    expect(capturedPrompt).toContain('read it first');
  });
});
