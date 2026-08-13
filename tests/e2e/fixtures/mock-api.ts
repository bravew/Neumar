import type { Page } from '@playwright/test';

/**
 * Intercept AG-UI streaming requests and return deterministic SSE responses.
 * Use in Playwright tests to avoid hitting a real LLM.
 */
export async function mockLLMResponses(page: Page) {
  await page.route('**/ag-ui/run', async (route) => {
    const sseBody = [
      'data: {"type":"RUN_STARTED"}\n\n',
      'data: {"type":"TEXT_MESSAGE_START","messageId":"m1","role":"assistant"}\n\n',
      'data: {"type":"TEXT_MESSAGE_CONTENT","messageId":"m1","delta":"Hello! "}\n\n',
      'data: {"type":"TEXT_MESSAGE_CONTENT","messageId":"m1","delta":"How can I help?"}\n\n',
      'data: {"type":"TEXT_MESSAGE_END","messageId":"m1"}\n\n',
      'data: {"type":"RUN_FINISHED"}\n\n',
    ].join('');

    await route.fulfill({
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
      },
      body: sseBody,
    });
  });
}

/**
 * Intercept agent subscribe SSE endpoint with a canned stream.
 */
export async function mockAgentSubscribe(page: Page) {
  await page.route('**/agent/subscribe/**', async (route) => {
    const sseBody = [
      'data: {"type":"text","content":"Working on your task..."}\n\n',
      'data: {"type":"result","content":"Done!"}\n\n',
    ].join('');

    await route.fulfill({
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
      },
      body: sseBody,
    });
  });
}

/**
 * Mock all LLM-related endpoints for fully deterministic browser tests.
 */
export async function mockAllLLM(page: Page) {
  await mockLLMResponses(page);
  await mockAgentSubscribe(page);
}
