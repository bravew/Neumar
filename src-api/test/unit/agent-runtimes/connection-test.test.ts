import { describe, expect, it } from 'vitest';

import { buildRuntimeConnectionTestResult } from '@/shared/agent-runtimes';
import type { AgentRuntimeStatus } from '@/shared/agent-runtimes';

function runtime(
  overrides: Partial<AgentRuntimeStatus> = {},
): AgentRuntimeStatus {
  return {
    id: 'codex',
    name: 'Codex',
    bin: 'codex',
    available: true,
    models: [{ id: 'default', label: 'Default' }],
    streamFormat: 'plain',
    capabilities: {
      execution: true,
      structuredStream: false,
      acp: false,
      rpc: false,
    },
    ...overrides,
  };
}

function recoveryOption(
  overrides: Partial<NonNullable<AgentRuntimeStatus['install']>[number]> = {},
): NonNullable<AgentRuntimeStatus['install']>[number] {
  return {
    id: 'npm-latest',
    label: 'Install with npm',
    command: 'npm',
    args: ['install', '-g', '@openai/codex@latest'],
    platforms: [process.platform],
    network: true,
    inAppRunnable: true,
    commandHash: 'a'.repeat(64),
    rendered: 'npm install -g @openai/codex@latest',
    ...overrides,
  };
}

describe('agent runtime connection tests', () => {
  it('fails when the runtime binary is missing', () => {
    const result = buildRuntimeConnectionTestResult(
      runtime({ available: false, install: [recoveryOption()] }),
    );

    expect(result).toMatchObject({
      ok: false,
      status: 'not_installed',
      recoveryActions: [
        {
          intent: 'install',
          optionId: 'npm-latest',
          commandHash: 'a'.repeat(64),
          rendered: 'npm install -g @openai/codex@latest',
        },
      ],
    });
    expect(result.message).toContain('Suggested action: Install with npm.');
  });

  it('fails when the auth probe reports unauthenticated', () => {
    const result = buildRuntimeConnectionTestResult(
      runtime({
        auth: { state: 'unauthenticated', detail: 'Run codex login first.' },
      }),
    );

    expect(result).toMatchObject({
      ok: false,
      status: 'auth_required',
      recoveryActions: [{ intent: 'authenticate' }],
    });
    expect(result.message).toContain('Run codex login first.');
    expect(result.message).toContain(
      'Suggested action: Run codex login first.',
    );
  });

  it('passes installed runtimes with unknown auth as a warning status', () => {
    const result = buildRuntimeConnectionTestResult(
      runtime({ auth: { state: 'unknown' } }),
    );

    expect(result).toMatchObject({
      ok: true,
      status: 'unknown',
    });
  });

  it('passes installed authenticated runtimes', () => {
    const result = buildRuntimeConnectionTestResult(
      runtime({ auth: { state: 'authenticated' } }),
    );

    expect(result).toMatchObject({
      ok: true,
      status: 'ok',
    });
  });

  it('includes warning diagnostics in the test message', () => {
    const result = buildRuntimeConnectionTestResult(
      runtime({
        update: [recoveryOption({ id: 'npm-reinstall', label: 'Reinstall' })],
        diagnostics: [
          {
            level: 'warn',
            message:
              'Configured executable not found: /missing/codex. Using PATH executable: /usr/local/bin/codex',
          },
        ],
      }),
    );

    expect(result).toMatchObject({
      ok: true,
      status: 'ok',
      recoveryActions: [
        { intent: 'update', optionId: 'npm-reinstall' },
        { intent: 'inspect_diagnostics' },
      ],
    });
    expect(result.message).toContain('Using PATH executable');
    expect(result.message).toContain('Suggested action: Reinstall.');
  });

  it('reports auth_required when a diagnostic says authentication is missing, even if the probe said authenticated', () => {
    // cursor-agent regression: `status` reports a stale login while headless
    // commands fail with "Authentication required" — the test must not read
    // as passed with an update-suggestion.
    const result = buildRuntimeConnectionTestResult(
      runtime({
        id: 'cursor-agent',
        name: 'Cursor Agent',
        bin: 'cursor-agent',
        auth: { state: 'authenticated', detail: 'Login successful!' },
        update: [recoveryOption({ id: 'install-script', label: 'Update' })],
        diagnostics: [
          {
            level: 'warn',
            message:
              "`cursor-agent models` failed: Authentication required. Run 'agent login'.",
          },
        ],
      }),
    );

    expect(result).toMatchObject({ ok: false, status: 'auth_required' });
    expect(result.recoveryActions?.[0]).toMatchObject({
      intent: 'authenticate',
    });
    expect(result.message).not.toContain('Update');
  });

  it.each([
    [
      'Claude Code v2.1.100 is incompatible; upgrade required',
      'incompatible_version',
    ],
    ['Model "claude-nope" is not a recognized model id.', 'unsupported_model'],
    ['ACP protocol initialize failed', 'protocol_failure'],
    ['Permission denied by host policy', 'permission_failure'],
  ] as const)('classifies connection diagnostic %s', (message, status) => {
    const result = buildRuntimeConnectionTestResult(
      runtime({
        auth: { state: 'authenticated' },
        diagnostics: [{ level: 'error', message }],
      }),
    );
    expect(result).toMatchObject({ ok: false, status, message });
  });
});
