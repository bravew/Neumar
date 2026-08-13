import { test, expect } from '../fixtures/base';

/**
 * Navigation & layout E2E tests.
 *
 * Best practices:
 * - Test actual user navigation flows
 * - Verify URL changes with page.waitForURL()
 * - Check error boundaries on every route
 */
test.describe('Navigation', () => {
  test('home page is the default route', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    // Should show the chat input (home page signature element)
    await expect(page.getByPlaceholder(/type a message/i)).toBeVisible();
  });

  test('invalid route shows error page', async ({ page }) => {
    await page.goto('/this-route-does-not-exist');
    // React Router should render the error element
    // Check for common error indicators
    const errorHeading = page.getByText(/not found|error|went wrong/i);
    await expect(errorHeading.first()).toBeVisible({ timeout: 5_000 });
  });

  test('library page loads', async ({ page }) => {
    await page.goto('/library');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('Something went wrong')).not.toBeVisible();
  });

  test('automation page loads', async ({ page }) => {
    await page.goto('/automation');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('Something went wrong')).not.toBeVisible();
  });

  test('dashboard page loads', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('Something went wrong')).not.toBeVisible();
  });

  test('org (agent profiles) page loads', async ({ page }) => {
    await page.goto('/org');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('Something went wrong')).not.toBeVisible();
  });

  test('projects page loads', async ({ page }) => {
    await page.goto('/projects');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('Something went wrong')).not.toBeVisible();
  });

  test('approvals page loads', async ({ page }) => {
    await page.goto('/approvals');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('Something went wrong')).not.toBeVisible();
  });

  test('setup page loads without guard', async ({ page }) => {
    // Setup page has no SetupGuard — it should always render
    await page.goto('/setup');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('Something went wrong')).not.toBeVisible();
  });

  test('browser back button works', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.goto('/library');
    await page.waitForLoadState('networkidle');

    await page.goBack();
    await page.waitForURL('/');
  });
});
