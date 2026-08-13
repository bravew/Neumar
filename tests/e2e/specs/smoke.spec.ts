import { test, expect } from '../fixtures/base';
import { healthCheck } from '../helpers/api-client';

/**
 * Smoke tests — verify the app boots and basic infrastructure works.
 * These are the first tests to run and should catch catastrophic failures.
 *
 * Best practices:
 * - No mocking — tests the real app against real (running) servers
 * - Fast assertions — fail immediately if the app is broken
 * - Independent — each test can run in any order
 */
test.describe('Smoke Tests', () => {
  test('API health endpoint responds', async () => {
    const healthy = await healthCheck();
    expect(healthy).toBe(true);
  });

  test('app loads and renders the home page', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // The app should not show the error boundary
    await expect(page.getByText('Something went wrong')).not.toBeVisible();

    // A textarea for chat input should be present
    await expect(page.getByPlaceholder(/type a message/i)).toBeVisible();
  });

  test('sidebar navigation is visible', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // The sidebar should contain a <nav> with navigation items
    const nav = page.locator('nav').first();
    await expect(nav).toBeVisible();
  });

  // Each route tested independently so failures are reported per-page
  for (const route of [
    '/',
    '/library',
    '/automation',
    '/dashboard',
    '/org',
    '/projects',
    '/design',
  ]) {
    test(`${route} does not crash`, async ({ page }) => {
      await page.goto(route);
      await page.waitForLoadState('domcontentloaded');
      await expect(page.getByText('Something went wrong')).not.toBeVisible();
    });
  }
});
