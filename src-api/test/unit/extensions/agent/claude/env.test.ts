import { describe, expect, it } from 'vitest';

import {
  claudeStreamTextDedupeKey,
  composeClaudePromptWithResumeCache,
  normalizeInheritedAnthropicEnvForClaudeLogin,
  registerInProcessMcpServers,
} from '@/extensions/agent/claude';

describe('Claude env normalization', () => {
  it('strips inherited ANTHROPIC_API_KEY when no custom base URL is set', () => {
    const env: Record<string, string | undefined> = {
      ANTHROPIC_API_KEY: 'sk-parent',
    };

    normalizeInheritedAnthropicEnvForClaudeLogin(env);

    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.ANTHROPIC_BASE_URL).toBeUndefined();
  });

  it('treats whitespace ANTHROPIC_BASE_URL as absent', () => {
    const env: Record<string, string | undefined> = {
      ANTHROPIC_API_KEY: 'sk-parent',
      ANTHROPIC_BASE_URL: '   ',
    };

    normalizeInheritedAnthropicEnvForClaudeLogin(env);

    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.ANTHROPIC_BASE_URL).toBeUndefined();
  });

  it('preserves ANTHROPIC_API_KEY when a custom base URL is set', () => {
    const env: Record<string, string | undefined> = {
      ANTHROPIC_API_KEY: 'sk-proxy',
      ANTHROPIC_BASE_URL: '  https://moonshot.example/v1  ',
    };

    normalizeInheritedAnthropicEnvForClaudeLogin(env);

    expect(env.ANTHROPIC_API_KEY).toBe('sk-proxy');
    expect(env.ANTHROPIC_BASE_URL).toBe('https://moonshot.example/v1');
  });

  it('mounts in-process MCP servers with wildcard tool patterns', () => {
    const mcpServers: Record<string, unknown> = {};

    const patterns = registerInProcessMcpServers(mcpServers, {
      'video-edit': { type: 'stdio', command: 'node' },
    });

    expect(patterns).toEqual(['mcp__video-edit__*']);
    expect(mcpServers['video-edit']).toEqual({
      type: 'stdio',
      command: 'node',
    });
  });

  it('returns no patterns and no mutation when servers map is empty', () => {
    const mcpServers: Record<string, unknown> = {};

    expect(registerInProcessMcpServers(mcpServers, undefined)).toEqual([]);
    expect(registerInProcessMcpServers(mcpServers, {})).toEqual([]);
    expect(Object.keys(mcpServers)).toEqual([]);
  });

  it('mounts multiple in-process servers with one pattern each', () => {
    const mcpServers: Record<string, unknown> = {};

    const patterns = registerInProcessMcpServers(mcpServers, {
      'video-edit': { type: 'stdio', command: 'node' },
      media: { type: 'stdio', command: 'node' },
      ffmpeg: { type: 'stdio', command: 'node' },
    });

    expect(patterns).toEqual([
      'mcp__video-edit__*',
      'mcp__media__*',
      'mcp__ffmpeg__*',
    ]);
    expect(Object.keys(mcpServers).sort()).toEqual([
      'ffmpeg',
      'media',
      'video-edit',
    ]);
  });

  it('dedupes Claude text wrappers by full content hash', () => {
    const prefix = 'x'.repeat(140);

    expect(claudeStreamTextDedupeKey(`${prefix}A`)).toBe(
      claudeStreamTextDedupeKey(`${prefix}A`),
    );
    expect(claudeStreamTextDedupeKey(`${prefix}A`)).not.toBe(
      claudeStreamTextDedupeKey(`${prefix}B`),
    );
  });

  it('seeds resume instruction cache without changing first-turn prompt order', () => {
    const instructionBlockHashes = new Map<string, string>();

    const result = composeClaudePromptWithResumeCache({
      prompt: 'Build the page',
      prefixInstructionBlock: '<workspace />',
      perTurnInstructionBlock: '<runtime />',
      suffixInstructionBlock: '<mcp />',
      sessionId: 'sdk-session-1',
      instructionBlockHashes,
      allowResumeSkip: true,
    });

    expect(result.prompt).toBe('<workspace /><runtime />Build the page<mcp />');
    expect(result.skippedInstructionBlock).toBe(false);
    expect(instructionBlockHashes.get('sdk-session-1')).toBe(
      result.instructionBlockHash,
    );
  });

  it('skips unchanged Claude instruction blocks on SDK resume', () => {
    const instructionBlockHashes = new Map<string, string>();
    composeClaudePromptWithResumeCache({
      prompt: 'Initial turn',
      prefixInstructionBlock: '<workspace />',
      perTurnInstructionBlock: '<runtime old />',
      suffixInstructionBlock: '<mcp />',
      sessionId: 'sdk-session-2',
      instructionBlockHashes,
      allowResumeSkip: true,
    });

    const result = composeClaudePromptWithResumeCache({
      prompt: 'Next turn',
      prefixInstructionBlock: '<workspace />',
      perTurnInstructionBlock: '<runtime new />',
      suffixInstructionBlock: '<mcp />',
      resumeSessionId: 'sdk-session-2',
      instructionBlockHashes,
      allowResumeSkip: true,
    });

    expect(result.prompt).toBe('<runtime new />Next turn');
    expect(result.skippedInstructionBlock).toBe(true);
    expect(result.skippedInstructionBlockChars).toBe(
      '<workspace /><mcp />'.length,
    );
  });

  it('sends the full instruction block when a resumed block changed', () => {
    const instructionBlockHashes = new Map<string, string>();
    composeClaudePromptWithResumeCache({
      prompt: 'Initial turn',
      prefixInstructionBlock: '<workspace />',
      suffixInstructionBlock: '<mcp old />',
      sessionId: 'sdk-session-3',
      instructionBlockHashes,
      allowResumeSkip: true,
    });

    const result = composeClaudePromptWithResumeCache({
      prompt: 'Next turn',
      prefixInstructionBlock: '<workspace />',
      suffixInstructionBlock: '<mcp new />',
      resumeSessionId: 'sdk-session-3',
      instructionBlockHashes,
      allowResumeSkip: true,
    });

    expect(result.prompt).toBe('<workspace />Next turn<mcp new />');
    expect(result.skippedInstructionBlock).toBe(false);
  });

  it('does not seed or skip when resume instruction caching is disabled', () => {
    const instructionBlockHashes = new Map<string, string>();

    const initial = composeClaudePromptWithResumeCache({
      prompt: 'Initial turn',
      prefixInstructionBlock: '<workspace />',
      suffixInstructionBlock: '<mcp />',
      sessionId: 'sdk-session-disabled',
      instructionBlockHashes,
      allowResumeSkip: false,
    });
    const resumed = composeClaudePromptWithResumeCache({
      prompt: 'Next turn',
      prefixInstructionBlock: '<workspace />',
      suffixInstructionBlock: '<mcp />',
      resumeSessionId: 'sdk-session-disabled',
      instructionBlockHashes,
      allowResumeSkip: false,
    });

    expect(initial.skippedInstructionBlock).toBe(false);
    expect(resumed.prompt).toBe('<workspace />Next turn<mcp />');
    expect(resumed.skippedInstructionBlock).toBe(false);
    expect(instructionBlockHashes.size).toBe(0);
  });

  it('preserves image prompt ordering while skipping unchanged resume blocks', () => {
    const instructionBlockHashes = new Map<string, string>();
    composeClaudePromptWithResumeCache({
      prompt: 'Initial image turn',
      imageInstruction: '<image>',
      prefixInstructionBlock: '<workspace />',
      perTurnInstructionBlock: '<runtime old />',
      suffixInstructionBlock: '<mcp />',
      sessionId: 'sdk-session-4',
      instructionBlockHashes,
      allowResumeSkip: true,
    });

    const result = composeClaudePromptWithResumeCache({
      prompt: 'Next image turn',
      imageInstruction: '<image>',
      prefixInstructionBlock: '<workspace />',
      perTurnInstructionBlock: '<runtime new />',
      suffixInstructionBlock: '<mcp />',
      resumeSessionId: 'sdk-session-4',
      instructionBlockHashes,
      allowResumeSkip: true,
    });

    expect(result.prompt).toBe('<image>Next image turn\n\n<runtime new />');
    expect(result.skippedInstructionBlock).toBe(true);
  });
});
