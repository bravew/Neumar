import type { Page, Route } from '@playwright/test';

import { test, expect } from '../fixtures/base';

/**
 * Browser smoke for the AG-UI 1.0 epic (#334): the four workflows the epic
 * delivers, driven by one deterministic fixture.
 *
 * The CopilotKit runtime, task store, and history endpoints are answered in
 * the browser, so the spec exercises the real provider, reducers, and
 * components against the exact wire shapes the emitter produces. The
 * backend half of the same shapes is covered by the API suites.
 */

const api = 'http://localhost:5126';
const taskId = 'task-epic';
const plan = {
  id: 'plan-1',
  goal: 'Ship the epic',
  steps: [
    { id: 'step-1', description: 'Wire the interrupt', status: 'pending' },
    { id: 'step-2', description: 'Show the children', status: 'pending' },
  ],
};
const interrupt = {
  id: 'plan:run-plan',
  reason: 'plan_approval',
  message: 'Approve the plan',
  metadata: { decision: { kind: 'plan', plan } },
};

const sse = (event: unknown) => `data: ${JSON.stringify(event)}\n\n`;

/** The resumed run: a child works, the plan widget settles, usage is reported. */
function resumedStream(): string {
  return [
    { type: 'RUN_STARTED', threadId: taskId, runId: 'run-exec' },
    {
      type: 'ACTIVITY_SNAPSHOT',
      messageId: 'plan-plan-1',
      activityType: 'plan',
      content: { phase: 'running', goal: plan.goal, steps: plan.steps },
      replace: true,
    },
    {
      type: 'SUBAGENT_STARTED',
      subagentRunId: 'task-a',
      name: 'Scan',
      description: 'Scan the repository',
      parentToolCallId: 'toolu_A',
    },
    {
      type: 'TEXT_MESSAGE_START',
      messageId: 'child-1',
      role: 'assistant',
      subagentRunId: 'task-a',
    },
    {
      type: 'TEXT_MESSAGE_CONTENT',
      messageId: 'child-1',
      delta: 'Found the entry points.',
      subagentRunId: 'task-a',
    },
    {
      type: 'TEXT_MESSAGE_END',
      messageId: 'child-1',
      subagentRunId: 'task-a',
    },
    {
      type: 'SUBAGENT_FINISHED',
      subagentRunId: 'task-a',
      result: 'Scanned 12 files',
    },
    {
      type: 'ACTIVITY_DELTA',
      messageId: 'plan-plan-1',
      activityType: 'plan',
      patch: [{ op: 'replace', path: '/phase', value: 'done' }],
    },
    { type: 'RUN_FINISHED', outcome: { type: 'success' } },
  ]
    .map(sse)
    .join('');
}

async function mockEpicBackend(page: Page) {
  // Every API call the page makes stays in the browser: this spec must never
  // read or write a developer's real app data on port 5126. Routes registered
  // later win, so the specific handlers below override this fallback.
  await page.route(`${api}/**`, (route) => {
    const url = route.request().url();
    if (url.includes('/subscribe') || url.includes('/automation/events')) {
      // Live channels stay open and silent; a JSON body would abort them.
      return route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
        body: '',
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '[]',
    });
  });

  await page.route(`${api}/db/tasks/**`, (route) => {
    const url = route.request().url();
    if (url.endsWith('/messages')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 1,
            task_id: taskId,
            type: 'user',
            content: plan.goal,
            message_id: 'user-1',
            created_at: new Date(0).toISOString(),
          },
        ]),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: taskId,
        session_id: 'session-1',
        task_index: 1,
        prompt: plan.goal,
        title: 'Epic smoke',
        status: 'completed',
        favorite: false,
        cost: 0,
        duration: 1,
        created_at: new Date(0).toISOString(),
        updated_at: new Date(0).toISOString(),
      }),
    });
  });

  await page.route(`${api}/runs/*/tree`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        // P2: one completed run with the usage it reported.
        tree: [
          {
            id: 'run-exec',
            taskId,
            parentRunId: null,
            provider: 'claude',
            model: 'sonnet',
            status: 'completed',
            startedAt: new Date(0).toISOString(),
            finishedAt: new Date(1).toISOString(),
            costUsd: 0.01,
            tokensIn: 1200,
            tokensOut: 3400,
            usage: {
              usage: [
                { inputTokens: 1200, outputTokens: 3400, totalTokens: 4600 },
              ],
              costUsd: 0.01,
            },
            error: null,
            completeness: 'complete',
            delivery: 'delivered',
            retry: 'not_safe',
            failureCause: null,
            runtimeVersion: null,
            attempt: 0,
            sessionHandleKind: null,
            invalidationReason: null,
            mode: 'task',
            ownerKey: taskId,
            executionId: 'exec-1',
            initialRunId: 'run-exec',
            sourceRunId: null,
            runIndex: 1,
            recoveryAction: null,
            children: [],
          },
        ],
        rollup: {
          totalCostUsd: 0.01,
          totalTokensIn: 1200,
          totalTokensOut: 3400,
          runCount: 1,
          runningCount: 0,
          failedCount: 0,
        },
        executions: [
          {
            executionId: 'exec-1',
            initialRunId: 'run-exec',
            latestRunId: 'run-exec',
            status: 'succeeded',
            attemptCount: 1,
            recoveryActions: [],
          },
        ],
      }),
    }),
  );

  await page.route(`${api}/ag-ui/history/${taskId}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        messages: [{ id: 'user-1', role: 'user', content: plan.goal }],
        isRunning: false,
        files: [],
      }),
    }),
  );

  await page.route(`${api}/ag-ui/pending-plan/${taskId}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ plan, interrupt }),
    }),
  );

  await page.route(`${api}/copilotkit/info`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        version: '1.88.0',
        agents: {
          default: { name: 'default', description: '', className: 'Kt' },
        },
        audioFileTranscriptionEnabled: false,
        mode: 'sse',
        threadEndpoints: {
          list: false,
          inspect: true,
          mutations: false,
          realtimeMetadata: false,
        },
        suggestions: true,
        a2uiEnabled: false,
        openGenerativeUIEnabled: false,
        telemetryDisabled: false,
      }),
    }),
  );
}

async function mockRun(page: Page, onRequest: (body: unknown) => void) {
  await page.route(`${api}/copilotkit/agent/*/run`, async (route: Route) => {
    onRequest(route.request().postDataJSON());
    await route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
      body: resumedStream(),
    });
  });
}

test.describe('AG-UI epic browser smoke', () => {
  test('answers the plan interrupt and renders the child and the widget', async ({
    page,
  }) => {
    await mockEpicBackend(page);
    const bodies: unknown[] = [];
    await mockRun(page, (body) => bodies.push(body));

    await page.goto(`/task-v2/${taskId}`);
    await page.waitForLoadState('networkidle');

    // P0: the pending decision is shown from the server record, not the
    // previous run's live stream.
    await expect(page.getByText('Action Plan')).toBeVisible();
    // The prompt bubble and the card's goal both read the plan goal.
    await expect(page.getByText('Ship the epic')).toHaveCount(2);
    await expect(
      page.getByRole('button', { name: 'Run', exact: true }),
    ).toBeVisible();

    // The primary action pulses forever, so Playwright's stability wait never
    // settles; the click target itself is the visible button.
    await page
      .getByRole('button', { name: 'Run', exact: true })
      .click({ force: true });

    // The answer is the standard resume entry bound to that interrupt id.
    await expect
      .poll(() => bodies.length, { timeout: 10_000 })
      .toBeGreaterThan(0);
    expect(bodies[0]).toMatchObject({
      resume: [
        {
          interruptId: interrupt.id,
          status: 'resolved',
          payload: { approved: true },
        },
      ],
    });

    // P3: one plan widget, settled by the patch.
    const widget = page.getByRole('region', { name: 'Plan' });
    await expect(widget).toBeVisible();
    await expect(widget.getByText('Ship the epic')).toBeVisible();
    await expect(widget.getByText('Completed').first()).toBeVisible();

    // P1: the child has its own card with its status.
    await expect(page.getByText('Scan', { exact: true })).toBeVisible();
    await expect(page.getByText('Completed').first()).toBeVisible();

    // P2: the run's reported usage is visible in the persisted run tree.
    await expect(page.getByText(/Run tree \(1\)/)).toBeVisible();
    // The rollup header and the run row both carry the tokens.
    await expect(page.getByText(/1\.2k↑\s*3\.4k↓/).first()).toBeVisible();

    // The run ended cleanly, so the thread is not still running.
    await expect(page.getByRole('button', { name: /stop/i })).toHaveCount(0);
  });
});
