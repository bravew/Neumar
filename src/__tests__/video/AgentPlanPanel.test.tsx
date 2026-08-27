import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AgentPlanPanel,
  type AgentPlanPanelLabels,
} from '@/components/video/AgentPlanPanel';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('video plan and execution log', () => {
  it('shows a revision conflict and distinguishes partial success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        return new Response(
          JSON.stringify(
            url.includes('agent-plan')
              ? {
                  plan: {
                    schemaVersion: 1,
                    id: 'plan-1',
                    revision: 2,
                    status: 'active',
                    title: 'Build video',
                    request: 'Build a product video',
                    assumptions: [],
                    projectRevisionAtStart: 4,
                    createdAt: '2026-08-25T00:00:00.000Z',
                    markdownDigest: 'digest',
                    steps: [
                      {
                        id: 'storyboard',
                        title: 'Set storyboard',
                        intent: 'Create scenes',
                        dependsOn: [],
                        operation: 'video_set_storyboard',
                        inputs: {},
                        verification: ['Scenes match'],
                        rollback: 'Undo journal entry',
                      },
                    ],
                  },
                  drifted: false,
                  progress: {
                    status: 'paused',
                    projectRevision: 8,
                    expectedProjectRevision: 7,
                    reason: 'project revision 8 does not match cursor 7',
                    uncertainOperations: [],
                  },
                }
              : {
                  records: [
                    {
                      sequence: 2,
                      stepId: 'storyboard',
                      attempt: 1,
                      phase: 'partial-success',
                      operation: 'video_set_storyboard',
                      projectRevisionAfter: 8,
                      journalEntryIds: ['journal-1'],
                      verification: { timeline: 'needs-review' },
                      error: {
                        code: 'VERIFY_FAILED',
                        message: 'Timeline verification failed',
                        committed: true,
                      },
                    },
                  ],
                },
          ),
          { status: 200 },
        );
      }),
    );
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const onSend = vi.fn();
    const onRollback = vi.fn();
    const user = userEvent.setup();

    render(
      <AgentPlanPanel
        projectId="project-1"
        projectRevision={8}
        labels={labels}
        onSend={onSend}
        onRollback={onRollback}
      />,
    );

    expect(
      await screen.findByText(
        (_, element) =>
          element?.tagName === 'P' &&
          Boolean(element.textContent?.includes('Revision conflict')),
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Partial success')).toBeInTheDocument();
    expect(
      screen.getByText(
        (_, element) =>
          element?.tagName === 'P' &&
          Boolean(element.textContent?.includes('Committed: Yes')),
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/needs-review/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onSend).toHaveBeenCalledWith(expect.stringContaining('storyboard'));
    await user.click(screen.getByRole('button', { name: 'Roll back' }));
    expect(onRollback).toHaveBeenCalledWith('journal-1');
  });
});

const labels: AgentPlanPanelLabels = {
  title: 'Durable execution',
  plan: 'Plan',
  executionLog: 'Execution log',
  refresh: 'Refresh',
  loading: 'Loading',
  loadFailed: 'Load failed',
  driftWarning: 'Plan drift',
  revisionWarning: 'Revision conflict',
  nextStep: 'Next step',
  step: 'Step',
  attempt: 'Attempt',
  verification: 'Verification',
  committed: 'Committed',
  yes: 'Yes',
  no: 'No',
  noRecords: 'No records',
  resume: 'Resume',
  retry: 'Retry',
  rollback: 'Roll back',
  confirmRetry: 'Retry?',
  confirmRollback: 'Roll back?',
  resumePrompt: 'Resume {step}',
  retryPrompt: 'Retry {step}',
  statuses: {
    active: 'Active',
    executing: 'Executing',
    paused: 'Paused',
    completed: 'Completed',
    superseded: 'Superseded',
  },
  phases: {
    started: 'Started',
    succeeded: 'Succeeded',
    failed: 'Failed',
    'partial-success': 'Partial success',
    skipped: 'Skipped',
    'rolled-back': 'Rolled back',
  },
};
