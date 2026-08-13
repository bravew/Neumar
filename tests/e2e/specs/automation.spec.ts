import { test, expect } from '../fixtures/base';

/**
 * Automation page E2E tests.
 *
 * Mocks the automation API endpoints to test UI flows
 * without requiring a running automation engine.
 */

const mockAutomation = {
  id: 'auto-1',
  name: 'Daily Report',
  enabled: true,
  prompt: 'Generate daily report',
  trigger: { type: 'manual' },
  agent: { usePlanning: false, autoApprove: true },
  runCount: 5,
  totalCost: 0.12,
  createdAt: '2026-04-01T00:00:00Z',
  updatedAt: '2026-04-06T00:00:00Z',
};

test.describe('Automation Page', () => {
  test.beforeEach(async ({ page }) => {
    // Mock automation API
    await page.route('**/automation/', (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: [mockAutomation] }),
        });
      }
      // POST create
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: { ...mockAutomation, id: 'auto-new' },
        }),
      });
    });

    await page.route('**/automation/status', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            started: true,
            activeRunCount: 0,
            queuedCount: 0,
            automationCount: 1,
          },
        }),
      }),
    );

    await page.route('**/automation/templates', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: [] }),
      }),
    );

    await page.route('**/automation/runs/active', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: [] }),
      }),
    );

    await page.route('**/automation/events', (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
        body: '',
      }),
    );
  });

  test('page loads and shows automation list', async ({ page }) => {
    await page.goto('/automation');
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('Something went wrong')).not.toBeVisible();
    // Should show the automation name
    await expect(page.getByText('Daily Report')).toBeVisible();
  });

  test('automation card displays key info', async ({ page }) => {
    await page.goto('/automation');
    await page.waitForLoadState('networkidle');

    // Should show automation name and trigger type
    await expect(page.getByText('Daily Report')).toBeVisible();
  });
});
