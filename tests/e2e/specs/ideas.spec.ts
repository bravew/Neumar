import { test, expect } from '../fixtures/base';

test.describe('Ideas', () => {
  test.beforeEach(async ({ page }) => {
    // Init scripts run again on reload, so merge into `ui` rather than
    // replacing it; replacing would wipe the feedback a test just saved.
    await page.addInitScript(() => {
      const settings = JSON.parse(
        window.localStorage.getItem('neumar_settings') || '{}',
      ) as { ui?: Record<string, unknown>; language?: string };
      settings.ui = { ...settings.ui, simpleShell: true };
      settings.language = 'en-US';
      window.localStorage.setItem('neumar_settings', JSON.stringify(settings));
    });
  });

  test('not interested hides an idea after reload', async ({ page }) => {
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

  test("let's do it prefills and focuses the home composer", async ({
    page,
  }) => {
    await page.goto('/ideas');
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: /Send a clear email/ }).click();
    await expect(page).toHaveURL(/\/$/);
    const composer = page.getByPlaceholder('How can I help you today?');
    await expect(composer).toHaveValue(
      'Draft an email. Ask who it is for before writing.',
    );
    await expect(composer).toBeFocused();
  });
});
