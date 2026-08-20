import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ExecutionDiagnosticsPanel,
  OwnerRunDiagnostics,
} from '@/components/shared/run-diagnostics/ExecutionDiagnosticsPanel';
import { LanguageProvider } from '@/shared/providers/language-provider';
import { useRunTreeStore } from '@/shared/stores/run-tree-store';
import type { ExecutionDiagnosticsV1 } from '@/shared/types/execution-diagnostics';

const originalFetch = globalThis.fetch;

function missing(reason: string) {
  return {
    state: 'not_collected' as const,
    source: 'neuma' as const,
    missingReason: reason,
  };
}

function available<T>(value: T) {
  return {
    state: 'available' as const,
    value,
    evidence: 'measured' as const,
    source: 'neuma' as const,
  };
}

function diagnostics(
  mode: ExecutionDiagnosticsV1['mode'],
  ownerKey: string,
  runId: string,
): ExecutionDiagnosticsV1 {
  const timing = missing('Timing was not collected');
  return {
    schema: 'neuma.execution-diagnostics.v1',
    runId,
    mode,
    ownerKey,
    collectedAt: '2026-01-01T00:00:00.000Z',
    eventStreamCompleteness: 'partial',
    timing: {
      prompt_build: timing,
      agent_run: timing,
      model_call: timing,
      tool_call: timing,
      artifact_write: timing,
      preview_verify: timing,
      stream_start_to_end: timing,
      finalize: timing,
    },
    tools: {
      total: available(0),
      succeeded: available(0),
      failed: available(0),
      byName: available({}),
    },
    anomalies: {
      approval: available(0),
      hook: available(0),
      error: available(0),
      budget: available(0),
    },
    usage: {
      inputTokens: missing('Provider usage was unavailable'),
      outputTokens: missing('Provider usage was unavailable'),
      cacheReadTokens: missing('Provider cache usage was unavailable'),
      cacheCreationTokens: missing('Provider cache usage was unavailable'),
      costUsd: missing('Provider cost was unavailable'),
    },
    environment: {
      runtimeId: available('codex'),
      runtimeVersion: missing('Runtime version was unavailable'),
      requestedModel: available('gpt-5'),
      resolvedModel: available('gpt-5'),
      attempt: available(0),
      continuationAttempts: available(0),
    },
    artifactDelivery: {
      producedFileCount: available(0),
      verdict: available('not_expected'),
    },
  };
}

function renderWithLanguage(ui: React.ReactNode) {
  return render(<LanguageProvider>{ui}</LanguageProvider>);
}

beforeEach(() => {
  useRunTreeStore.setState({ byTaskId: {}, byOwner: {} });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('ExecutionDiagnosticsPanel', () => {
  it('renders explicit missing reasons for a task run', async () => {
    globalThis.fetch = vi.fn(async () =>
      Response.json(diagnostics('task', 'task-1', 'run-task')),
    ) as typeof fetch;
    renderWithLanguage(<ExecutionDiagnosticsPanel runId="run-task" />);

    fireEvent.click(screen.getByText('Execution diagnostics'));
    expect(await screen.findByText('Timing was not collected')).toBeVisible();
    expect(screen.getByText('Partial evidence')).toBeVisible();
  });

  it.each([
    ['design', 'design-1'],
    ['video', 'video-1'],
  ] as const)(
    'uses the shared panel for %s owner runs',
    async (mode, ownerKey) => {
      const runId = `run-${mode}`;
      globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/owner/')) {
          return Response.json({
            tree: [],
            rollup: {
              totalCostUsd: 0,
              totalTokensIn: 0,
              totalTokensOut: 0,
              runCount: 1,
              runningCount: 0,
              failedCount: 0,
            },
            executions: [
              {
                executionId: `execution-${mode}`,
                initialRunId: runId,
                latestRunId: runId,
                status: 'succeeded',
                attemptCount: 2,
                recoveryActions: ['retry'],
              },
            ],
          });
        }
        return Response.json(diagnostics(mode, ownerKey, runId));
      }) as typeof fetch;

      renderWithLanguage(
        <OwnerRunDiagnostics mode={mode} ownerKey={ownerKey} />,
      );

      await waitFor(() => {
        expect(
          screen.getByTestId('execution-diagnostics-panel'),
        ).toBeInTheDocument();
      });
      expect(screen.getByText('Execution diagnostics')).toBeVisible();
      fireEvent.click(screen.getByText('Execution diagnostics'));
      expect(await screen.findByText('Retry')).toBeVisible();
    },
  );

  it('exports a support bundle for the diagnostics owner', async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, _init?: RequestInit) => {
        const url = String(input);
        if (url.includes('/support-bundle')) {
          return new Response('zip', {
            headers: {
              'content-type': 'application/zip',
              'content-disposition':
                'attachment; filename="neuma-support-design.zip"',
            },
          });
        }
        if (url.includes('/diagnostics')) {
          return Response.json(
            diagnostics('design', 'project-1', 'run-design'),
          );
        }
        return Response.json({});
      },
    );
    globalThis.fetch = fetchMock as typeof fetch;
    const createObjectUrl = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:support');
    const revokeObjectUrl = vi
      .spyOn(URL, 'revokeObjectURL')
      .mockImplementation(() => {});
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});
    renderWithLanguage(<ExecutionDiagnosticsPanel runId="run-design" />);

    fireEvent.click(await screen.findByText('Export support bundle'));
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([u]) =>
          String(u).includes('/support-bundle'),
        ),
      ).toBe(true);
    });

    const [, init] = fetchMock.mock.calls.find(([u]) =>
      String(u).includes('/support-bundle'),
    )!;
    expect(init).toMatchObject({ method: 'POST' });
    expect(JSON.parse(String(init?.body))).toEqual({
      mode: 'design',
      ownerKey: 'project-1',
    });
    expect(createObjectUrl).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:support');
  });
});
