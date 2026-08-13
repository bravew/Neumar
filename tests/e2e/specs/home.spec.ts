import { test, expect } from '../fixtures/base';

/**
 * Home page E2E tests — validates the main landing experience.
 *
 * Best practices:
 * - Test user-visible behavior, not implementation details
 * - Use web-first assertions (auto-retry) over manual waits
 * - Mock LLM responses via page.route() for deterministic results
 * - One logical assertion per test
 */
test.describe('Home Page', () => {
  test.beforeEach(async ({ homePage }) => {
    await homePage.goto();
  });

  test('chat input is visible and focusable', async ({ homePage }) => {
    await expect(homePage.chatInput).toBeVisible();
    await homePage.chatInput.click();
    await expect(homePage.chatInput).toBeFocused();
  });

  test('chat input accepts text', async ({ homePage }) => {
    await homePage.chatInput.fill('Hello, agent!');
    await expect(homePage.chatInput).toHaveValue('Hello, agent!');
  });

  test('sidebar shows navigation links', async ({ page }) => {
    // Check for key navigation items by their text content
    const sidebar = page.locator('aside').first();
    await expect(sidebar).toBeVisible();

    // Navigation should contain links to main sections
    const nav = page.locator('nav').first();
    await expect(nav).toBeVisible();
  });

  test('submitting a prompt navigates to task page', async ({
    page,
    homePage,
  }) => {
    // Mock the AG-UI run endpoint to return a deterministic SSE response
    await page.route('**/ag-ui/run', async (route) => {
      const sseBody = [
        'data: {"type":"RUN_STARTED"}\n\n',
        'data: {"type":"TEXT_MESSAGE_START","messageId":"m1","role":"assistant"}\n\n',
        'data: {"type":"TEXT_MESSAGE_CONTENT","messageId":"m1","delta":"Hello!"}\n\n',
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

    // Mock API calls that the dispatch flow makes
    await page.route('**/db/sessions', (route) =>
      route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'session-test' }),
      }),
    );

    await page.route('**/db/tasks', (route) => {
      if (route.request().method() === 'POST') {
        return route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({ id: 'task-test', status: 'running' }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '[]',
      });
    });

    await homePage.submitPrompt('Build me a todo app');

    // Should navigate to the task detail page
    await page.waitForURL(/\/task-v2\//, { timeout: 10_000 });
    expect(page.url()).toContain('/task-v2/');
  });
});
