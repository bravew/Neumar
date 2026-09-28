import type { Options } from '@anthropic-ai/claude-agent-sdk';
import { query } from '@anthropic-ai/claude-agent-sdk/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DenialTracker } from '@/core/agent/denial-tracker';
import { LoopGuard } from '@/core/agent/loop-guard';
import { ToolPermissionRegistry } from '@/core/agent/tool-permission-registry';

const { publish } = vi.hoisted(() => ({ publish: vi.fn() }));

vi.mock('@/shared/db/operations', () => ({
  getSetting: vi.fn(() => undefined),
}));
vi.mock('@/shared/services/task-event-bus', () => ({
  taskEventBus: { publish },
}));

const {
  applyPermissionPolicy,
  buildCanUseTool,
  HEADLESS_DENY_MESSAGE,
  isHeadlessRun,
} = await import('@/extensions/agent/claude/permissions');
type PendingPermission =
  import('@/extensions/agent/claude/permissions').PendingPermission;

const ALLOWED_TOOLS = [
  'Read',
  'Edit',
  'Write',
  'Glob',
  'Grep',
  'Bash',
  'WebSearch',
  'WebFetch',
  'Skill',
  'Task',
  'LSP',
  'TodoWrite',
  'mcp__schedule__*',
];

function baseOptions(
  registry: ToolPermissionRegistry,
  taskId: string | undefined,
  pending = new Map<string, PendingPermission>(),
): Options {
  return {
    cwd: '/work/session-1',
    additionalDirectories: ['/work/shared'],
    allowedTools: [...ALLOWED_TOOLS],
    permissionMode: 'default',
    canUseTool: buildCanUseTool(
      new DenialTracker(),
      registry,
      pending,
      taskId,
      'session-1',
      new LoopGuard(),
    ),
  };
}

function callOptions(overrides: Record<string, unknown> = {}) {
  return {
    signal: new AbortController().signal,
    toolUseID: 'tool-1',
    requestId: 'req-1',
    ...overrides,
  };
}

/** Construct an SDK query without spawning the CLI; collect warning codes. */
async function sdkWarningsFor(options: Options): Promise<string[]> {
  const codes: string[] = [];
  const onWarning = (warning: Error & { code?: string }) => {
    if (warning.code) codes.push(warning.code);
  };
  process.on('warning', onWarning);
  const abortController = new AbortController();
  try {
    const q = query({
      prompt: 'noop',
      options: {
        ...options,
        abortController,
        pathToClaudeCodeExecutable: '/nonexistent/claude',
      },
    });
    abortController.abort();
    await q.next().catch(() => undefined);
    // process.emitWarning dispatches on the next tick.
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    process.off('warning', onWarning);
  }
  return codes;
}

describe('Claude permission policy', () => {
  beforeEach(() => {
    publish.mockClear();
  });

  it('treats a run without a task or auto-approve as headless', () => {
    expect(isHeadlessRun({ taskId: undefined, autoApprove: undefined })).toBe(
      true,
    );
    expect(isHeadlessRun({ taskId: 't1', autoApprove: undefined })).toBe(false);
    expect(isHeadlessRun({ taskId: undefined, autoApprove: true })).toBe(false);
  });

  describe('headless runs', () => {
    it('denies prompts through the SDK and drops the unused callback', () => {
      const registry = new ToolPermissionRegistry();
      const options = applyPermissionPolicy(baseOptions(registry, undefined), {
        registry,
        taskId: undefined,
        autoApprove: undefined,
      });

      expect(options.permissionPrompts).toBe('none');
      expect(options.canUseTool).toBeUndefined();
    });

    it('keeps explicit allow rules and scopes Edit/Write to the workspace', () => {
      const registry = new ToolPermissionRegistry();
      const options = applyPermissionPolicy(baseOptions(registry, undefined), {
        registry,
        taskId: undefined,
        autoApprove: undefined,
      });

      expect(options.allowedTools).toEqual(
        expect.arrayContaining([
          'Read',
          'Bash',
          'mcp__schedule__*',
          'Edit(//work/session-1/**)',
          'Edit(//work/shared/**)',
        ]),
      );
      // Edit path rules cover Write; each directory appears once.
      expect(
        options.allowedTools?.filter((rule) => rule.startsWith('Edit(')),
      ).toHaveLength(2);
      expect(options.allowedTools).not.toContain('Edit');
      expect(options.allowedTools).not.toContain('Write');
    });

    it('checks Bash danger and registry deny rules in a PreToolUse hook', async () => {
      const registry = new ToolPermissionRegistry({
        alwaysAllow: [],
        alwaysDeny: ['WebFetch'],
        alwaysAsk: [],
      });
      const options = applyPermissionPolicy(baseOptions(registry, undefined), {
        registry,
        taskId: undefined,
        autoApprove: undefined,
      });
      const hook = options.hooks?.PreToolUse?.[0]?.hooks[0];
      expect(hook).toBeTypeOf('function');

      const signal = new AbortController().signal;
      const call = (toolName: string, toolInput: unknown) =>
        hook!(
          {
            hook_event_name: 'PreToolUse',
            session_id: 'session-1',
            transcript_path: '/tmp/transcript',
            cwd: '/work/session-1',
            tool_name: toolName,
            tool_input: toolInput,
            tool_use_id: 'tool-1',
          },
          'tool-1',
          { signal },
        );

      await expect(
        call('Bash', { command: 'rm -rf /' }),
      ).resolves.toMatchObject({
        continue: true,
        hookSpecificOutput: { permissionDecision: 'deny' },
      });
      await expect(
        call('WebFetch', { url: 'https://example.com' }),
      ).resolves.toMatchObject({
        hookSpecificOutput: { permissionDecision: 'deny' },
      });
      await expect(call('Bash', { command: 'ls' })).resolves.toEqual({
        continue: true,
      });
      await expect(
        call('mcp__schedule__create', { name: 'x' }),
      ).resolves.toEqual({ continue: true });
    });

    it('denies an alwaysAsk tool when the headless run cannot prompt', async () => {
      const registry = new ToolPermissionRegistry({
        alwaysAllow: [],
        alwaysDeny: [],
        alwaysAsk: ['WebFetch'],
      });
      const options = applyPermissionPolicy(baseOptions(registry, undefined), {
        registry,
        taskId: undefined,
        autoApprove: undefined,
      });
      const hook = options.hooks?.PreToolUse?.[0]?.hooks[0];
      const signal = new AbortController().signal;
      const call = (toolName: string, toolInput: unknown) =>
        hook!(
          {
            hook_event_name: 'PreToolUse',
            session_id: 'session-1',
            transcript_path: '/tmp/transcript',
            cwd: '/work/session-1',
            tool_name: toolName,
            tool_input: toolInput,
            tool_use_id: 'tool-1',
          },
          'tool-1',
          { signal },
        );

      await expect(
        call('WebFetch', { url: 'https://example.com' }),
      ).resolves.toMatchObject({
        continue: true,
        hookSpecificOutput: { permissionDecision: 'deny' },
      });
      // Bash is classified as execute, which asks in the interactive path.
      // A bare headless allow-list is that approval, so a safe command stays.
      await expect(call('Bash', { command: 'ls' })).resolves.toEqual({
        continue: true,
      });
    });

    it('denies an ask from the callback when no approver exists', async () => {
      // The PTC loop calls the callback directly, without SDK rules.
      const registry = new ToolPermissionRegistry();
      const pending = new Map<string, PendingPermission>();
      const canUseTool = buildCanUseTool(
        new DenialTracker(),
        registry,
        pending,
        undefined,
        'session-1',
        new LoopGuard(),
      );

      const result = await canUseTool('Bash', { command: 'ls' }, callOptions());

      expect(result).toEqual({
        behavior: 'deny',
        message: HEADLESS_DENY_MESSAGE,
      });
      expect(pending.size).toBe(0);
      expect(publish).not.toHaveBeenCalled();
    });

    it('still allows tools the registry allows without asking', async () => {
      const canUseTool = buildCanUseTool(
        new DenialTracker(),
        new ToolPermissionRegistry(),
        new Map(),
        undefined,
        'session-1',
        new LoopGuard(),
      );

      await expect(
        canUseTool('Read', { file_path: '/work/a.txt' }, callOptions()),
      ).resolves.toEqual({
        behavior: 'allow',
        updatedInput: { file_path: '/work/a.txt' },
      });
    });
  });

  describe('host-approved runs', () => {
    it('moves bare allow rules behind canUseTool', async () => {
      const registry = new ToolPermissionRegistry();
      const options = applyPermissionPolicy(baseOptions(registry, 'task-1'), {
        registry,
        taskId: 'task-1',
        autoApprove: undefined,
      });

      expect(options.allowedTools).toEqual([]);
      expect(options.permissionPrompts).toBeUndefined();
      expect(options.canUseTool).toBeDefined();

      // Bash is classified 'execute' (ask), but the run pre-approved it.
      await expect(
        options.canUseTool!('Bash', { command: 'ls' }, callOptions()),
      ).resolves.toMatchObject({ behavior: 'allow' });
      await expect(
        options.canUseTool!(
          'mcp__schedule__create',
          { name: 'x' },
          callOptions(),
        ),
      ).resolves.toMatchObject({ behavior: 'allow' });
      expect(publish).not.toHaveBeenCalled();
    });

    it('applies registry deny rules and the Bash danger check to pre-approved tools', async () => {
      const registry = new ToolPermissionRegistry({
        alwaysAllow: [],
        alwaysDeny: ['WebFetch'],
        alwaysAsk: [],
      });
      const options = applyPermissionPolicy(baseOptions(registry, 'task-1'), {
        registry,
        taskId: 'task-1',
        autoApprove: undefined,
      });

      await expect(
        options.canUseTool!(
          'WebFetch',
          { url: 'https://example.com' },
          callOptions(),
        ),
      ).resolves.toMatchObject({ behavior: 'deny' });
      await expect(
        options.canUseTool!('Bash', { command: 'rm -rf /' }, callOptions()),
      ).resolves.toMatchObject({ behavior: 'deny' });
    });

    it('forwards defaultToNo, suppressAlwaysAllowRule and the MCP server source', async () => {
      const registry = new ToolPermissionRegistry();
      registry.setClassification('mcp__github__delete_repo', 'destructive');
      const pending = new Map<string, PendingPermission>();
      const abortController = new AbortController();
      const canUseTool = buildCanUseTool(
        new DenialTracker(),
        registry,
        pending,
        'task-1',
        'session-1',
        new LoopGuard(),
      );

      const decision = canUseTool(
        'mcp__github__delete_repo',
        { repo: 'x' },
        callOptions({
          signal: abortController.signal,
          suppressAlwaysAllowRule: true,
          mcpServer: { name: 'github', source: 'user' },
        }),
      );

      expect(publish).toHaveBeenCalledWith(
        'task-1',
        expect.objectContaining({
          type: 'permission_request',
          permission: expect.objectContaining({
            tool: 'mcp__github__delete_repo',
            // A configured (non-sdk) server always opens on "deny".
            default_to_no: true,
            suppress_always_allow_rule: true,
            mcp_server: { name: 'github', source: 'user' },
          }),
        }),
      );
      const [entry] = [...pending.values()];
      expect(entry?.suppressAlwaysAllowRule).toBe(true);

      abortController.abort();
      await expect(decision).resolves.toMatchObject({ behavior: 'deny' });
    });

    it('does not force defaultToNo for in-process sdk servers', async () => {
      const registry = new ToolPermissionRegistry();
      registry.setClassification('mcp__assets__delete', 'destructive');
      const abortController = new AbortController();
      const canUseTool = buildCanUseTool(
        new DenialTracker(),
        registry,
        new Map(),
        'task-1',
        'session-1',
        new LoopGuard(),
      );

      const decision = canUseTool(
        'mcp__assets__delete',
        { id: 'a' },
        callOptions({
          signal: abortController.signal,
          mcpServer: { name: 'assets', source: 'sdk' },
        }),
      );

      const permission = publish.mock.calls[0]?.[1]?.permission;
      expect(permission).toMatchObject({
        mcp_server: { name: 'assets', source: 'sdk' },
      });
      expect(permission).not.toHaveProperty('default_to_no');
      abortController.abort();
      await decision;
    });
  });

  describe('CLAUDE_SDK_CAN_USE_TOOL_SHADOWED', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('fires for the unfinalized options (guards the detector)', async () => {
      const registry = new ToolPermissionRegistry();
      const codes = await sdkWarningsFor(baseOptions(registry, 'task-1'));
      expect(codes).toContain('CLAUDE_SDK_CAN_USE_TOOL_SHADOWED');
    });

    it.each([
      ['a task run', 'task-1', undefined],
      ['an auto-approved run', undefined, true],
      ['a headless run', undefined, undefined],
    ] as const)('does not fire for %s', async (_label, taskId, autoApprove) => {
      const registry = new ToolPermissionRegistry();
      const options = applyPermissionPolicy(baseOptions(registry, taskId), {
        registry,
        taskId,
        autoApprove,
      });
      const codes = await sdkWarningsFor(options);
      expect(codes).not.toContain('CLAUDE_SDK_CAN_USE_TOOL_SHADOWED');
    });
  });
});
