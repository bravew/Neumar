import { test, expect } from '../fixtures/base';
import { mockAllLLM } from '../fixtures/mock-api';

/**
 * Task lifecycle E2E tests — validates the core product experience:
 * submit prompt → see agent response → interact.
 *
 * Best practices:
 * - Mock all LLM endpoints with page.route() for deterministic behavior
 * - Test DOM state and navigation, not LLM text content
 * - Use web-first assertions (auto-retry, no manual sleeps)
 * - Independent tests — each creates its own task via mocked API
 */
test.describe('Task Lifecycle', () => {
  test.beforeEach(async ({ page }) => {
    // Mock all LLM SSE endpoints for deterministic responses
    await mockAllLLM(page);

    // Mock DB endpoints for task/session creation
    await page.route('**/db/sessions', (route) => {
      if (route.request().method() === 'POST') {
        return route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({ id: `session-${crypto.randomUUID()}` }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '[]',
      });
    });

    await page.route('**/db/tasks', (route) => {
      if (route.request().method() === 'POST') {
        return route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            id: `task-${crypto.randomUUID()}`,
            status: 'running',
            prompt: 'Test task',
          }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '[]',
      });
    });

    // Mock task update/patch
    await page.route('**/db/tasks/*', (route) => {
      if (route.request().method() === 'PATCH') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true }),
        });
      }
      // GET single task
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'task-1',
          status: 'completed',
          prompt: 'Test',
        }),
      });
    });

    // Mock messages endpoint
    await page.route('**/db/messages', (route) =>
      route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ id: `msg-${crypto.randomUUID()}` }),
      }),
    );

    await page.route('**/db/tasks/*/messages', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '[]',
      }),
    );
  });

  test('submit prompt from home navigates to task page', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const chatInput = page
      .getByTestId('home-composer-frame')
      .getByRole('textbox');
    await chatInput.fill('Build a calculator app');
    await chatInput.press('Enter');

    // Should navigate to task-v2 page
    await page.waitForURL(/\/task-v2\//, { timeout: 15_000 });
    expect(page.url()).toContain('/task-v2/');
  });

  test('task page renders without crashing', async ({ page }) => {
    // Navigate directly to a task page with mocked data
    await page.goto('/task-v2/task-1');
    await page.waitForLoadState('networkidle');

    // Should not show error boundary
    await expect(page.getByText('Something went wrong')).not.toBeVisible();
  });

  test('task review opens on Activity and keeps Trace under Details', async ({
    page,
  }) => {
    await page.goto('/task-v2/task-1');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: 'Show right sidebar' }).click();
    await expect(
      page.getByRole('tab', { name: 'Activity', exact: true }),
    ).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tab', { name: 'Files' })).toBeVisible();
    await expect(page.getByText('Trace', { exact: true })).toHaveCount(0);

    await page.getByRole('button', { name: 'Details' }).click();
    await expect(page.getByText('Trace', { exact: true })).toBeVisible();
  });

  test('back navigation from task returns to home', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Navigate to a task page
    await page.goto('/task-v2/task-1');
    await page.waitForLoadState('networkidle');

    // Go back
    await page.goBack();
    await page.waitForURL('/');
    await expect(
      page.getByTestId('home-composer-frame').getByRole('textbox'),
    ).toBeVisible();
  });
});
