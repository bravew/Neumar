import { test, expect } from '../fixtures/base';

/**
 * Search (Cmd+K) E2E tests.
 *
 * The search dialog is a global overlay triggered by keyboard shortcut.
 */
test.describe('Search', () => {
  test('Cmd+K opens search dialog', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Trigger Cmd+K (Meta+K on macOS)
    await page.keyboard.press('Meta+k');

    // Search dialog should appear — look for a search input or dialog
    const searchInput = page.getByPlaceholder(/search/i);
    // Give it a moment to animate in
    await expect(searchInput).toBeVisible({ timeout: 3_000 });
  });

  test('Escape closes search dialog', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Open search
    await page.keyboard.press('Meta+k');
    const searchInput = page.getByPlaceholder(/search/i);
    await expect(searchInput).toBeVisible({ timeout: 3_000 });

    // Close with Escape
    await page.keyboard.press('Escape');
    await expect(searchInput).not.toBeVisible({ timeout: 2_000 });
  });

  test('typing in search shows results', async ({ page }) => {
    // Mock search API
    await page.route('**/db/tasks/search*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          { id: 'task-1', title: 'Build calculator', status: 'completed' },
        ]),
      }),
    );

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.keyboard.press('Meta+k');
    const searchInput = page.getByPlaceholder(/search/i);
    await expect(searchInput).toBeVisible({ timeout: 3_000 });

    await searchInput.fill('calculator');
    // Results should appear after debounce
    await expect(page.getByText('Build calculator')).toBeVisible({
      timeout: 5_000,
    });
  });
});
