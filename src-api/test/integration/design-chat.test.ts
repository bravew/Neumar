import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerBuiltinAgentProviders } from '@/core/agent';
import type { AgentMessage } from '@/core/agent/types';

// Stub the project + path resolvers so the chat loop can run without a real
// on-disk design project. The mock agent provides the AgentMessage stream, so
// no provider tokens are spent.
const projectOutputs: Array<{ path: string; createdAt: string }> = [];
const projectWorkspaceRoot = vi.hoisted(() => '/tmp/design-workspace-root');
const addProjectOutput = vi.fn(async (_id: string, output: unknown) => ({
  id: 'p1',
  surface: 'prototype',
  outputs: [output],
}));
const getProjectDir = vi.hoisted(() => vi.fn(() => '/tmp/design-p1'));
vi.mock('@/shared/services/design-mode/projects', () => ({
  getDesignProject: vi.fn(async () => ({
    id: 'p1',
    surface: 'prototype',
    workspaceRoot: projectWorkspaceRoot,
    outputs: projectOutputs,
  })),
  addProjectOutput: (id: string, output: unknown) =>
    addProjectOutput(id, output),
}));
vi.mock('@/shared/services/design-mode/fs', () => ({
  getProjectDir,
}));
const statMtimeMs = { value: 0 };
vi.mock('node:fs/promises', () => ({
  stat: vi.fn(async () => ({ mtimeMs: statMtimeMs.value })),
}));

async function collect(gen: AsyncGenerator<AgentMessage>) {
  const out: AgentMessage[] = [];
  for await (const m of gen) out.push(m);
  return out;
}

describe('DesignMode chat loop (runDesignChat)', () => {
  beforeAll(() => {
    registerBuiltinAgentProviders();
  });
  beforeEach(() => {
    process.env.NEUMA_MOCK_NO_DELAY = '1';
    getProjectDir.mockClear();
  });

  it('streams the agent transcript for a prototype surface (zero tokens)', async () => {
    const { runDesignChat } =
      await import('@/shared/services/design-mode/chat');
    const msgs = await collect(
      runDesignChat('p1', {
        prompt: 'A simple analytics dashboard',
        provider: 'mock',
        model: 'hello-read-edit', // mock trace selection
      }),
    );
    const types = msgs.map((m) => m.type);
    expect(types[0]).toBe('session');
    expect(types).toContain('tool_use');
    expect(types).toContain('tool_result');
    expect(types.at(-1)).toBe('done');
    expect(getProjectDir).toHaveBeenCalledWith('p1', projectWorkspaceRoot);
  });

  it('harvests the prototype artifact only when it is newer than the last output', async () => {
    const { harvestDesignChatArtifact } =
      await import('@/shared/services/design-mode/chat');

    // Existing output recorded "now"; an unchanged file (older mtime) is a no-op.
    projectOutputs.length = 0;
    projectOutputs.push({
      path: 'index.html',
      createdAt: new Date(10_000).toISOString(),
    });
    statMtimeMs.value = 5_000;
    addProjectOutput.mockClear();
    expect(await harvestDesignChatArtifact('p1', 'claude')).toBeNull();
    expect(addProjectOutput).not.toHaveBeenCalled();
    expect(getProjectDir).toHaveBeenLastCalledWith('p1', projectWorkspaceRoot);

    // A freshly written file (newer mtime) registers a new output.
    statMtimeMs.value = 60_000;
    const updated = await harvestDesignChatArtifact('p1', 'claude');
    expect(getProjectDir).toHaveBeenLastCalledWith('p1', projectWorkspaceRoot);
    expect(addProjectOutput).toHaveBeenCalledTimes(1);
    expect(updated?.outputs?.[0]).toMatchObject({
      path: 'index.html',
      kind: 'prototype',
      mime: 'text/html',
      provider: 'claude',
    });
  });

  it('exposes isChatSurface routing (agentic vs media surfaces)', async () => {
    const { isChatSurface } =
      await import('@/shared/services/design-mode/chat');
    expect(isChatSurface('prototype')).toBe(true);
    expect(isChatSurface('deck')).toBe(true);
    expect(isChatSurface('document')).toBe(true);
    expect(isChatSurface('image')).toBe(false);
    expect(isChatSurface('video')).toBe(false);
    expect(isChatSurface('audio')).toBe(false);
  });
});
