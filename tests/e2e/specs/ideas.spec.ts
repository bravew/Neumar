import { test, expect } from '../fixtures/base';

test.describe('Ideas', () => {
  test('not interested hides an idea after reload', async ({ page }) => {
    await page.addInitScript(() => {
      const settings = JSON.parse(
        window.localStorage.getItem('neumar_settings') || '{}',
      ) as Record<string, unknown>;
      settings.ui = { simpleShell: true };
      settings.language = 'en-US';
      window.localStorage.setItem('neumar_settings', JSON.stringify(settings));
    });
    await page.goto('/ideas');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('Send a clear email')).toBeVisible();
    await page
      .getByRole('listitem')
      .filter({ hasText: 'Send a clear email' })
      .locator('summary')
      .click();
    await page.getByTestId('idea-dismiss-draft-email').click();
    await expect(page.getByText('Send a clear email')).toHaveCount(0);
    await page.reload();
    await expect(page.getByText('Send a clear email')).toHaveCount(0);
  });
});
