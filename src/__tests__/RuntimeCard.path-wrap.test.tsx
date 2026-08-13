import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { RuntimeCard } from '@/components/settings/tabs/agent-runtimes/RuntimeCard';
import type { AgentRuntimeStatus } from '@/shared/lib/api/agent-runtimes';

describe('RuntimeCard path layout', () => {
  it('wraps long runtime paths instead of truncating them', () => {
    const runtimePath =
      '/Users/example/.local/share/neuma/runtimes/very/deep/path/to/a/runtime/binary/that/should/wrap/codex';

    render(
      <RuntimeCard
        runtime={{ ...runtimeFixture, path: runtimePath }}
        selected={false}
        s={strings}
        onSelect={vi.fn()}
        onInstall={vi.fn()}
        onUpdate={vi.fn()}
        onCopy={vi.fn()}
        onTestConnection={vi.fn()}
        testing={false}
        copiedKey={null}
      />,
    );

    const pathCell = screen.getByText(runtimePath);
    expect(pathCell).toHaveClass('break-all');
    expect(pathCell).not.toHaveClass('truncate');
    expect(pathCell).toHaveAttribute('title', runtimePath);
  });
});

const runtimeFixture = {
  id: 'codex',
  name: 'Codex CLI',
  bin: 'codex',
  available: true,
  version: '1.0.0',
  models: [],
  streamFormat: 'plain',
  capabilities: {
    execution: true,
    structuredStream: false,
    acp: false,
    rpc: false,
  },
} satisfies AgentRuntimeStatus;

const strings = {
  agentRuntimesInstalled: 'Installed',
  agentRuntimesNotInstalled: 'Not installed',
  agentRuntimesTest: 'Test',
  agentRuntimesSelected: 'Selected',
  agentRuntimesSelect: 'Select',
  agentRuntimesVersion: 'Version',
  agentRuntimesPath: 'Path',
  agentRuntimesAuth: 'Auth',
  agentRuntimesAuthAuthenticated: 'Authenticated',
  agentRuntimesAuthUnauthenticated: 'Unauthenticated',
  agentRuntimesAuthUnknown: 'Unknown',
  agentRuntimesOperationRunning: 'Running',
  agentRuntimesOperationFailed: 'Failed',
  agentRuntimesOperationCompleted: 'Completed',
  agentRuntimesOperationCancelled: 'Cancelled',
  agentRuntimesTestSucceeded: 'Connection succeeded',
  agentRuntimesTestFailed: 'Connection failed',
  agentRuntimesCopyOnly: 'Copy only',
  agentRuntimesCopyCommandCopied: 'Copied',
  agentRuntimesInstall: 'Install',
  agentRuntimesCopyCommand: 'Copy command',
  agentRuntimesUpdate: 'Update',
};
